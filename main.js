"use strict";

/*
 * NuaSense for ioBroker.
 *
 * Two jobs, each optional:
 *
 *   READ   With an API key, poll NuaSense for the account's external stations
 *          and write what it computes into states: tonight's low and whether
 *          it is a frost night, the next calm dry window for spraying, the
 *          latest reading against the model, and the hourly agronomy (ET0,
 *          leaf wetness, spray quality, VPD, delta T).
 *
 *   SEND   With a station token, forward a weather station ioBroker already
 *          has (any adapter: Ecowitt, Sainlogic, Bresser, rtl_433 via MQTT …)
 *          to NuaSense once a minute, exactly as an Ecowitt console would.
 *          The user maps the states that hold temperature, humidity, pressure,
 *          wind, rain and light.
 */

const utils = require("@iobroker/adapter-core");
const { toEcowitt, encodeForm, uploadUrl } = require("./lib/ecowitt");

const FORWARD_EVERY_MS = 60_000;
const MIN_POLL_MINUTES = 5;
// What the garden mostly is; the API returns watering for all three.
const PLANTS = ["lawn", "vegetables", "beds"];

class Nuasense extends utils.Adapter {
  /** @param {Partial<utils.AdapterOptions>} [options] */
  constructor(options) {
    super({ ...options, name: "nuasense" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.pollTimer = null;
    this.forwardTimer = null;
    this.polling = false;
  }

  async onReady() {
    await this.setStateAsync("info.connection", { val: false, ack: true });
    const cfg = this.config;

    const canRead = Boolean(cfg.apiKey);
    const canSend = Boolean(cfg.forwardEnabled && cfg.forwardToken);
    if (!canRead && !canSend) {
      this.log.warn(
        "Nothing configured: add an API key to read the station intelligence, or a station token to forward a station",
      );
      return;
    }

    if (canRead) {
      await this.poll();
      const minutes = Math.max(MIN_POLL_MINUTES, Number(cfg.pollMinutes) || 15);
      this.pollTimer = this.setInterval(() => this.poll(), minutes * 60_000);
      this.log.info(`reading NuaSense every ${minutes} min`);
    }

    if (canSend) {
      try {
        this.forwardUrl = uploadUrl(cfg.forwardServer, cfg.forwardToken);
      } catch (e) {
        this.log.error(
          `forwarding is on but the station token looks wrong: ${e.message}`,
        );
        return;
      }
      await this.forward();
      this.forwardTimer = this.setInterval(
        () => this.forward(),
        FORWARD_EVERY_MS,
      );
      this.log.info(
        `forwarding the mapped states to ${this.forwardUrl.replace(/\/station\/.*/, "/station/…")} every minute`,
      );
    }
  }

  // --- read ------------------------------------------------------------------

  async api(path) {
    const base = String(
      this.config.baseUrl || "https://api.nuasense.com",
    ).replace(/\/+$/, "");
    const res = await fetch(base + path, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(body.error || body.message || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  async poll() {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const list = await this.api("/api/nuasense/v1/ingest/stations");
      await this.setStateAsync("info.connection", { val: true, ack: true });
      const wanted = String(this.config.stationId || "").trim();
      const stations = (list.stations || []).filter(
        (s) => !wanted || s.station_id === wanted,
      );
      if (stations.length === 0) {
        this.log.warn(
          wanted
            ? `station "${wanted}" is not on this account`
            : "this account has no external stations yet",
        );
      }
      for (const station of stations) {
        await this.updateStation(station);
      }
    } catch (e) {
      await this.setStateAsync("info.connection", { val: false, ack: true });
      this.log.warn(`NuaSense not read: ${e.message}`);
    } finally {
      this.polling = false;
    }
  }

  async updateStation(station) {
    const id = `stations.${sanitize(station.station_id)}`;
    await this.extendObjectAsync(id, {
      type: "channel",
      common: { name: station.name || station.station_id },
      native: { station_id: station.station_id },
    });

    const push = station.push || {};
    await this.put(`${id}.lastUpload`, push.last_push_at || null, {
      name: "Last upload from the station",
      type: "string",
      role: "date",
    });
    await this.put(`${id}.device`, push.device || null, {
      name: "Device that uploads",
      type: "string",
      role: "text",
    });

    let look = null;
    try {
      look = await this.api(
        `/api/nuasense/v1/ingest/first-look?station_id=${encodeURIComponent(station.station_id)}`,
      );
    } catch (e) {
      if (e.status !== 409) {
        this.log.debug(`first look for ${station.station_id}: ${e.message}`);
      }
    }
    const t = (look && look.tonight) || {};
    const c = (look && (look.plausibility || look.station_check)) || {};
    const w = (look && look.garden && look.garden.watering) || {};

    // --- house & garden: every station ---------------------------------------
    await this.put(`${id}.tonight.low`, numOrNull(t.low_c), {
      name: "Tonight's low",
      type: "number",
      role: "value.temperature.min",
      unit: "°C",
    });
    await this.put(`${id}.tonight.at`, t.at || null, {
      name: "Expected at (local)",
      type: "string",
      role: "text",
    });
    await this.put(`${id}.tonight.frost`, t.frost || null, {
      name: "Frost tonight: none, watch or frost",
      type: "string",
      role: "text",
    });
    await this.put(`${id}.tonight.grassLow`, numOrNull(t.grass_low_c), {
      name: "Estimated grass-level low",
      type: "number",
      role: "value.temperature",
      unit: "°C",
    });

    const plant = PLANTS.includes(this.config.plant)
      ? this.config.plant
      : "lawn";
    const needMm =
      w.need_mm && typeof w.need_mm === "object"
        ? numOrNull(w.need_mm[plant])
        : null;
    const rate = Number(this.config.sprinklerRate) || 0;
    await this.put(`${id}.garden.wateringMm`, needMm, {
      name: `Watering today (${plant})`,
      type: "number",
      role: "value",
      unit: "mm",
    });
    await this.put(
      `${id}.garden.wateringMinutes`,
      needMm !== null && rate > 0 ? Math.round((needMm / rate) * 60) : null,
      {
        name: "Watering time today at the sprinkler rate",
        type: "number",
        role: "value",
        unit: "min",
      },
    );
    await this.put(`${id}.garden.rainNext24h`, numOrNull(w.rain_next_24h_mm), {
      name: "Rain forecast, next 24 h",
      type: "number",
      role: "value.precipitation.forecast",
      unit: "mm",
    });
    await this.put(`${id}.garden.rainLast24h`, numOrNull(w.rain_last_24h_mm), {
      name: "Rain measured by the station, last 24 h",
      type: "number",
      role: "value.precipitation",
      unit: "mm",
    });
    await this.put(`${id}.garden.et0`, numOrNull(w.et0_mm), {
      name: "Evaporation today (ET0)",
      type: "number",
      role: "value",
      unit: "mm",
    });
    await this.put(`${id}.garden.et0Source`, w.et0_source || null, {
      name: "ET0 from: station or forecast",
      type: "string",
      role: "text",
    });

    await this.put(`${id}.plausibility.verdict`, c.verdict || null, {
      name: "Plausibility: plausible or implausible",
      type: "string",
      role: "text",
    });
    await this.put(`${id}.plausibility.reading`, numOrNull(c.reading_c), {
      name: "Latest reading",
      type: "number",
      role: "value.temperature",
      unit: "°C",
    });
    await this.put(`${id}.plausibility.model`, numOrNull(c.model_c), {
      name: "Forecast model for that hour",
      type: "number",
      role: "value.temperature",
      unit: "°C",
    });
    await this.put(`${id}.plausibility.difference`, numOrNull(c.diff_c), {
      name: "Reading minus model",
      type: "number",
      role: "value",
      unit: "K",
    });

    // --- agronomy: only with "advanced" ----------------------------------------
    if (!this.config.advanced) {
      return;
    }
    const s = (look && look.spray) || {};
    await this.put(
      `${id}.spray.window`,
      s.window ? `${s.window.from}–${s.window.to}` : s.date ? "none" : null,
      {
        name: "Next spray window",
        type: "string",
        role: "text",
      },
    );
    await this.put(`${id}.spray.date`, s.date || null, {
      name: "Day of the spray window",
      type: "string",
      role: "text",
    });
    await this.put(`${id}.spray.windMax`, numOrNull(s.wind_max_ms), {
      name: "Highest wind in the window",
      type: "number",
      role: "value.speed",
      unit: "m/s",
    });
    await this.put(`${id}.spray.reason`, s.reason || null, {
      name: "Why there is no window",
      type: "string",
      role: "text",
    });

    let row = null;
    try {
      const d = await this.api(
        `/api/nuasense/v1/ingest/derived?station_id=${encodeURIComponent(station.station_id)}&start=-6h&limit=1`,
      );
      row = (d.data && d.data[0]) || null;
    } catch (e) {
      this.log.debug(`derived values for ${station.station_id}: ${e.message}`);
    }
    const r = row || {};
    const hourly = [
      [
        "time",
        r.time || null,
        { name: "Hour of these values", type: "string", role: "date" },
      ],
      [
        "et0",
        numOrNull(r.et0_hour),
        { name: "ET0 in the hour", type: "number", role: "value", unit: "mm" },
      ],
      [
        "leafWetnessHours",
        numOrNull(r.lwd_consecutive_hours),
        {
          name: "Consecutive wet-leaf hours",
          type: "number",
          role: "value",
          unit: "h",
        },
      ],
      [
        "sprayQuality",
        r.spray_quality_label || null,
        { name: "Spray quality", type: "string", role: "text" },
      ],
      [
        "sprayIndex",
        numOrNull(r.spray_quality_index),
        { name: "Spray quality index", type: "number", role: "value" },
      ],
      [
        "sprayLimit",
        r.spray_limiting_factor || null,
        { name: "What limits spraying", type: "string", role: "text" },
      ],
      [
        "vpd",
        numOrNull(r.vpd),
        {
          name: "Vapour pressure deficit",
          type: "number",
          role: "value",
          unit: "kPa",
        },
      ],
      [
        "deltaT",
        numOrNull(r.delta_t),
        {
          name: "Delta T",
          type: "number",
          role: "value.temperature",
          unit: "°C",
        },
      ],
      [
        "temperature",
        numOrNull(r.temperature),
        {
          name: "Temperature, hourly mean",
          type: "number",
          role: "value.temperature",
          unit: "°C",
        },
      ],
      [
        "humidity",
        numOrNull(r.humidity),
        {
          name: "Humidity, hourly mean",
          type: "number",
          role: "value.humidity",
          unit: "%",
        },
      ],
      [
        "pressure",
        numOrNull(r.pressure),
        {
          name: "Pressure, hourly mean",
          type: "number",
          role: "value.pressure",
          unit: "hPa",
        },
      ],
    ];
    for (const [key, value, common] of hourly) {
      await this.put(`${id}.hourly.${key}`, value, common);
    }
  }

  /** Create the state if needed, then write it acknowledged. */
  async put(id, value, common) {
    await this.setObjectNotExistsAsync(id, {
      type: "state",
      common: { read: true, write: false, ...common },
      native: {},
    });
    await this.setStateAsync(id, { val: value, ack: true });
  }

  // --- send ------------------------------------------------------------------

  async readMapped(stateId) {
    if (!stateId) {
      return undefined;
    }
    try {
      const s = await this.getForeignStateAsync(stateId);
      if (!s || s.val === null || s.val === undefined || s.val === "") {
        return undefined;
      }
      const n = Number(s.val);
      return Number.isFinite(n) ? n : undefined;
    } catch (e) {
      this.log.debug(`cannot read ${stateId}: ${e.message}`);
      return undefined;
    }
  }

  async forward() {
    const cfg = this.config;
    let wind = await this.readMapped(cfg.windSpeedState);
    let gust = await this.readMapped(cfg.windGustState);
    if (cfg.windUnit === "kmh") {
      if (wind !== undefined) {
        wind /= 3.6;
      }
      if (gust !== undefined) {
        gust /= 3.6;
      }
    }
    const reading = {
      temperature: await this.readMapped(cfg.temperatureState),
      humidity: await this.readMapped(cfg.humidityState),
      pressure: await this.readMapped(cfg.pressureState),
      wind_speed: wind,
      wind_gusts: gust,
      wind_direction: await this.readMapped(cfg.windDirectionState),
      rain_total_mm: await this.readMapped(cfg.rainTotalState),
      solar_wm2: await this.readMapped(cfg.solarState),
      light_lux: await this.readMapped(cfg.luxState),
    };
    const fields = toEcowitt(reading, {
      deviceId: cfg.forwardDeviceId || `iobroker-${this.namespace}`,
      stationType: "iobroker.nuasense_V0.2.0",
    });
    if (Object.keys(fields).length <= 3) {
      // PASSKEY, stationtype, dateutc and nothing else: no mapped state had a value.
      await this.setStateAsync("forward.lastStatus", {
        val: "no values to send (check the mapped states)",
        ack: true,
      });
      return;
    }
    try {
      const res = await fetch(this.forwardUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodeForm(fields),
        signal: AbortSignal.timeout(10_000),
      });
      const text = (await res.text()).slice(0, 80);
      await this.setStateAsync("forward.lastSentAt", {
        val: new Date().toISOString(),
        ack: true,
      });
      await this.setStateAsync("forward.lastStatus", {
        val: `${res.status} ${text}`.trim(),
        ack: true,
      });
      if (res.status === 404) {
        this.log.warn(
          "NuaSense does not know this station token (revoked, or mistyped)",
        );
      } else if (res.status === 409) {
        this.log.warn(
          "the station token is bound to another device; issue a new path in the console",
        );
      }
    } catch (e) {
      await this.setStateAsync("forward.lastStatus", {
        val: `failed: ${e.message}`,
        ack: true,
      });
      this.log.debug(`upload failed: ${e.message}`);
    }
  }

  onUnload(callback) {
    try {
      if (this.pollTimer) {
        this.clearInterval(this.pollTimer);
      }
      if (this.forwardTimer) {
        this.clearInterval(this.forwardTimer);
      }
    } finally {
      callback();
    }
  }
}

function sanitize(id) {
  return String(id).replace(/[^A-Za-z0-9_-]/g, "_");
}

function numOrNull(v) {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /** @param {Partial<utils.AdapterOptions>} [options] */
  module.exports = (options) => new Nuasense(options);
} else {
  // otherwise start the instance directly
  new Nuasense();
}
