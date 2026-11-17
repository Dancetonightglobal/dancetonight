import { describe, it, expect } from "vitest";
import {
  CityDirectory,
  DirectoryMetro,
  encodeDirectory,
  decodeDirectory,
  citiesFromDirectory,
  metroFromDirectory,
} from "@/src/data/city-directory";
import { encodeShared } from "@/src/data/shared-cache";

describe("city-directory", () => {
  const barcelona: DirectoryMetro = {
    id: "barcelona",
    slug: "barcelona",
    name: "Barcelona",
    countryCode: "ES",
    center: { lat: 41.3851, lng: 2.1734 },
    radiusKm: 20,
    tz: "Europe/Madrid",
    languages: ["ca", "es"],
    adHoc: false,
    lastNight: "2026-11-02",
  };

  const lisbon: DirectoryMetro = {
    id: "lisbon",
    slug: "lisbon",
    name: "Lisbon",
    countryCode: "PT",
    center: { lat: 38.7223, lng: -9.1393 },
    radiusKm: 15,
    tz: "Europe/Lisbon",
    languages: ["pt"],
    adHoc: false,
    lastNight: null,
  };

  const somewhere: DirectoryMetro = {
    id: "somewhere",
    slug: "somewhere",
    name: "Somewhere",
    countryCode: "US",
    center: { lat: 40.7128, lng: -74.006 },
    radiusKm: 10,
    tz: "America/New_York",
    languages: ["en"],
    adHoc: true,
    lastNight: "2026-11-05",
  };

  const directory: CityDirectory = {
    v: 1,
    stamp: 1730588400000,
    builtAt: new Date("2026-11-03T12:00:00Z"),
    metros: [barcelona, lisbon, somewhere],
  };

  describe("encodeDirectory / decodeDirectory", () => {
    it("round-trips", () => {
      const encoded = encodeDirectory(directory);
      const decoded = decodeDirectory(encoded);
      expect(decoded).not.toBeNull();
      expect(decoded!.v).toBe(1);
      expect(decoded!.stamp).toBe(directory.stamp);
      expect(decoded!.builtAt).toBeInstanceOf(Date);
      expect(decoded!.builtAt.getTime()).toBe(directory.builtAt.getTime());
      expect(decoded!.metros).toHaveLength(3);
      expect(decoded!.metros[0]!.name).toBe("Barcelona");
      expect(decoded!.metros[1]!.name).toBe("Lisbon");
      expect(decoded!.metros[2]!.name).toBe("Somewhere");
    });

    it("returns null for invalid JSON", () => {
      expect(decodeDirectory("not json")).toBeNull();
    });

    it("returns null for v !== 1", () => {
      const invalid = { ...directory, v: 2 };
      const encoded = encodeShared(invalid);
      expect(decodeDirectory(encoded)).toBeNull();
    });

    it("returns null for non-finite stamp", () => {
      const invalid = { ...directory, stamp: "x" as unknown as never };
      const encoded = encodeShared(invalid);
      expect(decodeDirectory(encoded)).toBeNull();
    });

    it("returns null for missing builtAt", () => {
      const invalid = { ...directory, builtAt: undefined as unknown as never };
      const encoded = encodeShared(invalid);
      expect(decodeDirectory(encoded)).toBeNull();
    });

    it("returns null for metros not an array", () => {
      const invalid = { ...directory, metros: {} };
      const encoded = encodeShared(invalid);
      expect(decodeDirectory(encoded)).toBeNull();
    });

    it("returns null for adHoc not boolean", () => {
      const invalidMetro = { ...barcelona, adHoc: "no" as unknown as never };
      const invalidDir = { ...directory, metros: [invalidMetro] };
      const encoded = encodeShared(invalidDir);
      expect(decodeDirectory(encoded)).toBeNull();
    });

    it("returns null for malformed lastNight", () => {
      const invalidMetro = { ...barcelona, lastNight: "2026-1-3" };
      const invalidDir = { ...directory, metros: [invalidMetro] };
      const encoded = encodeShared(invalidDir);
      expect(decodeDirectory(encoded)).toBeNull();
    });

    it("returns null for languages containing non-string", () => {
      const invalidMetro = { ...barcelona, languages: [1] as unknown as never };
      const invalidDir = { ...directory, metros: [invalidMetro] };
      const encoded = encodeShared(invalidDir);
      expect(decodeDirectory(encoded)).toBeNull();
    });

    it("returns null for NaN in center.lat", () => {
      // Manually create JSON with null for lat
      const dirWithNaN = {
        ...directory,
        metros: [
          {
            ...barcelona,
            center: { lat: null, lng: 2.1734 },
          },
        ],
      };
      const encoded = JSON.stringify(dirWithNaN);
      expect(decodeDirectory(encoded)).toBeNull();
    });
  });

  describe("citiesFromDirectory", () => {
    it("filters out ad-hoc metros and preserves order", () => {
      // Create directory with non-alphabetical order
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [somewhere, lisbon, barcelona], // ad-hoc first
      };
      const cities = citiesFromDirectory(dir, new Date("2026-11-03T12:00:00Z"));
      expect(cities).toHaveLength(2);
      expect(cities[0]!.slug).toBe("lisbon"); // order preserved
      expect(cities[1]!.slug).toBe("barcelona");
    });

    it("computes hasListings correctly", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona, lisbon],
      };
      // Barcelona lastNight 2026-11-02
      // Test with now where currentNightDate is 2026-11-02 (should be true)
      const nowSame = new Date("2026-11-02T20:00:00Z"); // 21:00 in Madrid
      const citiesSame = citiesFromDirectory(dir, nowSame);
      expect(citiesSame[0]!.hasListings).toBe(true); // Barcelona
      expect(citiesSame[1]!.hasListings).toBe(false); // Lisbon (null)

      // Test with now where currentNightDate is 2026-11-03 (should be false)
      const nowLater = new Date("2026-11-03T20:00:00Z");
      const citiesLater = citiesFromDirectory(dir, nowLater);
      expect(citiesLater[0]!.hasListings).toBe(false);
    });

    it("respects 6am rule", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona],
      };
      // Barcelona lastNight "2026-11-02"
      // now = 2026-11-03T04:30:00Z (05:30 in Madrid, still night of 11-02)
      const early = new Date("2026-11-03T04:30:00Z");
      const citiesEarly = citiesFromDirectory(dir, early);
      expect(citiesEarly[0]!.hasListings).toBe(true);

      // now = 2026-11-03T05:30:00Z (06:30 in Madrid, night 11-03)
      const after6 = new Date("2026-11-03T05:30:00Z");
      const citiesAfter = citiesFromDirectory(dir, after6);
      expect(citiesAfter[0]!.hasListings).toBe(false);
    });

    it("mutating returned city does not affect directory", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona],
      };
      const cities = citiesFromDirectory(dir, new Date());
      cities[0]!.center.lat = 999;
      expect(dir.metros[0]!.center.lat).toBe(41.3851);
    });
  });

  describe("metroFromDirectory", () => {
    it("returns exact centre match", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona],
      };
      const result = metroFromDirectory(dir, barcelona.center);
      expect(result).not.toBeNull();
      expect(result!.slug).toBe("barcelona");
      expect(result!.distanceKm).toBeCloseTo(0, 6);
    });

    it("matches centre with small rounding difference", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona],
      };
      const slightlyOff = {
        lat: barcelona.center.lat + 0.000001,
        lng: barcelona.center.lng,
      };
      const result = metroFromDirectory(dir, slightlyOff);
      expect(result).not.toBeNull();
      expect(result!.slug).toBe("barcelona");
      expect(result!.distanceKm).toBeLessThan(0.001);
    });

    it("returns null for point 1 km away", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona],
      };
      // Move ~1 km north (1/111 km per degree latitude)
      const farPoint = {
        lat: barcelona.center.lat + 0.009,
        lng: barcelona.center.lng,
      };
      const result = metroFromDirectory(dir, farPoint);
      expect(result).toBeNull();
    });

    it("includes ad-hoc metros", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [somewhere],
      };
      const result = metroFromDirectory(dir, somewhere.center);
      expect(result).not.toBeNull();
      expect(result!.slug).toBe("somewhere");
    });

    it("returns null when two metros share same rounded centre", () => {
      const metro2: DirectoryMetro = {
        ...barcelona,
        id: "barcelona2",
        slug: "barcelona2",
      };
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona, metro2],
      };
      const result = metroFromDirectory(dir, barcelona.center);
      expect(result).toBeNull();
    });

    it("result does not contain adHoc or lastNight", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona],
      };
      const result = metroFromDirectory(dir, barcelona.center);
      expect(result).not.toBeNull();
      expect("adHoc" in result!).toBe(false);
      expect("lastNight" in result!).toBe(false);
    });

    it("mutating result does not affect directory", () => {
      const dir: CityDirectory = {
        v: 1,
        stamp: 123,
        builtAt: new Date(),
        metros: [barcelona],
      };
      const result = metroFromDirectory(dir, barcelona.center);
      expect(result).not.toBeNull();
      result!.languages.push("fr");
      expect(dir.metros[0]!.languages).toEqual(["ca", "es"]);
      result!.center.lat = 999;
      expect(dir.metros[0]!.center.lat).toBe(41.3851);
    });
  });
});
