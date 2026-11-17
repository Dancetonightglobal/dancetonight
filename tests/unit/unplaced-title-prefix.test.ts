import { describe, it, expect } from "vitest";
import { unplacedTitlePrefix } from "@/src/domain/unplaced-title-prefix";
import type { DedupeSide } from "@/src/domain/dedupe";

// Helper to create a DedupeSide with defaults
function side(over: Partial<DedupeSide>): DedupeSide {
  return {
    id: "x",
    startsAt: new Date("2026-11-14T21:00:00Z"),
    organizerId: null,
    organizerName: null,
    venueId: null,
    venuePoint: undefined,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    title: "",
    titleNormalized: "",
    listingType: undefined,
    cancelled: false,
    ...over,
  };
}

describe("unplacedTitlePrefix", () => {
  // True cases
  it("returns true for Cadence case (both unplaced)", () => {
    const a = side({
      title: "Cadence presents: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    const b = side({
      title: "Cadence: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(true);
  });

  it("returns true for Tamborzão case (one placed)", () => {
    const a = side({
      title: "Tamborzão NIGHTs - Samba , Forró e Funk",
      venueId: "v1",
      venuePoint: { lat: -22.9, lng: -43.2 },
    });
    const b = side({
      title: "TAMBORZAO NIGHTS",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(true);
  });

  it("returns true for Sun City case (one placed)", () => {
    const a = side({
      title: "Sun City Day Party | Westend | Sexy & Stylish",
      venueId: "v1",
      venuePoint: { lat: 51.5, lng: -0.1 },
    });
    const b = side({
      title: "Sun City Day Party - Westend",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(true);
  });

  // False cases
  it("returns false when sameSource is true", () => {
    const a = side({
      title: "Cadence presents: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    const b = side({
      title: "Cadence: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, true)).toBe(false);
  });

  it("returns false when both placed", () => {
    const a = side({
      title: "Cadence presents: Seb Wildblood with DELACOUR",
      venueId: "v1",
      venuePoint: { lat: 40.7, lng: -74.0 },
    });
    const b = side({
      title: "Cadence: Seb Wildblood with DELACOUR",
      venueId: "v2",
      venuePoint: { lat: 40.7, lng: -74.0 },
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });

  it("returns false when starts differ by 30 minutes", () => {
    const a = side({
      title: "Cadence presents: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
      startsAt: new Date("2026-11-14T21:00:00Z"),
    });
    const b = side({
      title: "Cadence: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
      startsAt: new Date("2026-11-14T21:30:00Z"),
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });

  it("returns false when one start is null", () => {
    const a = side({
      title: "Cadence presents: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
      startsAt: null,
    });
    const b = side({
      title: "Cadence: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });

  it("returns false when one side cancelled", () => {
    const a = side({
      title: "Cadence presents: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
      cancelled: true,
    });
    const b = side({
      title: "Cadence: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });

  it("returns false when short title too short / only generic words", () => {
    // Using words from GENERIC_TITLE_WORDS: "salsa" and "night"
    const a = side({
      title: "Salsa Night",
      venueId: null,
      venuePoint: undefined,
    });
    const b = side({
      title: "Salsa Night Downtown Special",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });

  it("returns false when not a prefix", () => {
    const a = side({
      title: "Sun City Day Party - Westend Edition",
      venueId: null,
      venuePoint: undefined,
    });
    const b = side({
      title: "Sun City Day Party | Westend | Sexy & Stylish",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });

  it("returns false for promoter rule with two extra words", () => {
    // coreTitleWords("Big Cadence: Seb Wildblood with DELACOUR") likely includes "big", "cadence", etc.
    // coreTitleWords("Seb Wildblood with DELACOUR") includes "seb", "wildblood", "with", "delacour"
    // Let's adjust titles to ensure we have two extra words
    const a = side({
      title: "Big Cadence: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    const b = side({
      title: "Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });

  it("returns false when class-like listingType", () => {
    const a = side({
      title: "Cadence presents: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
      listingType: "class",
    });
    const b = side({
      title: "Cadence: Seb Wildblood with DELACOUR",
      venueId: null,
      venuePoint: undefined,
    });
    expect(unplacedTitlePrefix(a, b, false)).toBe(false);
  });
});
