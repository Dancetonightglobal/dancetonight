// New Orleans is Orleans Parish (= the City of New Orleans; D-340) and Jefferson Parish (D-555): the Census TIGER outlines with their
// water areas, Who's On First neighbourhoods (mostly the city's own GIS outlines), Louisiana addresses,
// 700-701 ZIP codes, and the towns around it that source titles name. Points are the Census geocoder's for
// each venue's street address (2026-10-29).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  METRO_REGIONS,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

const NOLA: Metro = {
  id: "n",
  slug: "new-orleans",
  name: "New Orleans",
  countryCode: "US",
  center: { lat: 29.9574, lng: -90.0629 },
  radiusKm: 45,
  tz: "America/Chicago",
  languages: ["en"],
};

describe("Orleans and Jefferson Parishes (D-340, D-555)", () => {
  it.each([
    ["The Spotted Cat, 623 Frenchmen St", 29.9638, -90.0577, "Marigny"],
    ["Tipitina's, 501 Napoleon Ave", 29.9172, -90.1009, "East Riverside"],
    ["Rock 'n' Bowl, 3000 S Carrollton Ave", 29.9604, -90.1159, "Gert Town"],
    ["Maple Leaf Bar, 8316 Oak St", 29.9489, -90.1318, "Carrollton"],
    ["Kermit's Treme Mother-in-Law Lounge, 1500 N Claiborne Ave", 29.971, -90.0669, "Seventh Ward"],
    ["Siberia, 2227 St Claude Ave", 29.9689, -90.0558, "St. Roch"],
    ["Jackson Square, 700 Chartres St", 29.9574, -90.0637, "French Quarter"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(metroPartAt("new-orleans", { lat, lng })).toBe("New Orleans");
    expect(insideMetro(NOLA, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it("keeps the parish's water inside (Lake Pontchartrain), with no neighbourhood", () => {
    expect(insideMetro(NOLA, { lat: 30.1, lng: -90.05 })).toBe(true);
    expect(neighbourhoodAt({ lat: 30.1, lng: -90.05 })).toBeNull();
  });

  it.each([
    ["Chalmette", 29.941, -89.963],
    ["Arabi", 29.9543, -90.0054],
    ["Belle Chasse", 29.8549, -89.9906],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("new-orleans", { lat, lng })).toBeNull();
    expect(insideMetro(NOLA, { lat, lng })).toBe(false);
  });

  it("loads the neighbourhoods without a duplicate East Carrollton", () => {
    expect(NEIGHBOURHOODS.filter((n) => n.name === "East Carrollton")).toHaveLength(1);
    expect(NEIGHBOURHOODS.some((n) => n.name === "Treme")).toBe(true);
  });

  it.each([
    ["Lakeside Mall, Metairie", 30.0036, -90.1559, "Metairie"],
    ["Gretna City Hall", 29.9175, -90.0653, "Gretna"],
    ["Kenner", 29.9941, -90.2417, "Kenner"],
  ])("puts %s inside, in Jefferson Parish (D-555)", (_name, lat, lng, place) => {
    expect(metroPartAt("new-orleans", { lat, lng })).toBe("Jefferson Parish");
    expect(insideMetro(NOLA, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(place);
  });

  it("has Jefferson Parish neighbourhoods", () => {
    expect(NEIGHBOURHOODS.some((n) => n.name === "Metairie")).toBe(true);
    expect(NEIGHBOURHOODS.some((n) => n.name === "Kenner")).toBe(true);
    expect(NEIGHBOURHOODS.some((n) => n.name === "Gretna")).toBe(true);
    expect(NEIGHBOURHOODS.some((n) => n.name === "Harahan")).toBe(true);
  });
});

describe("New Orleans in the shared tables", () => {
  it("reads Louisiana addresses and 700-701 ZIP codes", () => {
    expect(METRO_REGIONS["new-orleans"]).toEqual(["LA"]);
    expect(METRO_POSTCODE_PREFIXES["new-orleans"]).toEqual(["700", "701"]);
  });

  it("names the towns around it, and none that is also a New Orleans place", () => {
    const towns = METRO_OUTSIDE_TOWNS["new-orleans"] ?? [];
    for (const town of ["Chalmette", "Arabi", "Slidell", "Covington", "Baton Rouge"]) {
      expect(towns).toContain(town);
    }
    // Lafayette Square, Mandeville Street, Jefferson Avenue and Lafitte Street are New Orleans places;
    // Harvey is also a surname. Metairie, Kenner, Gretna, Harahan, River Ridge, Marrero, Westwego,
    // Terrytown are inside since D-555 and must not be listed.
    for (const name of [
      "Lafayette",
      "Mandeville",
      "Jefferson",
      "Lafitte",
      "Harvey",
      "Metairie",
      "Kenner",
      "Gretna",
      "Harahan",
      "River Ridge",
      "Marrero",
      "Westwego",
      "Terrytown",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it("wires its sources, retired addresses and known venues in", () => {
    expect(METRO_SOURCES["new-orleans"]?.length).toBeGreaterThan(0);
    expect(METRO_RETIRED_SOURCES["new-orleans"]?.map((r) => r.url)).toContain(
      "https://thejoytheater.com/shows/",
    );
    const known = KNOWN_VENUES["new-orleans"] ?? [];
    expect(known.find((v) => v.names.includes("DBA New Orleans"))?.address).toBe(
      "618 Frenchmen St, New Orleans, LA 70116",
    );
    // Every address is in Orleans Parish, with a ZIP.
    for (const venue of known) expect(venue.address).toMatch(/, New Orleans, LA 701\d\d$/);
  });
});
