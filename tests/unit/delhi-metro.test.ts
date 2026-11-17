// Delhi is NCT Delhi plus Gurugram district and Gautam Buddh Nagar (Noida) (D-1140): Who's On First region 85672123 and
// counties 890510775 and 890508371 (CC BY); Ghaziabad, Faridabad and Sonipat are outside. Its neighbourhoods are our
// own: 93 common names, each the part of its district nearest its centre point. Points are approximate venue and
// landmark points (2026-11-07), each well inside its area.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const DELHI: Metro = {
  id: "m",
  slug: "delhi",
  name: "Delhi",
  countryCode: "IN",
  center: { lat: 28.6315, lng: 77.2167 },
  radiusKm: 75,
  tz: "Asia/Kolkata",
  languages: ["en", "hi", "pa"],
};

describe("Delhi, Gurugram and Noida (D-1140)", () => {
  it.each([
    ["Central Park, Connaught Place", 28.6315, 77.2167, "Connaught Place"],
    ["Hauz Khas Village", 28.5535, 77.194, "Hauz Khas"],
    ["Khan Market", 28.6002, 77.227, "Khan Market"],
    ["Shahpur Jat", 28.549, 77.216, "Shahpur Jat"],
    ["Rajouri Garden", 28.642, 77.122, "Rajouri Garden"],
    ["Paharganj Main Bazar", 28.643, 77.212, "Paharganj"],
    ["Ambience Mall, Vasant Kunj", 28.541, 77.155, "Vasant Kunj"],
    ["Aerocity", 28.549, 77.121, "Mahipalpur"],
    ["CyberHub, Gurugram", 28.495, 77.089, "DLF Phase 2"],
    ["Atta Market, Noida Sector 18", 28.57, 77.321, "Noida Sector 18"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(insideMetro(DELHI, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Ghaziabad", 28.6692, 77.4538],
    ["Faridabad", 28.4089, 77.3178],
    ["Sonipat", 28.9931, 77.0151],
    ["Bahadurgarh", 28.6928, 76.935],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(insideMetro(DELHI, { lat, lng })).toBe(false);
  });

  it("names common areas, never Who's On First's misplaced polygons", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const name of [
      "Connaught Place",
      "Hauz Khas",
      "Greater Kailash",
      "DLF Phase 1",
      "Noida Sector 62",
      "Greater Noida",
    ]) {
      expect(names.has(name)).toBe(true);
    }
    for (const name of ["Safdarjang Development Area", "Hauz Rani", "Tatarpur", "Meena Bagh"]) {
      expect(names.has(name)).toBe(false);
    }
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.delhi?.map((s) => s.url)).toContain("https://ra.co/graphql?area=324");
    expect(METRO_RETIRED_SOURCES.delhi).toBeDefined();
    expect(KNOWN_VENUES.delhi).toBeDefined();
  });
});
