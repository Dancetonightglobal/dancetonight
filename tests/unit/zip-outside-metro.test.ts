// A New York listing whose ZIP is not a New York City ZIP is outside the metro (D-194).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { geoapifyGeocoder, postcodeOutsideMetro } from "@/src/pipeline/geocode";
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

describe("postcodeOutsideMetro", () => {
  it.each([
    ["20 Mountain View Ave, Woodstock, 12498", "ZIP 12498"],
    ["29 Wurts St, Kingston, New York 12401", "ZIP 12401"],
    ["Hoboken, NJ 07030", "ZIP 07030"],
  ])("%s is outside New York City", (address, expected) => {
    expect(postcodeOutsideMetro(address, NYC)).toBe(expected);
  });

  it.each([
    "239 W 14th St, New York, NY 10011",
    "31-30 Ditmars Blvd, Astoria, NY 11105",
    "63 Flushing Ave, Brooklyn, NY 11205",
    "10 Theatre Alley, New York, NY 10038-1234",
    "Suite 12498, 239 W 14th St, NY 10011",
    "239 W 14th St",
  ])("%s is not outside by its ZIP", (address) => {
    expect(postcodeOutsideMetro(address, NYC)).toBeNull();
  });

  it("does not check a metro without prefixes", () => {
    // A metro with no METRO_POSTCODE_PREFIXES row (London has one since 2026-10-28).
    const paris = { slug: "paris", countryCode: "FR" };
    expect(postcodeOutsideMetro("12 Rue de Rivoli, 75004 Paris", paris)).toBeNull();
  });
});

describe("geoapifyGeocoder elsewhere", () => {
  function counting(): { http: ReturnType<typeof createPoliteHttp>; calls: () => number } {
    let calls = 0;
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async (req) => {
        calls += 1;
        return { url: req.url, status: 200, headers: {}, body: JSON.stringify({ results: [] }) };
      },
    });
    return { http, calls: () => calls };
  }

  it("answers an outside ZIP without a request", async () => {
    const { http, calls } = counting();
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    expect(await geocoder.elsewhere?.("20 Mountain View Ave, Woodstock, 12498")).toBe("ZIP 12498");
    expect(calls()).toBe(0);
  });

  it("asks the geocoder when the ZIP is a New York City one, or there is none", async () => {
    const { http, calls } = counting();
    const geocoder = geoapifyGeocoder(http, NYC, "k");
    expect(await geocoder.elsewhere?.("37 W 26th St, New York, NY 10010")).toBeNull();
    expect(await geocoder.elsewhere?.("239 W 14th St, New York")).toBeNull();
    expect(calls()).toBe(2);
  });
});
