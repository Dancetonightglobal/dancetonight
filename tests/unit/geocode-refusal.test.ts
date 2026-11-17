import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { geoapifyRefusal, geoapifyGeocoder } from "@/src/pipeline/geocode";
import { createPoliteHttp } from "@/src/pipeline/http";
import { formatVenueReport } from "@/src/pipeline/venue-checks";

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

// Helper to build Geoapify response
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

describe("geoapifyRefusal", () => {
  it("returns null for an accepted building answer inside the metro", () => {
    const body = answer({});
    expect(geoapifyRefusal(body, NYC)).toBeNull();
  });

  it('returns "no answer" for empty results or non-object', () => {
    expect(geoapifyRefusal({ results: [] }, NYC)).toBe("no answer");
    expect(geoapifyRefusal("x", NYC)).toBe("no answer");
  });

  it('returns "too vague" for street without housenumber', () => {
    const body = answer({ result_type: "street", housenumber: undefined });
    expect(geoapifyRefusal(body, NYC)).toBe("too vague (street, confidence 0.95)");
  });

  it('returns "low confidence" for building with low confidence', () => {
    const body = answer({ result_type: "building", rank: { confidence: 0.456 } });
    expect(geoapifyRefusal(body, NYC)).toBe("low confidence 0.46 (building)");
  });

  it('returns "outside the metro" for confident building far outside', () => {
    const body = answer({ lat: 42.36, lon: -71.06 });
    const refusal = geoapifyRefusal(body, NYC);
    expect(refusal).toMatch(/^outside the metro \(42\.3600, -71\.0600\)$/);
  });
});

describe("geoapifyGeocoder with refusal", () => {
  it("returns refusal reason when geocode returns null", async () => {
    const body = answer({ result_type: "street", housenumber: undefined });
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async (req) => {
        calls += 1;
        return { url: req.url, status: 200, headers: {}, body: JSON.stringify(body) };
      },
    });
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    expect(await geocoder.geocode("37 W 26th St, New York")).toBeNull();
    expect(await geocoder.refusal!("37 W 26th St, New York")).toBe(
      "too vague (street, confidence 0.95)",
    );
    expect(calls).toBe(1);
    expect(geocoder.requests()).toBe(1);
  });

  it('returns "request failed" on transport error', async () => {
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async () => {
        throw new Error("network error");
      },
    });
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    expect(await geocoder.refusal!("37 W 26th St, New York")).toBe("request failed");
    expect(geocoder.requests()).toBe(1);
  });
});

describe("formatVenueReport with refused addresses", () => {
  it("includes refused addresses in the report", () => {
    const report = {
      moved: [],
      placeholders: [],
      removed: [],
      unchecked: [],
      refused: ["Av. Víctor Hugo 178: too vague (street, confidence 0.9)"],
    };
    const formatted = formatVenueReport(report);
    expect(formatted).toContain("Geocoder refused 1 address:");
    expect(formatted).toContain("Av. Víctor Hugo 178: too vague (street, confidence 0.9)");
  });

  it("shows up to 40 refused addresses and a note for more", () => {
    const refused = Array.from({ length: 45 }, (_, i) => `Address ${i}: reason`);
    const report = {
      moved: [],
      placeholders: [],
      removed: [],
      unchecked: [],
      refused,
    };
    const formatted = formatVenueReport(report);
    expect(formatted).toContain("Geocoder refused 45 addresses:");
    // Count the number of bullet lines
    const bulletLines = (formatted.match(/\n  - /g) || []).length;
    // Should be 40 bullets for refused addresses
    expect(bulletLines).toBe(40);
    expect(formatted).toContain("and 5 more");
  });

  it("early return includes refused addresses", () => {
    const report = {
      moved: [],
      placeholders: [],
      removed: [],
      unchecked: [],
      refused: ["One address: reason"],
    };
    const formatted = formatVenueReport(report);
    expect(formatted).toContain("Geocoder refused 1 address:");
    expect(formatted).toContain("One address: reason");
  });
});
