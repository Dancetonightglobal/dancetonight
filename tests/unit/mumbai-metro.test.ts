// Mumbai is Greater Mumbai (D-620): the Mumbai City and Mumbai Suburban districts (Who's On First counties,
// Mesoshapes geometry, CC BY), widened ~300 m seaward; Thane, Navi Mumbai and Mira Road are outside. Its
// neighbourhoods are our own: 68 common names, each the area nearest its centre point. Points are each venue's
// street address (2026-10-31).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const MUMBAI: Metro = {
  id: "m",
  slug: "mumbai",
  name: "Mumbai",
  countryCode: "IN",
  center: { lat: 18.9398, lng: 72.8355 },
  radiusKm: 40,
  tz: "Asia/Kolkata",
  languages: ["en", "hi", "mr"],
};

describe("Greater Mumbai (D-620)", () => {
  it.each([
    ["Cafe Mondegar, Colaba Causeway", 18.9246, 72.8317, "Colaba"],
    ["Gateway of India", 18.922, 72.8347, "Colaba"],
    ["Antisocial, Khar West", 19.0712, 72.8366, "Khar West"],
    ["Bonobo, Bandra West", 19.0647, 72.8336, "Bandra West"],
    ["Phoenix Mills, Lower Parel", 18.9946, 72.8258, "Lower Parel"],
    ["Kitty Su, The Lalit, Andheri East", 19.1087, 72.8668, "Andheri East"],
    ["Jio World Centre, Bandra Kurla Complex", 19.0656, 72.8681, "Bandra Kurla Complex"],
    ["Hiranandani Gardens, Powai", 19.1176, 72.906, "Powai"],
    ["Worli Sea Face", 19.0105, 72.8155, "Worli"],
    ["Juhu Beach", 19.099, 72.8255, "Juhu"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(insideMetro(MUMBAI, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Thane station", 19.186, 72.975],
    ["Vashi, Navi Mumbai", 19.0771, 72.9987],
    ["Mira Road", 19.2813, 72.8686],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(insideMetro(MUMBAI, { lat, lng })).toBe(false);
  });

  it("names common neighbourhoods, never Who's On First's survey-village names", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const name of [
      "Colaba",
      "Bandra West",
      "Andheri West",
      "Powai",
      "Borivali West",
      "Mulund",
    ]) {
      expect(names.has(name)).toBe(true);
    }
    for (const name of ["Bandra E", "Kopri", "Kolekalyan", "Kondivate"]) {
      expect(names.has(name)).toBe(false);
    }
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.mumbai?.map((s) => s.url)).toContain("https://ra.co/graphql?area=328");
    expect(METRO_RETIRED_SOURCES.mumbai).toBeDefined();
    expect(KNOWN_VENUES.mumbai).toBeDefined();
  });
});
