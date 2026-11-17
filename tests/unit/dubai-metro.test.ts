// Dubai is the emirate (D-1060): the main land, Hatta exclave, islands, outline in config/metro-bounds/dubai.json.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro } from "@/src/domain/metro-bounds";
import { RA_AREAS } from "@/config/sources/ra";

const DUBAI: Metro = {
  id: "m",
  slug: "dubai",
  name: "Dubai",
  countryCode: "AE",
  center: { lat: 25.1972, lng: 55.2744 },
  radiusKm: 105,
  tz: "Asia/Dubai",
  languages: ["en", "ar"],
};

describe("the Dubai emirate (D-1060)", () => {
  it.each([
    ["Burj Khalifa, centre", 25.1972, 55.2744],
    ["Dubai Marina", 25.0805, 55.1403],
    ["Deira", 25.2697, 55.3095],
    ["Al Quoz / Alserkal Avenue", 25.1418, 55.2265],
    ["Atlantis, Palm Jumeirah", 25.1304, 55.1171],
    ["The World islands", 25.223, 55.17],
    ["Bluewaters", 25.08, 55.12],
    ["Hatta", 24.7969, 56.1172],
  ])("puts %s inside", (_name, lat, lng) => {
    expect(insideMetro(DUBAI, { lat, lng })).toBe(true);
  });

  it.each([
    ["Sharjah centre", 25.3463, 55.4209],
    ["Sharjah Al Nahda", 25.301, 55.373],
    ["Ajman", 25.4052, 55.5136],
    ["Abu Dhabi city", 24.4539, 54.3773],
    ["Ghantoot, Abu Dhabi", 24.86, 54.85],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(DUBAI, { lat, lng })).toBe(false);
  });
});

describe("Dubai in the shared tables", () => {
  it("reads postcodes (none yet)", () => {
    expect(METRO_POSTCODE_PREFIXES.dubai).toBeUndefined();
  });

  it("lists outside towns, never including districts or areas inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.dubai ?? [];
    expect(towns).toContain("Sharjah");
    expect(towns).toContain("Abu Dhabi");
    expect(towns).not.toContain("Jumeirah");
    expect(towns).not.toContain("Hatta");
    expect(towns).not.toContain("Beirut");
  });

  it.each([
    ["Party in Sharjah", "Sharjah"],
    ["Abu Dhabi Festival", "Abu Dhabi"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("dubai", title)).toBe(town);
  });

  it.each([
    ["Dubai Marina Beach Party", null],
    ["Hatta Mountain Adventure", null],
  ])("keeps %s in Dubai", (title, expected) => {
    expect(titleNamesOutsideTown("dubai", title)).toBe(expected);
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.dubai).toBeDefined();
    expect(METRO_RETIRED_SOURCES.dubai).toBeDefined();
    expect(KNOWN_VENUES.dubai).toBeInstanceOf(Array);
  });

  it("has RA area 136", () => {
    expect(RA_AREAS.dubai).toBe(136);
  });

  it("reads Resident Advisor, the Salsa Vida Dubai guide and the venue pages", () => {
    const sources = METRO_SOURCES.dubai ?? [];
    expect(sources).toHaveLength(23);
    const ra = sources.find((s) => s.platform === "ra");
    expect(ra?.label).toBe("Resident Advisor Dubai");
    const sv = sources.find((s) => s.label === "Salsa Vida Dubai");
    expect(sv?.url).toBe("https://www.salsavida.com/guides/united-arab-emirates/dubai/");
    expect(sv?.trustTier).toBe("directory");
    expect(sv?.mixedCalendar).toBe(false);
  });
});
