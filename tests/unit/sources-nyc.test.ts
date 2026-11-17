// The New York starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), a re-pointed address retired as "replaced by" a page that is on the list, and no
// Squarespace view that its robots.txt forbids.
import { describe, expect, it } from "vitest";

import { NYC_RETIRED, NYC_SOURCES } from "@/config/sources/nyc";
import type { AdapterId, HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { REGISTRY } from "@/src/pipeline/ingest";
import { venueSeedFor, withSourceVenue } from "@/src/pipeline/source-venue";

const listed = NYC_SOURCES.map((seed) => seed.url);
const retired = NYC_RETIRED.map((gone) => gone.url);

describe("New York's starting list", () => {
  it("lists each address once, and only http(s) addresses", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) expect(new URL(url).protocol).toMatch(/^https?:$/);
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("retires a re-pointed address as replaced by a page that is on the list", () => {
    const replaced = NYC_RETIRED.filter((gone) => gone.reason.startsWith("replaced by "));
    expect(replaced.length).toBeGreaterThan(0);
    for (const gone of replaced) {
      expect(listed).toContain(gone.reason.slice("replaced by ".length));
    }
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of NYC_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("reads the pages that list the nights, not the home pages that hid them (D-110)", () => {
    for (const url of [
      "https://frimframjam.com/calendar",
      "https://www.nylindy.com/dances-2026",
      "https://cdny.org/calendar-events",
      "https://www.rscdsnewyork.org/classes",
      "https://www.bluesdancenewyork.com/events",
      "https://nuevotangoarts.org/2026-calendar",
    ]) {
      expect(listed).toContain(url);
    }
    for (const url of [
      "https://salsanewyork.com/",
      "https://zoukology.com/",
      "https://kizombaembassy.com/",
      "https://www.eventbrite.com/o/33937979455",
    ]) {
      expect(retired).toContain(url);
    }
  });

  it("sends each source with a platform to a registered adapter, never an html row (D-111)", () => {
    for (const seed of NYC_SOURCES.filter((s) => s.platform)) {
      expect(REGISTRY.has(seed.platform as AdapterId), seed.url).toBe(true);
      expect(seed.kind, seed.url).not.toBe("html");
    }
  });

  it("venueAddress ends with a 5-digit ZIP", () => {
    for (const seed of NYC_SOURCES) {
      if (seed.venueAddress) {
        expect(seed.venueAddress.trim(), seed.url).toMatch(/\d{5}$/);
      }
    }
  });

  it("places Time Out Market's Friday salsa at the market, and nothing else on timeout.com", () => {
    const url =
      "https://www.timeout.com/newyork/things-to-do/friday-night-salsa-at-time-out-market-union-square";
    const seed = NYC_SOURCES.find((s) => s.url === url);
    expect(seed).toBeDefined();
    expect(seed?.label).toBe("Time Out Market Union Square");
    expect(seed?.venueAddress).toBe("124 E 14th St, New York, NY 10003");
    expect(seed?.venuePage).not.toBe(true);

    // Exact address only: no host-wide match for the rest of timeout.com.
    expect(venueSeedFor(url, NYC_SOURCES)).toBe(seed);
    expect(
      venueSeedFor("https://www.timeout.com/newyork/nightlife/some-other-party", NYC_SOURCES),
    ).toBeUndefined();

    const raw = rawListingSchema.parse({
      title: "Friday Night Salsa",
      listing_type: "social",
      styles: ["salsa"],
      local_date: "2026-10-23",
      doors_time: "19:00",
      venue: { name: null, address: null, url: null },
      organizer: { name: null, url: null },
    });
    const listing: HarvestedListing = {
      listing: raw,
      externalId: "test:timeout-1",
      tz: "America/New_York",
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: url,
        fetchedAt: new Date(),
        method: "feed",
      },
    };
    const placed = withSourceVenue(listing, seed);
    expect(placed.listing.venue.name).toBe("Time Out Market Union Square");
    expect(placed.listing.venue.address).toBe("124 E 14th St, New York, NY 10003");
  });

  it("reads Shrine's own calendar as a mixed venue page (blocked-platform audit, D-758)", () => {
    const shrine = NYC_SOURCES.find((s) => s.url === "https://www.shrinenyc.com/calendar.php");
    expect(shrine?.kind).toBe("html");
    expect(shrine?.platform).toBeUndefined();
    expect(shrine?.mixedCalendar).toBe(true);
    expect(shrine?.venuePage).toBe(true);
    expect(shrine?.onlyHere).toBe(true);
    expect(shrine?.venueAddress).toMatch(/10030$/);
  });
});
