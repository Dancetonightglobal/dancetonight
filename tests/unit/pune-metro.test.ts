// Pune is the Pune Municipal Corporation with its two cantonments, Pimpri-Chinchwad and Hinjewadi (D-1120),
// outline in config/metro-bounds/pune.json, neighbourhoods in config/neighbourhoods/pune.json.
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
import { insideMetro } from "@/src/domain/metro-bounds";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";
import { RA_AREAS } from "@/config/sources/ra";
import { DAILY_METROS } from "@/src/edge/ingest-trigger";

const PUNE: Metro = {
  id: "m",
  slug: "pune",
  name: "Pune",
  countryCode: "IN",
  center: { lat: 18.5196, lng: 73.8553 },
  radiusKm: 25,
  tz: "Asia/Kolkata",
  languages: ["en", "mr", "hi"],
};

describe("the Pune metro outline (D-1120)", () => {
  it.each([
    ["Shaniwar Wada, centre", 18.5196, 73.8553],
    ["Koregaon Park", 18.5372, 73.8912],
    ["Kalyani Nagar", 18.5475, 73.9035],
    ["Viman Nagar", 18.564, 73.9162],
    ["Kharadi", 18.5505, 73.9414],
    ["Mundhwa", 18.5348, 73.9306],
    ["Baner", 18.5643, 73.7767],
    ["Camp, MG Road", 18.5143, 73.8788],
    ["Wakad, Pimpri-Chinchwad", 18.6032, 73.7626],
    ["Pimple Saudagar, Pimpri-Chinchwad", 18.5984, 73.7974],
    ["Nigdi, Pimpri-Chinchwad", 18.6601, 73.7777],
    ["Hinjewadi", 18.5913, 73.735],
  ])("puts %s inside", (_name, lat, lng) => {
    expect(insideMetro(PUNE, { lat, lng })).toBe(true);
  });

  it.each([
    ["Lonavala", 18.7546, 73.4062],
    ["Talegaon Dabhade", 18.7357, 73.6758],
    ["Chakan", 18.7606, 73.8636],
    ["Saswad", 18.3434, 74.031],
    ["Mumbai", 18.9398, 72.8355],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(PUNE, { lat, lng })).toBe(false);
  });
});

describe("Pune's neighbourhoods (D-1120)", () => {
  it.each([
    ["Koregaon Park", 18.5372, 73.8912],
    ["Kalyani Nagar", 18.5475, 73.9035],
    ["Viman Nagar", 18.564, 73.9162],
    ["Mundhwa", 18.5348, 73.9306],
    ["Baner", 18.5643, 73.7767],
    ["Hinjewadi", 18.5913, 73.735],
  ])("names %s at its own point", (name, lat, lng) => {
    expect(neighbourhoodAt({ lat, lng })).toBe(name);
  });
});

describe("Pune in the shared tables", () => {
  it("is in Maharashtra and reads Pune and Pimpri-Chinchwad PIN codes", () => {
    expect(METRO_REGIONS.pune).toEqual(["MH"]);
    expect(METRO_POSTCODE_PREFIXES.pune).toEqual(["4110", "412101", "412105"]);
  });

  it("lists outside towns, never including places inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.pune ?? [];
    expect(towns).toContain("Mumbai");
    expect(towns).toContain("Lonavala");
    for (const inside of [
      "Pune",
      "Poona",
      "Camp",
      "Pimpri",
      "Chinchwad",
      "Hinjewadi",
      "Kharadi",
      "Bombay",
    ]) {
      expect(towns).not.toContain(inside);
    }
  });

  it.each([
    ["Sunburn Arena Mumbai", "Mumbai"],
    ["Lonavala Pool Party", "Lonavala"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("pune", title)).toBe(town);
  });

  it.each([["Koregaon Park Bollywood Night"], ["Pune Salsa Social"], ["Hinjewadi Friday Techno"]])(
    "keeps %s in Pune",
    (title) => {
      expect(titleNamesOutsideTown("pune", title)).toBeNull();
    },
  );

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.pune).toBeDefined();
    expect(METRO_RETIRED_SOURCES.pune).toBeDefined();
    expect(KNOWN_VENUES.pune).toBeInstanceOf(Array);
  });

  it("reads Resident Advisor area 329", () => {
    expect(RA_AREAS.pune).toBe(329);
    const ra = (METRO_SOURCES.pune ?? []).find((s) => s.platform === "ra");
    expect(ra?.url).toBe("https://ra.co/graphql?area=329");
  });

  it("reads once a day at 01:57 UTC (7:27am IST)", () => {
    expect(DAILY_METROS.find((m) => m.slug === "pune")).toEqual({
      slug: "pune",
      tz: "Asia/Kolkata",
      hourUtc: 1,
      minuteUtc: 57,
    });
  });
});
