// New York is the five boroughs (D-084), by NYC Planning's outlines with their water areas.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { geoapifyAnswer, geoapifyGeocoder, geoapifyOutside } from "@/src/pipeline/geocode";
import { createPoliteHttp } from "@/src/pipeline/http";

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};

describe("the five boroughs", () => {
  it.each([
    ["Barclays Center", 40.6826, -73.9754, "Brooklyn"],
    ["the Rooftop at Pier 17", 40.7055, -74.0017, "Manhattan"],
    ["Terminal 5", 40.7697, -73.9929, "Manhattan"],
    ["Governors Island", 40.6895, -74.0168, "Manhattan"],
    ["Flushing Meadows Corona Park", 40.7498, -73.8448, "Queens"],
    ["Rockaway Beach", 40.586, -73.811, "Queens"],
    ["City Island", 40.8468, -73.7866, "Bronx"],
    ["St George", 40.6437, -74.0736, "Staten Island"],
  ])("puts %s inside", (_name, lat, lng, part) => {
    expect(metroPartAt("nyc", { lat, lng })).toBe(part);
    expect(insideMetro(NYC, { lat, lng })).toBe(true);
  });

  it.each([
    ["Prudential Center, Newark", 40.7334, -74.1711],
    ["Jersey City", 40.7178, -74.0431],
    ["Hoboken", 40.744, -74.0324],
    ["Williams Center, Rutherford", 40.8265, -74.1068],
    ["Yonkers", 40.9312, -73.8988],
    ["UBS Arena, Elmont", 40.7112, -73.7264],
    ["Le Pari, Fanwood", 40.6409, -74.3832],
  ])("leaves %s outside, though the 40 km circle takes it in", (_name, lat, lng) => {
    expect(insideMetro(NYC, { lat, lng })).toBe(false);
  });

  it("falls back to the circle for a metro with no outline", () => {
    // "atlantis" has no outline (Paris and Tokyo got one, D-1040, D-1221).
    const atlantis = { slug: "atlantis", center: { lat: 35.6812, lng: 139.7671 }, radiusKm: 30 };
    expect(metroPartAt("atlantis", { lat: 35.68, lng: 139.77 })).toBeUndefined();
    expect(insideMetro(atlantis, { lat: 35.72, lng: 139.8 })).toBe(true);
    expect(insideMetro(atlantis, { lat: 36.4, lng: 139.8 })).toBe(false);
  });
});

describe("the geocoder and the outline", () => {
  const answer = (lat: number, lon: number, extra: Record<string, unknown> = {}) => ({
    results: [{ lat, lon, result_type: "building", rank: { confidence: 1 }, ...extra }],
  });

  it("places an address in the boroughs, and none in Yonkers though it is inside the circle", () => {
    expect(geoapifyAnswer(answer(40.7697, -73.9929), NYC)?.point).toEqual({
      lat: 40.7697,
      lng: -73.9929,
    });
    expect(geoapifyAnswer(answer(40.9312, -73.8988), NYC)).toBeNull();
  });

  it("names the place a confident answer puts outside the boroughs", () => {
    expect(
      geoapifyOutside(answer(40.9312, -73.8988, { city: "Yonkers", state_code: "NY" }), NYC),
    ).toBe("yonkers, ny");
    expect(geoapifyOutside(answer(40.7697, -73.9929), NYC)).toBeNull();
    // An unsure answer says nothing: the listing stays (coverage first).
    expect(
      geoapifyOutside(
        { results: [{ lat: 40.9312, lon: -73.8988, rank: { confidence: 0.3 } }] },
        NYC,
      ),
    ).toBeNull();
  });

  it("tells the ingest that a Yonkers address is not in New York, from the same request", async () => {
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async (req) => {
        calls += 1;
        return {
          url: req.url,
          status: 200,
          headers: {},
          body: JSON.stringify(answer(40.9312, -73.8988, { city: "Yonkers", state_code: "NY" })),
        };
      },
    });
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    expect(await geocoder.geocode("1 Larkin Plaza, Yonkers, NY")).toBeNull();
    expect(await geocoder.elsewhere!("1 Larkin Plaza, Yonkers, NY")).toBe("yonkers, ny");
    expect(calls).toBe(1);
  });
});

const LONDON: Metro = {
  id: "l",
  slug: "london",
  name: "London",
  countryCode: "GB",
  center: { lat: 51.5074, lng: -0.1278 },
  radiusKm: 35,
  tz: "Europe/London",
  languages: ["en"],
};

describe("Greater London (D-200)", () => {
  it.each([
    ["the Thames at Westminster Bridge", 51.5008, -0.1219, "Westminster"],
    ["Ministry of Sound", 51.4979, -0.0997, "Southwark"],
    ["the Thames at Woolwich", 51.495, 0.07, "Greenwich"],
    ["Heathrow", 51.47, -0.4543, "Hillingdon"],
  ])("puts %s inside", (_name, lat, lng, part) => {
    expect(metroPartAt("london", { lat, lng })).toBe(part);
    expect(insideMetro(LONDON, { lat, lng })).toBe(true);
  });

  it.each([
    ["Watford", 51.6565, -0.3903],
    ["Dartford", 51.4462, 0.2187],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("london", { lat, lng })).toBeNull();
    expect(insideMetro(LONDON, { lat, lng })).toBe(false);
  });
});
