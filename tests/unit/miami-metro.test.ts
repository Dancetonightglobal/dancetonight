// Miami is Miami-Dade County (D-320): the Census TIGER outline with its water areas (Biscayne Bay, the
// barrier islands), Who's On First neighbourhoods with WOF localities as the coarser fallback, Florida
// addresses, 330-332 ZIP codes, and the towns around it that source titles name. Points are each venue's
// street address (2026-10-29).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  METRO_REGIONS,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const MIAMI: Metro = {
  id: "m",
  slug: "miami",
  name: "Miami",
  countryCode: "US",
  center: { lat: 25.7797, lng: -80.1897 },
  radiusKm: 60,
  tz: "America/New_York",
  languages: ["en", "es"],
};

describe("Miami-Dade County (D-320)", () => {
  it.each([
    ["Club Space, 34 NE 11th St", 25.7841, -80.1932, "Park West"],
    ["E11EVEN, 29 NE 11th St", 25.7848, -80.1935, "Park West"],
    ["Ball & Chain, 1513 SW 8th St", 25.7655, -80.219, "Little Havana"],
    ["Wynwood Walls, 2520 NW 2nd Ave", 25.8011, -80.1993, "Wynwood"],
    ["Do Not Sit On The Furniture, 423 16th St, Miami Beach", 25.7889, -80.1365, "South Beach"],
    ["LIV, 4441 Collins Ave, Miami Beach", 25.8188, -80.1222, "Miami Beach"],
    ["Giralda Plaza, Coral Gables", 25.7509, -80.2593, "Downtown Coral Gables"],
    ["Homestead", 25.4687, -80.4776, "Homestead"],
    // WOF's Medley outline covered eastern Doral; it is left out (2026-10-29).
    ["Copper Blues, CityPlace Doral, 3450 NW 83rd Ave", 25.8085, -80.333, "Doral"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(metroPartAt("miami", { lat, lng })).toBe("Miami-Dade County");
    expect(insideMetro(MIAMI, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it("keeps the county's water inside (Biscayne Bay)", () => {
    expect(insideMetro(MIAMI, { lat: 25.6, lng: -80.25 })).toBe(true);
  });

  it.each([
    ["Fort Lauderdale", 26.1224, -80.1373],
    ["Hollywood", 26.0112, -80.1495],
    ["Hallandale Beach", 25.9812, -80.1484],
    ["Key Largo", 25.0865, -80.4473],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("miami", { lat, lng })).toBeNull();
    expect(insideMetro(MIAMI, { lat, lng })).toBe(false);
  });

  it("leaves out WOF's business zones and the City of Miami as a name", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    for (const zone of [
      "Club Row",
      "Miami Fashion District",
      "Wynwood Art District",
      "Miami Free Zone",
    ]) {
      expect(names.has(zone)).toBe(false);
    }
    expect(names.has("Miami")).toBe(false);
    expect(names.has("Hialeah")).toBe(true);
    expect(names.has("Doral")).toBe(true);
  });
});

describe("Miami in the shared tables", () => {
  it("reads Florida addresses and 330-332 ZIP codes", () => {
    expect(METRO_REGIONS.miami).toEqual(["FL"]);
    expect(METRO_POSTCODE_PREFIXES.miami).toEqual(["330", "331", "332"]);
  });

  it("names the towns around it, and none that is also a Miami-Dade place", () => {
    const towns = METRO_OUTSIDE_TOWNS.miami ?? [];
    for (const town of [
      "Fort Lauderdale",
      "Hallandale Beach",
      "Pembroke Pines",
      "Boca Raton",
      "Key West",
    ]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Hollywood",
      "Miramar",
      "Miami Gardens",
      "Miami Lakes",
      "Golden Beach",
      "Kendall",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Salsaholics: Broward Rooftop Edition at ALOFT Hotel Ft. Lauderdale!", "Ft. Lauderdale"],
    ["THE BACHATA OVERDOSE SOCIAL, Hallandale Beach", "Hallandale Beach"],
    ["Live music at Hollywood Beach", "Hollywood Beach"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("miami", title)).toBe(town);
  });

  it.each([
    "Hollywood Nights Latin Party",
    "Miami Gardens Salsa Social",
    "PIANO BAR @ Crandon Golf, Key Biscayne",
  ])("keeps %s in Miami", (title) => {
    expect(titleNamesOutsideTown("miami", title)).toBeNull();
  });

  it("wires its sources, retired addresses and known venues in", () => {
    expect(METRO_SOURCES.miami?.length).toBeGreaterThan(0);
    expect(METRO_RETIRED_SOURCES.miami?.map((gone) => gone.url)).toContain(
      "https://www.11miami.com/events",
    );
    expect(KNOWN_VENUES.miami?.[0]?.address).toBe("650 Curtiss Parkway, Miami Springs, FL 33166");
  });
});
