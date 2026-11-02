![Logo](admin/nuasense.png)

# ioBroker.nuasense

[![NPM version](https://img.shields.io/npm/v/iobroker.nuasense.svg)](https://www.npmjs.com/package/iobroker.nuasense)
[![Downloads](https://img.shields.io/npm/dm/iobroker.nuasense.svg)](https://www.npmjs.com/package/iobroker.nuasense)

**Tests:** ![Test and Release](https://github.com/nuasense/ioBroker.nuasense/workflows/Test%20and%20Release/badge.svg)

## NuaSense adapter for ioBroker

What your weather station means for your crop, as ioBroker states — and, if you like, your station forwarded from ioBroker to NuaSense.

[NuaSense](https://nuasense.com) computes the agronomy on a weather station of any brand: tonight's low and whether it is a frost night, the next calm dry daylight window for spraying, whether the latest reading is plausible against the model, and the hourly values — ET0, leaf wetness, spray quality, VPD, delta T. The first three stations on an account connect free.

### Read

Make an API key in the NuaSense console under **API Keys** (scope `ingest:write`; despite the name it is what reads your own stations) and put it into the adapter. Every 15 minutes (configurable) the adapter writes, per station:

| state | meaning |
|---|---|
| `tonight.low`, `tonight.at`, `tonight.frost`, `tonight.grassLow` | the coming night: low in °C, when, `none` / `watch` / `frost`, grass-level estimate |
| `spray.window`, `spray.date`, `spray.windMax`, `spray.reason` | the next calm dry window, e.g. `07:00–14:00`, or why there is none |
| `check.verdict`, `check.reading`, `check.model`, `check.difference` | latest reading against the model for that hour: `plausible`, `check`, `off` |
| `hourly.et0`, `hourly.leafWetnessHours`, `hourly.sprayQuality`, `hourly.sprayIndex`, `hourly.sprayLimit`, `hourly.vpd`, `hourly.deltaT`, `hourly.temperature`, `hourly.humidity`, `hourly.pressure` | the latest hourly agronomy |
| `lastUpload`, `device` | when the station last sent, and from what |

`info.connection` says whether NuaSense answered with this key.

### Send

Any weather station ioBroker already has — through the Ecowitt, Sainlogic, Bresser, Netatmo or MQTT adapters, or rtl_433 — can become a NuaSense station:

1. In the NuaSense console: **External stations → Add a station**, pick *Home Assistant / weewx / Meteobridge / Node-RED*, give it a name and a position. The last screen shows a path like `/station/kw7n-4hpd-x2vt`; the part after `/station/` is the token.
2. In the adapter's *Forward a station* tab: switch forwarding on, paste the token, and pick the states that hold temperature (°C), humidity (%), pressure at station level (hPa), wind (m/s or km/h), gusts, direction, the rain total (mm, a counter that only grows) and solar radiation or light.
3. The adapter sends once a minute, exactly as an Ecowitt console would. `forward.lastStatus` shows the receiver's answer; the console shows the first upload within a minute.

Missing values are simply not sent. The station's path is bound to the first device id that uses it, so keep the device id stable.

### Your data

When you connect a station, NuaSense stores its readings and computes your forecast, spray windows and risks from them. The readings are used aggregated and anonymised to improve forecasts and models for everyone; they are never passed on individually without your opt-in. You can disconnect the station in the console at any time and have all its data deleted.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### 0.1.1 (2026-11-03)
* (NuaSense) checker fixes: Node.js 22, i18n for the admin UI, responsive sizes, trusted-publishing workflow, node:crypto

### 0.1.0 (2026-11-03)
* (NuaSense) first release: first look and hourly agronomy as states; optional forwarding of a station from ioBroker to NuaSense

## License
MIT License

Copyright (c) 2026 NuaSense <manuel@nuasense.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
