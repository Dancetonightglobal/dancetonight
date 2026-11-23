// Austin is Travis County and the City of Austin's parts in Williamson and Hays Counties (D-1180): the Census
// TIGER outlines, Who's On First neighbourhoods with Travis County's towns as the coarser fallback, Texas
// addresses, 786-787 ZIP codes, and the towns around it that source titles name. Points are approximate venue and
// town-centre coordinates checked against the outline (2026-11-07).
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

const AUSTIN: Metro = {
  id: "m",
  slug: "austin",
  name: "Austin",
  countryCode: "US",
  center: { lat: 30.2747, lng: -97.7404 },
  radiusKm: 50,
  tz: "America/Chicago",
  languages: ["en", "es"],
};

describe("Travis County (D-1180)", () => {
  it.each([
    ["Texas State Capitol, 1100 Congress Ave", 30.2747, -97.7404, "Downtown"],
    ["Broken Spoke, 3201 S Lamar Blvd", 30.2412, -97.784, "South Lamar"],
    ["Continental Club, 1315 S Congress Ave", 30.2502, -97.7494, "South River City"],
    ["The Domain, 11410 Century Oaks Terrace", 30.4021, -97.7253, "North Burnet"],
    ["Pflugerville", 30.4394, -97.62, "Pflugerville"],
    ["Lakeway", 30.3638, -97.9795, "Lakeway"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(metroPartAt("austin", { lat, lng })).toBe("Travis County");
    expect(insideMetro(AUSTIN, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it("puts City of Austin's Williamson County part inside, in City of Austin", () => {
    const lat = 30.47;
    const lng = -97.79;
    expect(metroPartAt("austin", { lat, lng })).toBe("City of Austin");
    expect(insideMetro(AUSTIN, { lat, lng })).toBe(true);
  });

  it.each([
    ["Round Rock", 30.5083, -97.6789],
    ["San Marcos", 29.8833, -97.9414],
    ["Cedar Park", 30.5052, -97.8203],
    ["Georgetown", 30.6333, -97.6773],
    ["Kyle", 29.9891, -97.8772],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("austin", { lat, lng })).toBeNull();
    expect(insideMetro(AUSTIN, { lat, lng })).toBe(false);
  });

  it("leaves out the City of Austin as a name and keeps the towns", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    expect(names.has("Austin")).toBe(false);
    expect(names.has("Ut")).toBe(false);
    expect(names.has("Town Lake")).toBe(false);
    for (const town of ["Downtown", "South Lamar", "Rosewood", "Zilker", "Pflugerville"]) {
      expect(names.has(town)).toBe(true);
    }
  });
});

describe("Austin in the shared tables", () => {
  it("reads Texas addresses and 786-787 ZIP codes", () => {
    expect(METRO_REGIONS.austin).toEqual(["TX"]);
    expect(METRO_POSTCODE_PREFIXES.austin).toEqual(["786", "787"]);
  });

  it("names the towns around it, and none that is also a Travis County place", () => {
    const towns = METRO_OUTSIDE_TOWNS.austin ?? [];
    for (const town of ["Round Rock", "Georgetown, TX", "Cedar Park", "San Antonio"]) {
      expect(towns).toContain(town);
    }
    // Bare "Houston" is not listed (Houston Street); only "Houston, TX".
    expect(towns).not.toContain("Houston");
    for (const name of [
      "Austin",
      "Travis County",
      "Pflugerville",
      "Lakeway",
      "Bee Cave",
      "Manchaca",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Salsa Night San Antonio", "San Antonio"],
    ["Two-Step at Gruene Hall", "Gruene"],
    ["Bachata Social Round Rock", "Round Rock"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("austin", title)).toBe(town);
  });

  it.each(["DJ Kyle Watson all night", "Taylor Swift Night", "Houston Street Swing"])(
    "keeps %s in Austin",
    (title) => {
      expect(titleNamesOutsideTown("austin", title)).toBeNull();
    },
  );

  it("wires its sources, retired addresses and known venues in", () => {
    // Resident Advisor's Austin area 321 (D-505, D-1180).
    expect(METRO_SOURCES.austin?.map((s) => s.url)).toContain("https://ra.co/graphql?area=321");
    // Retired after the first read (austin-fix-1): each with a reason.
    for (const gone of METRO_RETIRED_SOURCES.austin ?? []) expect(gone.reason).not.toBe("");
    // No known venues yet
    expect(KNOWN_VENUES.austin).toEqual([]);
  });

  it("lists Donn's Depot from a hand check, never as a retired or fetched page (D-798)", () => {
    const donns = METRO_SOURCES.austin?.find((s) => s.url === "https://donnsdepot.com/");
    expect(donns?.handChecked).toBe(true);
    expect(donns?.fixedNights?.map((f) => f.days[0])).toEqual([1, 2, 3, 4, 5, 6]);
    for (const f of donns?.fixedNights ?? []) {
      expect(f.checkedOn).toBe("2026-11-23");
      expect(f.evidenceUrl).toBe("https://donnsdepot.com/");
      expect(f.danceCited).not.toBe("");
    }
    expect(new Set(donns?.fixedNights?.map((f) => f.title)).size).toBe(6);
    expect(METRO_RETIRED_SOURCES.austin?.map((r) => r.url)).not.toContain(
      "https://donnsdepot.com/",
    );
  });

  it("lists Coconut Club's Latin Thursdays from its Instagram, never fetched (D-797)", () => {
    const coconut = METRO_SOURCES.austin?.find(
      (s) => s.url === "https://www.instagram.com/coconutclub.austin/",
    );
    expect(coconut?.handChecked).toBe(true);
    expect(coconut?.fixedNights?.map((f) => [f.days, f.start, f.end])).toEqual([
      [[4], "20:00", "01:00"],
    ]);
    expect(coconut?.fixedNights?.[0]?.checkedOn).toBe("2026-11-09");
    expect(coconut?.fixedNights?.[0]?.evidenceUrl).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
  });
});
