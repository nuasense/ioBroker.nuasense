const { expect } = require("chai");
const { toEcowitt, encodeForm, uploadUrl } = require("../lib/ecowitt");

describe("lib/ecowitt (what the forwarder sends)", () => {
    it("turns a metric reading into Ecowitt form fields", () => {
        const f = toEcowitt(
            { temperature: 17.4, humidity: 89.7, pressure: 759.9, wind_speed: 2.0, wind_gusts: 4.5, wind_direction: 110, rain_total_mm: 254, solar_wm2: 226.3, time: "2026-11-02T15:02:00Z" },
            { deviceId: "north-field", stationType: "iobroker.nuasense_V0.1.0" }
        );
        expect(f.tempf).to.equal("63.32");
        expect(f.humidity).to.equal("90");
        expect(f.baromabsin).to.equal("22.44");
        expect(f.windspeedmph).to.equal("4.47");
        expect(f.windgustmph).to.equal("10.07");
        expect(f.winddir).to.equal("110");
        expect(f.yearlyrainin).to.equal("10");
        expect(f.solarradiation).to.equal("226.3");
        expect(f.dateutc).to.equal("2026-11-02 15:02:00");
        expect(f.PASSKEY).to.match(/^[0-9A-F]{32}$/);
        expect(f.stationtype).to.equal("iobroker.nuasense_V0.1.0");
    });

    it("leaves out what it does not have", () => {
        const f = toEcowitt({ temperature: undefined, humidity: null }, { deviceId: "x" });
        expect(f).to.not.have.property("tempf");
        expect(f).to.not.have.property("humidity");
        expect(f).to.have.property("dateutc");
    });

    it("builds the upload URL from the token as shown in the console", () => {
        expect(uploadUrl("ingest.nuasense.com", "kw7n-4hpd-x2vt")).to.equal("http://ingest.nuasense.com/station/kw7n-4hpd-x2vt");
        expect(() => uploadUrl("ingest.nuasense.com", "nope")).to.throw(/looks wrong/);
    });

    it("url-encodes the form", () => {
        expect(encodeForm({ a: "1 2", b: "&" })).to.equal("a=1%202&b=%26");
    });
});
