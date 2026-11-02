"use strict";

/**
 * Metric readings in, an Ecowitt-format upload out.
 *
 * NuaSense's station receiver speaks what consumer consoles speak, and the
 * Ecowitt format is the richest of them. So a Node-RED flow sends the same
 * form a GW2000 would: imperial units, rain as a running yearly counter, and
 * a PASSKEY that identifies the device so the receiver can bind the station's
 * path to it. Everything here is pure, so it is tested without Node-RED.
 */

const crypto = require("node:crypto");

const INHG_PER_HPA = 1 / 33.8639;
const MPH_PER_MS = 1 / 0.44704;
const IN_PER_MM = 1 / 25.4;
// Daylight: 120 lux per W/m² of global radiation — the receiver's own factor,
// used the other way, so a flow that only has lux lands on the same number.
const LUX_PER_WM2 = 120;

const num = (v) => {
  if (v === null || v === undefined || v === "") {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fix = (n, digits) => (n === null ? null : Number(n.toFixed(digits)));

/** Ecowitt's `dateutc`: "YYYY-MM-DD HH:MM:SS", UTC. */
function dateUtc(when) {
  const d = when instanceof Date ? when : when ? new Date(when) : new Date();
  if (Number.isNaN(d.getTime())) {
    return dateUtc(new Date());
  }
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** A stable 32-hex PASSKEY from whatever names the device in the flow. */
function passkeyFor(deviceId) {
  return crypto
    .createHash("md5")
    .update(String(deviceId || "node-red"), "utf8")
    .digest("hex")
    .toUpperCase();
}

/**
 * @param reading metric: temperature (°C), humidity (%), pressure (hPa, station
 *   level), wind_speed and wind_gusts (m/s), wind_direction (°), rain_total_mm
 *   (a counter that only grows — the receiver turns it into increments),
 *   solar_wm2 (W/m²) or light_lux, time (ISO or Date; now when absent)
 * @returns the form fields, as strings, in the order a console sends them
 */
function toEcowitt(
  reading,
  { deviceId, stationType = "node-red-contrib-nuasense" } = {},
) {
  const r = reading && typeof reading === "object" ? reading : {};
  const fields = {
    PASSKEY: passkeyFor(deviceId),
    stationtype: stationType,
    dateutc: dateUtc(r.time),
  };
  const t = num(r.temperature);
  if (t !== null) {
    fields.tempf = String(fix((t * 9) / 5 + 32, 2));
  }
  const h = num(r.humidity);
  if (h !== null) {
    fields.humidity = String(Math.round(h));
  }
  const p = num(r.pressure);
  if (p !== null) {
    fields.baromabsin = String(fix(p * INHG_PER_HPA, 3));
  }
  const ws = num(r.wind_speed);
  if (ws !== null) {
    fields.windspeedmph = String(fix(ws * MPH_PER_MS, 2));
  }
  const wg = num(r.wind_gusts);
  if (wg !== null) {
    fields.windgustmph = String(fix(wg * MPH_PER_MS, 2));
  }
  const wd = num(r.wind_direction);
  if (wd !== null) {
    fields.winddir = String(Math.round(((wd % 360) + 360) % 360));
  }
  const rain = num(r.rain_total_mm);
  if (rain !== null) {
    fields.yearlyrainin = String(fix(rain * IN_PER_MM, 3));
  }
  const sol = num(r.solar_wm2);
  const lux = num(r.light_lux);
  if (sol !== null) {
    fields.solarradiation = String(fix(sol, 2));
  } else if (lux !== null) {
    fields.solarradiation = String(fix(lux / LUX_PER_WM2, 2));
  }
  const uv = num(r.uv);
  if (uv !== null) {
    fields.uv = String(Math.round(uv));
  }
  return fields;
}

function encodeForm(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** The upload URL for a token as it is shown: kw7n-4hpd-x2vt (hyphens are fine on the wire). */
function uploadUrl(server, token) {
  const host = String(server || "ingest.nuasense.com")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const tok = String(token || "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9-]{12,29}$/.test(tok)) {
    throw new Error(
      "the station path token looks wrong — copy it from the console",
    );
  }
  return `http://${host}/station/${tok}`;
}

module.exports = {
  toEcowitt,
  encodeForm,
  uploadUrl,
  passkeyFor,
  dateUtc,
  LUX_PER_WM2,
};
