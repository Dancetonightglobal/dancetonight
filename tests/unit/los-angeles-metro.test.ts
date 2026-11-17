// Los Angeles is Los Angeles County (D-1160): the Census TIGER outline with Santa Catalina Island, LA County's
// Countywide Statistical Areas as neighbourhoods (the City of LA's communities, the other cities whole, the
// unincorporated communities), California addresses, 900-918 and 935 ZIP codes, and the towns around it that
// source titles name. Points are each venue's street address (2026-11-07).
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
import { DAILY_METROS } from "@/src/edge/ingest-trigger";

const LA: Metro = {
  id: "m",
  slug: "los-angeles",
  name: "Los Angeles",
  countryCode: "US",
  center: { lat: 34.0537, lng: -118.2427 },
  radiusKm: 105,
  tz: "America/Los_Angeles",
  languages: ["en", "es"],
};

describe("Los Angeles County (D-1160)", () => {
  it.each([
    ["Exchange LA, 618 S Spring St", 34.045, -118.251, "Downtown"],
    ["La Cita, 336 S Hill St", 34.0517, -118.249, "Downtown"],
    ["Sound Nightclub, 1642 N Las Palmas Ave", 34.1003, -118.336, "Hollywood"],
    ["El Floridita, 1253 N Vine St", 34.0938, -118.3266, "Hollywood"],
    ["Echoplex, 1154 Glendale Blvd", 34.0777, -118.2606, "Echo Park"],
    ["The Abbey, 692 N Robertson Blvd", 34.0838, -118.3854, "West Hollywood"],
    ["Santa Monica Pier", 34.0094, -118.4973, "Santa Monica"],
    ["Sevilla, 140 Pine Ave, Long Beach", 33.7686, -118.1924, "Long Beach"],
    ["Whittier Blvd, East Los Angeles", 34.023, -118.169, "East Los Angeles"],
    ["Avalon, Santa Catalina Island", 33.3428, -118.3267, "Avalon"],
  ])("puts %s inside, in its neighbourhood", (_name, lat, lng, hood) => {
    expect(metroPartAt("los-angeles", { lat, lng })).toBe("Los Angeles County");
    expect(insideMetro(LA, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Anaheim", 33.8366, -117.9145],
    ["Huntington Beach", 33.6595, -117.9988],
    ["Thousand Oaks", 34.1706, -118.8376],
    ["Ontario", 34.0633, -117.6509],
  ])("leaves %s outside, though its circle reaches it", (_name, lat, lng) => {
    expect(metroPartAt("los-angeles", { lat, lng })).toBeNull();
    expect(insideMetro(LA, { lat, lng })).toBe(false);
  });

  it("names the City of LA by its communities and the other cities whole", () => {
    const names = new Set(NEIGHBOURHOODS.map((n) => n.name));
    expect(names.has("Los Angeles")).toBe(false);
    for (const name of [
      "Silver Lake",
      "Koreatown",
      "Mid-City",
      "Venice",
      "Pasadena",
      "Culver City",
      "Burbank",
    ]) {
      expect(names.has(name)).toBe(true);
    }
    // The county's own spellings, fixed.
    expect(names.has("Silverlake")).toBe(false);
    expect(names.has("Mid-city")).toBe(false);
  });
});

describe("Los Angeles in the shared tables", () => {
  it("reads California addresses and LA County ZIP codes", () => {
    expect(METRO_REGIONS["los-angeles"]).toEqual(["CA"]);
    expect(METRO_POSTCODE_PREFIXES["los-angeles"]).toContain("900");
    expect(METRO_POSTCODE_PREFIXES["los-angeles"]).toContain("935");
    expect(METRO_POSTCODE_PREFIXES["los-angeles"]).not.toContain("926"); // Orange County (Irvine, Newport Beach)
  });

  it("names the towns around it, and none that is also an LA street or place", () => {
    const towns = METRO_OUTSIDE_TOWNS["los-angeles"] ?? [];
    for (const town of ["Anaheim", "Irvine", "Oxnard", "San Diego", "Las Vegas"]) {
      expect(towns).toContain(town);
    }
    for (const name of [
      "Ventura",
      "Riverside",
      "Brea",
      "Orange",
      "Westminster",
      "Long Beach",
      "Pasadena",
    ]) {
      expect(towns).not.toContain(name);
    }
  });

  it.each([
    ["Salsa Night in Anaheim", "Anaheim"],
    ["Irvine Swing Dance", "Irvine"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("los-angeles", title)).toBe(town);
  });

  it.each([
    "Bachata Night on Ventura Blvd",
    "Riverside Drive Rooftop Party",
    "La Brea Salsa Social",
    "Long Beach Swing Night",
  ])("keeps %s in Los Angeles", (title) => {
    expect(titleNamesOutsideTown("los-angeles", title)).toBeNull();
  });

  it("wires its sources, retired addresses and known venues in", () => {
    // Resident Advisor's Los Angeles area (D-505, D-1160).
    expect(METRO_SOURCES["los-angeles"]?.map((s) => s.url)).toContain(
      "https://ra.co/graphql?area=23",
    );
    // SwingDance.LA answered 403 on the first scheduled read (2026-11-07).
    // The PV land conservancy calendar has no dance (2026-11-10).
    // USC's university calendars and Three Clubs' theater calendar have no dance nights (the owner, 2026-11-10).
    expect(METRO_RETIRED_SOURCES["los-angeles"]?.map((r) => r.url)).toEqual([
      "https://www.swingdance.la/events/",
      "https://pvplc.org/mec_calendars/full-calendar/",
      "https://calendar.usc.edu/?utm_campaign=Brand&utm_medium=website&utm_source=USC%20Homepage",
      "https://trojanevents.usc.edu/",
      "https://threeclubs.com/",
      "https://www.sweetwaterweho.com/watch",
      "https://18thstreet.org/",
      "https://thekiaforum.com/",
      "https://www.eastwestplayers.org/",
      "https://pasadenasymphony-pops.org/",
      "https://www.backyardpartyla.com/shows",
      "https://www.chevychasecc.com/calendar",
      "https://www.harvelles.com/",
      "https://longbeach.harvelles.com/events",
      "https://www.skiptownplayhouse.com/calendar",
      "https://www.ranchovistagolfclub.com/weddings/",
      "https://www.dav.org/",
      "https://cal.lmu.edu/",
      "https://www.azusatheater.com/upcoming-programs.html",
      "https://grammymuseum.org/programs/",
      "https://vipnightlife.com/events/",
      "https://www.vibratogrilljazz.com",
    ]);
    // Canonical names for venues two sources spell differently (2026-11-07).
    expect(KNOWN_VENUES["los-angeles"]?.map((v) => v.names[0])).toEqual([
      "Crown Theatre",
      "Stevens Steakhouse",
      "The Continental Club",
    ]);
  });
});

describe("the Los Angeles daily read (D-1160)", () => {
  it("reads once a day at 17:27 UTC (9:27am PST, 10:27am PDT)", () => {
    expect(DAILY_METROS.find((m) => m.slug === "los-angeles")).toEqual({
      slug: "los-angeles",
      tz: "America/Los_Angeles",
      hourUtc: 17,
      minuteUtc: 27,
    });
  });
});
