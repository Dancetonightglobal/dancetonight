// The New Orleans starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-034).
import { describe, expect, it } from "vitest";

import { NEW_ORLEANS_RETIRED, NEW_ORLEANS_SOURCES } from "@/config/sources/new-orleans";
import { STYLES } from "@/config/styles";
import { KNOWN_VENUES } from "@/config/known-venues";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import { rawListingSchema } from "@/src/domain/listing";
import type { HarvestedListing } from "@/src/adapters/types";

function ohmListing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["swing"],
    local_date: "2026-10-30",
    doors_time: "20:00",
    venue: { name: name ?? null, address: address ?? null, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Chicago",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

const listed = NEW_ORLEANS_SOURCES.map((seed) => seed.url);
const retired = NEW_ORLEANS_RETIRED.map((gone) => gone.url);

describe("New Orleans' starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of NEW_ORLEANS_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of NEW_ORLEANS_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of NEW_ORLEANS_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of NEW_ORLEANS_SOURCES) {
      if (seed.kind === "feed_ics") {
        expect(seed.feedUrl).toBeDefined();
      }
      if (seed.kind === "squarespace") {
        expect(seed.platform).toBe("squarespace");
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of NEW_ORLEANS_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = NEW_ORLEANS_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(organisers.length).toBe(13);
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.com\/o\/[a-z0-9-]+-\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("places Rock 'n' Bowl at its own checked address, never its Lafayette calendar", () => {
    const bowl = NEW_ORLEANS_SOURCES.find((s) => s.label === "Rock 'n' Bowl");
    expect(bowl?.url).toBe("https://www.rocknbowl.com/new-orleans");
    expect(bowl?.venueAddress).toBe("3016 S Carrollton Ave, New Orleans, LA 70118");
    expect(bowl?.venuePage).toBe(true);
    expect(bowl?.bandsForDancers).toBe(true);
    expect(NEW_ORLEANS_SOURCES.some((s) => s.url.includes("rocknbowl.com/live-music"))).toBe(false);
  });

  it("lists danceNights for Santos Bar and Twelve Mile Limit (D-264)", () => {
    const santos = NEW_ORLEANS_SOURCES.find((s) => s.url === "https://www.santosbar.com/");
    expect(santos?.danceNights).toEqual(["Chambre Noir", "Resurrection Goth Night"]);
    const twelve = NEW_ORLEANS_SOURCES.find((s) => s.url === "https://twelvemilelimit.com/events");
    expect(twelve?.danceNights).toEqual(["Heatwave"]);
  });

  it("reads DanceUS's New Orleans salsa calendar as a mixed directory (D-343)", () => {
    const danceus = NEW_ORLEANS_SOURCES.filter((s) => s.url.includes("danceus.org"));
    expect(danceus).toHaveLength(1);
    expect(danceus[0]?.url).toBe(
      "https://www.danceus.org/events/salsa/new-orleans-la-salsa-calendar/",
    );
    expect(danceus[0]?.kind).toBe("html");
    expect(danceus[0]?.trustTier).toBe("directory");
    expect(danceus[0]?.mixedCalendar).toBe(true);
  });

  it("reads Oz's weekly page as a mixed weekly grid at 800 Bourbon", () => {
    const weekly = NEW_ORLEANS_SOURCES.find((s) => s.url === "https://www.ozneworleans.com/events");
    expect(weekly).toBeDefined();
    expect(weekly?.weeklyGrid).toBe(true);
    expect(weekly?.mixedCalendar).toBe(true);
    expect(weekly?.venuePage).toBe(true);
    expect(weekly?.venueAddress).toBe("800 Bourbon St, New Orleans, LA 70116");
    expect(weekly?.label).toBe("Oz");

    const home = NEW_ORLEANS_SOURCES.find((s) => s.url === "https://www.ozneworleans.com/");
    expect(home).toBeDefined();
    expect(home?.weeklyGrid).toBeFalsy();
    expect(weekly?.onlyHere).toBe(true);
    expect(home?.onlyHere).toBe(true);
  });

  it("places BB's Stage Door Canteen at the WWII Museum, 945 Magazine St", () => {
    const entry = KNOWN_VENUES["new-orleans"]?.find((v) =>
      v.names.includes("BB's Stage Door Canteen"),
    );
    expect(entry).toBeDefined();
    expect(entry?.address).toBe("945 Magazine St, New Orleans, LA 70130");
    expect(entry?.names).toContain("National WWII Museum");
  });

  it("joins Eventbrite's 'Ohm Lounge, Tchoupitoulas Street' to Ohm Lounge at 601 Tchoupitoulas", () => {
    const result1 = withKnownVenue(
      ohmListing(
        "Ohm Lounge, Tchoupitoulas Street, New Orleans, LA, USA",
        "Tchoupitoulas Street, New Orleans, LA, USA",
      ),
      KNOWN_VENUES["new-orleans"],
      "US",
    );
    expect(result1.listing.venue.address).toBe("601 Tchoupitoulas St, New Orleans, LA 70130");
    expect(result1.listing.venue.name).toBe("Ohm Lounge");

    const result2 = withKnownVenue(
      ohmListing("Ohm Lounge", null),
      KNOWN_VENUES["new-orleans"],
      "US",
    );
    expect(result2.listing.venue.address).toBe("601 Tchoupitoulas St, New Orleans, LA 70130");
  });

  it("reads Out x Out's New Orleans events calendar as a mixed directory, with permission (D-545)", () => {
    const oxo = NEW_ORLEANS_SOURCES.filter((s) => s.url.startsWith("https://outxout.com/"));
    expect(oxo.map((s) => s.url)).toEqual(["https://outxout.com/events/new-orleans-la"]);
    expect(oxo[0]?.trustTier).toBe("directory");
    expect(oxo[0]?.kind).toBe("jsonld");
    expect(oxo[0]?.mixedCalendar).toBe(true);
    expect(oxo[0]?.styles).toEqual(["queer_party"]);
  });

  it("lists Oz's Saturday dance night from its weekly page as a fixed night (D-524)", () => {
    const oz = NEW_ORLEANS_SOURCES.find((s) => s.url === "https://www.ozneworleans.com/events");
    expect(oz?.fixedNights).toEqual([
      expect.objectContaining({
        title: "Dance Bitches Dance!",
        line: "Gay Dance Club with rotating guest DJs",
        days: [6],
        start: "22:00",
      }),
    ]);
    expect(oz?.fixedNights?.[0]?.danceCited).toContain("ozneworleans.com/events");
    const home = NEW_ORLEANS_SOURCES.find((s) => s.url === "https://www.ozneworleans.com/");
    expect(home?.fixedNights).toBeUndefined();
  });

  it("reads LeLa Saint's ma.to venue page as a mixed directory (D-524)", () => {
    const saint = NEW_ORLEANS_SOURCES.filter((s) => s.url === "https://ma.to/venue/saintbarnola");
    expect(saint).toHaveLength(1);
    expect(saint[0]?.trustTier).toBe("directory");
    expect(saint[0]?.mixedCalendar).toBe(true);
    expect(saint[0]?.styles).toEqual(["dj_night"]);
  });

  it("includes WWOZ Takin' It to the Streets source with platform wwoz_streets", () => {
    const streets = NEW_ORLEANS_SOURCES.find(
      (s) => s.url === "https://www.wwoz.org/programs/inthestreet",
    );
    expect(streets).toBeDefined();
    expect(streets?.platform).toBe("wwoz_streets");
    expect(streets?.styles).toEqual(["second_line"]);
    expect(streets?.trustTier).toBe("directory");
  });
});
