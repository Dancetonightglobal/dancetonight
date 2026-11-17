import { describe, expect, it } from "vitest";

import { longitudeZone, pickerZone } from "@/src/data/listing-mapper";

describe("pickerZone (D-143)", () => {
  it("uses the metro's zone when there is one", () => {
    expect(pickerZone({ tz: "America/New_York" }, { lat: 40.71, lng: -74.0 })).toBe(
      "America/New_York",
    );
  });

  it("falls back to a whole-hour zone from the longitude, never geo-tz", () => {
    expect(pickerZone(null, { lat: 40.71, lng: -74.0 })).toBe("Etc/GMT+5");
    expect(pickerZone(null, { lat: 48.85, lng: 2.35 })).toBe("Etc/GMT");
    expect(pickerZone(null, { lat: 35.68, lng: 139.69 })).toBe("Etc/GMT-9");
  });

  it("clamps to the zones that exist and survives a bad longitude", () => {
    expect(longitudeZone(179.9)).toBe("Etc/GMT-12");
    expect(longitudeZone(-179.9)).toBe("Etc/GMT+12");
    expect(longitudeZone(Number.NaN)).toBe("UTC");
  });

  it("names only zones the runtime knows", () => {
    for (let lng = -180; lng <= 180; lng += 7.5) {
      const zone = longitudeZone(lng);
      expect(() => new Intl.DateTimeFormat("en", { timeZone: zone })).not.toThrow();
    }
  });
});
