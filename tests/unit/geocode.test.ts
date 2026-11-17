import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  acceptGeoapify,
  geoapifyGeocoder,
  geoapifyUrl,
  isPlaceholderAddress,
  normalizeAddress,
} from "@/src/pipeline/geocode";
import { createPoliteHttp } from "@/src/pipeline/http";

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

// Built in Geoapify's documented search response shape; re-recorded on the first live run.
const answer = (over: Record<string, unknown>) => ({
  results: [
    {
      lat: 40.7441,
      lon: -73.9899,
      result_type: "building",
      housenumber: "37",
      rank: { confidence: 0.95 },
      ...over,
    },
  ],
});

describe("the Geoapify geocoder", () => {
  it("asks within the metro's circle", () => {
    const url = new URL(geoapifyUrl("37 W 26th St, New York", NYC, "REDACTED"));
    expect(url.searchParams.get("filter")).toBe("circle:-74.006,40.7128,50000");
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("accepts only a specific, confident answer inside the metro", () => {
    expect(acceptGeoapify(answer({}), NYC)).toEqual({ lat: 40.7441, lng: -73.9899 });
    expect(
      acceptGeoapify(answer({ result_type: "street", housenumber: "37" }), NYC),
    ).not.toBeNull();
    expect(
      acceptGeoapify(answer({ result_type: "street", housenumber: undefined }), NYC),
    ).toBeNull();
    expect(acceptGeoapify(answer({ result_type: "city" }), NYC)).toBeNull();
    expect(acceptGeoapify(answer({ rank: { confidence: 0.4 } }), NYC)).toBeNull();
    expect(acceptGeoapify(answer({ lat: 42.36, lon: -71.06 }), NYC)).toBeNull();
    expect(acceptGeoapify({ results: [] }, NYC)).toBeNull();
  });

  it("knows a placeholder address from a real one (D-071)", () => {
    for (const placeholder of [
      // Run 26: a model read of nuevotangoarts.org, geocoded to the Bronx.
      "123 Main St, New York, NY",
      "1 Main Street",
      "123 Main St. Suite 4, Anytown",
      "1234 Main Street New York",
      "123 Fake St, Springfield",
      "42 Example Avenue",
      "123 Anywhere Rd",
      "123 Street",
      "Street address, New York",
      "Anytown, USA",
      "TBA",
      "Location TBA, Brooklyn",
      "To be announced",
    ])
      expect(isPlaceholderAddress(placeholder), placeholder).toBe(true);
    for (const real of [
      "610 W. 56th Street, New York, NY, 10019",
      "319 Frost St, Brooklyn, NY, 11222",
      "350 Main Street, White Plains, NY",
      "12 Main St, Hackensack, NJ",
      "123 St Marks Pl, New York, NY",
      "123 W 18th St",
      "37 W 26th St",
      "140 2nd Ave",
      "Forest Park Dr, Woodhaven, NY",
      "",
    ])
      expect(isPlaceholderAddress(real), real).toBe(false);
  });

  it("never asks about a placeholder address", async () => {
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async (req) => {
        calls += 1;
        return { url: req.url, status: 200, headers: {}, body: JSON.stringify(answer({})) };
      },
    });
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    expect(await geocoder.geocode("123 Main St, New York, NY")).toBeNull();
    expect(calls).toBe(0);
    expect(geocoder.requests()).toBe(0);
  });

  it("gives the building-level point only for a building, from the same one request", async () => {
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async (req) => {
        calls += 1;
        const type = req.url.includes("Terrace") ? "amenity" : "building";
        return {
          url: req.url,
          status: 200,
          headers: {},
          body: JSON.stringify(answer({ result_type: type })),
        };
      },
    });
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    const point = { lat: 40.7441, lng: -73.9899 };
    expect(await geocoder.geocode("37 W 26th St, New York")).toEqual(point);
    expect(await geocoder.building("37 W 26th St, New York")).toEqual(point);
    expect(await geocoder.geocode("Bethesda Terrace, New York")).toEqual(point);
    expect(await geocoder.building("Bethesda Terrace, New York")).toBeNull();
    expect(calls).toBe(2);
  });

  it("asks once per address for the whole run", async () => {
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async (req) => {
        calls += 1;
        return { url: req.url, status: 200, headers: {}, body: JSON.stringify(answer({})) };
      },
    });
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    const [a, b] = await Promise.all([
      geocoder.geocode("37 W 26th St, New York"),
      geocoder.geocode("37 w. 26th st new york"),
    ]);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
    expect(normalizeAddress("37 W. 26th St.,  New York")).toBe("37 w 26th st new york");
  });
});
