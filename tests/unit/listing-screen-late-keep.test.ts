import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { normalizeListing } from "@/src/pipeline/normalize";
import type { HarvestedListing } from "@/src/adapters/types";
import type { NormalizeContext } from "@/src/pipeline/normalize";

describe("lateNightKeep flag per listing (D-342 follow-up)", () => {
  const tz = "America/Chicago";
  const night = "2026-11-06";
  const at11pm = (title: string, styles: string[] = []) => ({
    title,
    styles,
    startsAt: new Date("2026-11-06T23:00:00-06:00"),
    nightDate: night,
    tz,
    evidenceText: null,
  });
  const mixed = { mixedCalendar: true, styles: [] };

  it("keeps late show when lateNightKeep not set (default)", () => {
    const result = screenNoDance(at11pm("Sally Baby's Silver Dollars"), mixed);
    expect(result).toBeNull();
  });

  it("screens late show when lateNightKeep: false", () => {
    const result = screenNoDance(at11pm("Sally Baby's Silver Dollars"), {
      ...mixed,
      lateNightKeep: false,
    });
    expect(result?.kind).toBe("not_a_dance");
  });

  it("keeps late show with dance title even when lateNightKeep: false", () => {
    const result = screenNoDance(at11pm("Salsa Night with Sally Baby", ["salsa"]), {
      ...mixed,
      lateNightKeep: false,
    });
    expect(result).toBeNull();
  });

  it("keeps late show with bandsForDancers: true even when lateNightKeep: false", () => {
    const result = screenNoDance(at11pm("Sally Baby's Silver Dollars"), {
      ...mixed,
      bandsForDancers: true,
      lateNightKeep: false,
    });
    expect(result).toBeNull();
  });

  it("screens early show (21:00) with lateNightKeep: false", () => {
    const early = {
      title: "Sally Baby's Silver Dollars",
      styles: [],
      startsAt: new Date("2026-11-06T21:00:00-06:00"),
      nightDate: night,
      tz,
      evidenceText: null,
    };
    const result = screenNoDance(early, {
      ...mixed,
      lateNightKeep: false,
    });
    expect(result?.kind).toBe("not_a_dance");
  });

  describe("normalizeListing with venueFlags.lateNightKeep", () => {
    const metro = {
      id: "m",
      slug: "chi",
      name: "Chicago",
      countryCode: "US",
      center: { lat: 41.8781, lng: -87.6298 },
      radiusKm: 40,
      tz: "America/Chicago",
      languages: ["en"],
    };
    const source = {
      styles: [],
      mixedCalendar: true,
    };
    const ctx: NormalizeContext = {
      metro,
      source,
      now: new Date("2026-11-06T12:00:00-06:00"),
    };

    const baseHarvested: HarvestedListing = {
      listing: {
        title: "Sally Baby's Silver Dollars",
        local_date: "2026-11-06",
        recurrence_text: null,
        doors_time: "23:00",
        dancing_time: null,
        lesson_time: null,
        end_time: null,
        styles: [],
        listing_type: "other",
        venue: { name: null, address: null, url: null },
        organizer: { name: null, url: null },
        prices: [],
        is_free: null,
        ticket_url: null,
        level: null,
        partner_required: null,
        age_min: null,
        dress_code: null,
        floor: null,
        indoor_outdoor: null,
        music: { djs: [], bands: [], genre_mix: null },
        crowd_size_hint: null,
        cancelled: false,
        evidence: {},
        confidence: {},
      },
      externalId: null,
      tz: "America/Chicago",
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: "https://example.com",
        fetchedAt: new Date("2026-11-06T12:00:00-06:00"),
        method: "api",
      },
    };

    it("screens with venueFlags: { lateNightKeep: false }", () => {
      const harvested: HarvestedListing = {
        ...baseHarvested,
        venueFlags: { lateNightKeep: false },
      };
      const outcome = normalizeListing(harvested, ctx);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.kind).toBe("not_an_event");
        expect(outcome.reason).toMatch("names no dance");
      }
    });
  });
});
