import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { normalizeListing } from "@/src/pipeline/normalize";
import type { HarvestedListing } from "@/src/adapters/types";
import type { NormalizeContext } from "@/src/pipeline/normalize";

describe("venue flags per listing (D-342)", () => {
  const tz = "America/New_York";
  const night = "2026-11-06";
  const at8pm = (title: string, styles: string[] = [], evidenceText?: string | null) => ({
    title,
    styles,
    startsAt: new Date("2026-11-06T20:00:00-05:00"),
    nightDate: night,
    tz,
    evidenceText,
  });
  const mixed = { mixedCalendar: true, styles: [] };

  it("keeps 'Rebirth Brass Band' at 8pm with danceBandKinds: true", () => {
    const result = screenNoDance(at8pm("Rebirth Brass Band"), {
      ...mixed,
      danceBandKinds: true,
    });
    expect(result).toBeNull();
  });

  it("screens 'Rebirth Brass Band' at 8pm without danceBandKinds", () => {
    const result = screenNoDance(at8pm("Rebirth Brass Band"), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("screens 'Rebirth Brass Band' at 8pm with danceBandKinds: false", () => {
    const result = screenNoDance(at8pm("Rebirth Brass Band"), {
      ...mixed,
      danceBandKinds: false,
    });
    expect(result?.kind).toBe("not_a_dance");
  });

  it("keeps 'Kermit Ruffins Quartet' with bandsForDancers: true", () => {
    const result = screenNoDance(at8pm("Kermit Ruffins Quartet"), {
      ...mixed,
      bandsForDancers: true,
    });
    expect(result).toBeNull();
  });

  it("screens 'Kermit Ruffins Quartet' without bandsForDancers", () => {
    const result = screenNoDance(at8pm("Kermit Ruffins Quartet"), mixed);
    expect(result?.kind).toBe("not_dance_scope");
  });

  it("keeps 'Zydeco night: Geno Delafose' with danceBandKinds: true", () => {
    const result = screenNoDance(at8pm("Zydeco night: Geno Delafose"), {
      ...mixed,
      danceBandKinds: true,
    });
    expect(result).toBeNull();
  });

  it("screens 'Brass Band Documentary Screening' even with danceBandKinds: true (a seated show)", () => {
    const result = screenNoDance(at8pm("Brass Band Documentary Screening"), {
      ...mixed,
      danceBandKinds: true,
    });
    expect(result).not.toBeNull();
  });

  describe("normalizeListing with venueFlags", () => {
    const metro = {
      id: "m",
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    };
    const source = {
      styles: [],
      mixedCalendar: true,
    };
    const ctx: NormalizeContext = {
      metro,
      source,
      now: new Date("2026-11-06T12:00:00-05:00"),
    };

    const baseHarvested: HarvestedListing = {
      listing: {
        title: "Rebirth Brass Band",
        local_date: "2026-11-06",
        recurrence_text: null,
        doors_time: "20:00",
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
      tz: "America/New_York",
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: "https://example.com",
        fetchedAt: new Date("2026-11-06T12:00:00-05:00"),
        method: "api",
      },
    };

    it("keeps with venueFlags: { danceBandKinds: true }", () => {
      const harvested: HarvestedListing = {
        ...baseHarvested,
        venueFlags: { danceBandKinds: true },
      };
      const outcome = normalizeListing(harvested, ctx);
      expect(outcome.ok).toBe(true);
    });

    it("screens without venueFlags", () => {
      const harvested: HarvestedListing = {
        ...baseHarvested,
        venueFlags: undefined,
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
