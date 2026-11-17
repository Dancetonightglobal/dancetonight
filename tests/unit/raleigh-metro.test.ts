// Raleigh is Wake County (D-600) and Durham County (D-601): the Census TIGER outlines, Who's On First
// neighbourhoods with the two counties' towns as the coarser fallback, North Carolina addresses, 275-277 ZIP
// codes, and the towns around it that source titles name. Points are each venue's street address, from the
// Census geocoder (2026-10-31).
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

const RALEIGH: Metro = {
  id: "m",
  slug: "raleigh",
  name: "Raleigh",
  countryCode: "US",
  center: { lat: 35.7804, lng: -78.6391 },
  radiusKm: 45,
  tz: "America/New_York",
  languages: ["en", "es"],
};

describe("Wake County (D-600)", () => {
  it.each([
    ["Lincoln Theatre, 126 E Cabarrus St", 35.774136, -78.637965, "Fayetteville Street"],
    ["Neptunes Parlour, 14 W Martin St", 35.77699, -78.639445, "Fayetteville Street"],
    ["510 Glenwood Ave", 35.78642, -78.647188, "Glenwood South"],
    ["2010 Hillsborough St", 35.786195, -78.662527, "Fairmont"],
    ["101 N Academy St, Cary", 35.787377, -78.781286, "Cary"],
    ["Wake Forest", 35.9799, -78.5097, "Wake Forest"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(metroPartAt("raleigh", { lat, lng })).toBe("Wake County");
    expect(insideMetro(RALEIGH, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Motorco, 723 Rigsbee Ave, Durham", 36.002431, -78.900073, "Durham"],
    ["Durham", 35.994, -78.8986, "Durham"],
  ])("puts %s inside, in Durham County (D-601)", (_name, lat, lng, hood) => {
    expect(metroPartAt("raleigh", { lat, lng })).toBe("Durham County");
    expect(insideMetro(RALEIGH, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Hillsborough", 36.0754, -79.0997],
    ["Chapel Hill", 35.9132, -79.0558],
    ["Clayton", 35.6507, -78.4564],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("raleigh", { lat, lng })).toBeNull();
    expect(insideMetro(RALEIGH, { lat, lng })).toBe(false);
  });

  it("leaves out the City of Raleigh as a name and keeps the towns", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    expect(names.has("Raleigh")).toBe(false);
    expect(names.has("East")).toBe(false);
    for (const town of ["Cary", "Apex", "Garner", "Morrisville", "Holly Springs", "Durham"]) {
      expect(names.has(town)).toBe(true);
    }
  });
});

describe("Raleigh in the shared tables", () => {
  it("reads North Carolina addresses and 275-277 ZIP codes", () => {
    expect(METRO_REGIONS.raleigh).toEqual(["NC"]);
    expect(METRO_POSTCODE_PREFIXES.raleigh).toEqual(["275", "276", "277"]);
  });

  it("names the towns around it, and none that is also a Wake or Durham County place", () => {
    const towns = METRO_OUTSIDE_TOWNS.raleigh ?? [];
    for (const town of ["Chapel Hill", "Carrboro", "Hillsborough", "Greensboro", "Charlotte"]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Durham",
      "Research Triangle Park",
      "RTP",
      "Cary",
      "Apex",
      "Morrisville",
      "Garner",
      "Clayton",
      "Oxford",
      "Greenville",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Swing Dance - Chapel Hill", "Chapel Hill"],
    ["Contra Dance in Carrboro", "Carrboro"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("raleigh", title)).toBe(town);
  });

  it.each([
    "Cary Contra Dance",
    "Shag Night in Wake Forest",
    "Triangle Swing Dance",
    "Salsa Night at Motorco, Durham",
  ])("keeps %s in Raleigh", (title) => {
    expect(titleNamesOutsideTown("raleigh", title)).toBeNull();
  });

  it("wires its sources, retired addresses and known venues in", () => {
    // Resident Advisor's state-wide North Carolina area (D-505, D-600).
    expect(METRO_SOURCES.raleigh?.map((s) => s.url)).toContain("https://ra.co/graphql?area=123");
    // 8 Count Country's lessons page wrote lesson-only rows beside DanceGumbo's (D-603).
    expect(METRO_RETIRED_SOURCES.raleigh?.map((s) => s.url)).toEqual([
      "https://www.8countcountry.com/lessons",
      "https://chapelofbones.com/",
      "https://www.icsnc.org/events/",
      "https://apexaquavitae.com/",
      "https://bccraleigh.org/event/read-write-run-5k/",
      "https://www.honeygirlmeadery.com/",
      "https://www.livingartscollective.com/dancewave/",
      "https://motorcomusic.com/calendar/",
    ]);
    expect(METRO_SOURCES.raleigh?.map((s) => s.url)).not.toContain(
      "https://www.8countcountry.com/lessons",
    );
    expect(KNOWN_VENUES.raleigh?.map((v) => v.address)).toEqual([
      "5538 Leadmine Rd, Raleigh, NC 27612",
      "10810 Globe Rd, Morrisville, NC 27560",
      "1020 Ryan Rd, Cary, NC 27511",
      "301 Fenton Gateway Dr, Cary, NC 27511",
      "2603 S Miami Blvd, Durham, NC 27703",
    ]);
  });
});
