import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearchText, searchWords } from "@/src/domain/search";
import { applyFilters } from "@/src/data/listing-mapper";
import type { Listing } from "@/src/domain/listing";

const NY = "America/New_York";

// Helper to create a minimal listing for testing, similar to the one in home-filters.test.ts
function listing(id: string, overrides: Partial<Listing> = {}): Listing {
  const base: Listing = {
    id,
    slug: id,
    title: id,
    listingType: "social",
    styles: [],
    families: [],
    doorsAt: null,
    lessonAt: null,
    dancingAt: null,
    endsAt: null,
    startsAt: null,
    nightDate: "2026-09-29",
    tz: NY,
    venue: null,
    organizer: null,
    prices: [],
    isFree: null,
    ticketUrl: null,
    level: null,
    partnerRequired: null,
    ageMin: null,
    dressCode: null,
    floor: null,
    indoorOutdoor: null,
    music: null,
    crowdSizeHint: null,
    recurrenceText: null,
    confirmation: "confirmed_today",
    confidence: null,
    summary: null,
    sources: [],
    status: "active",
    canonicalUrl: null,
    distanceKm: null,
    liveStatus: null,
  };
  return { ...base, ...overrides };
}

describe("normalizeSearchText", () => {
  it("removes diacritics and normalizes", () => {
    expect(normalizeSearchText("Café  Wha?")).toBe("cafe wha");
    expect(normalizeSearchText("Dead Letter No. 9")).toBe("dead letter no 9");
    expect(normalizeSearchText("Lindy-Hop")).toBe("lindy hop");
    expect(normalizeSearchText("  ")).toBe("");
  });
});

describe("searchWords", () => {
  it("splits and deduplicates", () => {
    expect(searchWords("")).toEqual([]);
    expect(searchWords("  ")).toEqual([]);
    expect(searchWords("lindy hop")).toEqual(["lindy", "hop"]);
    expect(searchWords("lindy  hop lindy")).toEqual(["lindy", "hop"]);
    expect(searchWords("no.9")).toEqual(["no", "9"]);
  });
});

describe("matchesSearch", () => {
  it("returns true for undefined, empty, or only punctuation", () => {
    const l = listing("test");
    expect(matchesSearch(l, undefined)).toBe(true);
    expect(matchesSearch(l, "")).toBe(true);
    expect(matchesSearch(l, "  ?! ")).toBe(true);
  });

  it("matches by title", () => {
    const l = listing("t", { title: "Salsa Night" });
    expect(matchesSearch(l, "salsa")).toBe(true);
    expect(matchesSearch(l, "night")).toBe(true);
    expect(matchesSearch(l, "salsa night")).toBe(true);
    expect(matchesSearch(l, "bachata")).toBe(false);
  });

  it("matches by venue name and neighborhood", () => {
    const l = listing("v", {
      venue: {
        id: "v1",
        name: "Brooklyn Steel",
        location: { lat: 40.7, lng: -73.9 },
        address: null,
        neighborhood: "Williamsburg",
        googlePlaceId: null,
        kind: "dance_hall",
        danceFloor: "yes",
      },
    });
    expect(matchesSearch(l, "brooklyn")).toBe(true);
    expect(matchesSearch(l, "steel")).toBe(true);
    expect(matchesSearch(l, "williamsburg")).toBe(true);
    expect(matchesSearch(l, "queens")).toBe(false);
  });

  it("matches by address line1, locality, formatted", () => {
    const l = listing("a", {
      venue: {
        id: "v2",
        name: "Place",
        location: { lat: 40.7, lng: -73.9 },
        address: {
          line1: "123 Main St",
          line2: null,
          locality: "Brooklyn",
          region: "NY",
          postcode: "11211",
          countryCode: "US",
          formatted: "123 Main St, Brooklyn, NY 11211",
        },
        neighborhood: null,
        googlePlaceId: null,
        kind: "dance_hall",
        danceFloor: "yes",
      },
    });
    expect(matchesSearch(l, "main")).toBe(true);
    expect(matchesSearch(l, "brooklyn")).toBe(true);
    expect(matchesSearch(l, "11211")).toBe(true);
  });

  it("matches by organizer name", () => {
    const l = listing("o", {
      organizer: {
        name: "Dead Letter",
        websiteUrl: null,
        socials: {},
      },
    });
    expect(matchesSearch(l, "dead")).toBe(true);
    expect(matchesSearch(l, "letter")).toBe(true);
    expect(matchesSearch(l, "dead letter")).toBe(true);
    expect(matchesSearch(l, "live")).toBe(false);
  });

  it("matches by DJs and bands", () => {
    const l = listing("m", {
      music: {
        djs: ["DJ Rekha"],
        bands: ["The Beatles"],
        genreMix: "Bollywood fusion",
        liveMusic: null,
      },
    });
    expect(matchesSearch(l, "rekha")).toBe(true);
    expect(matchesSearch(l, "beatles")).toBe(true);
    expect(matchesSearch(l, "bollywood")).toBe(true);
    expect(matchesSearch(l, "fusion")).toBe(true);
    expect(matchesSearch(l, "rolling")).toBe(false);
  });

  it("matches by style and family label", () => {
    // Use a known style key from config/styles.ts, e.g., "lindy_hop"
    const l = listing("s", {
      styles: ["lindy_hop"],
      families: ["swing"],
    });
    // style label "Lindy hop" (see config/styles.ts line ~)
    expect(matchesSearch(l, "lindy")).toBe(true);
    // family label "Swing"
    expect(matchesSearch(l, "swing")).toBe(true);
  });

  it("does not match generic words from synonyms", () => {
    // A social listing should not match "class" or "party" via synonyms
    const social = listing("social", {
      title: "Friday social",
      styles: ["salsa"],
      families: ["salsa"],
      listingType: "social",
    });
    expect(matchesSearch(social, "class")).toBe(false);
    expect(matchesSearch(social, "party")).toBe(false);

    // But a class listing should match "class" via its listingType
    const classListing = listing("class", {
      title: "Salsa class",
      styles: ["salsa"],
      families: ["salsa"],
      listingType: "class",
    });
    expect(matchesSearch(classListing, "class")).toBe(true);
  });

  it("matches by listing type label", () => {
    const l = listing("c", { listingType: "class" });
    // listingTypeLabel("class") returns "Class" (from config/styles.ts)
    expect(matchesSearch(l, "class")).toBe(true);
  });

  it("requires all words (AND)", () => {
    const l = listing("multi", {
      title: "Salsa Social",
      venue: {
        id: "v",
        name: "Brooklyn Lounge",
        location: { lat: 40.7, lng: -73.9 },
        address: null,
        neighborhood: "Williamsburg",
        googlePlaceId: null,
        kind: "dance_hall",
        danceFloor: "yes",
      },
    });
    expect(matchesSearch(l, "salsa brooklyn")).toBe(true);
    expect(matchesSearch(l, "salsa queens")).toBe(false);
    expect(matchesSearch(l, "bachata brooklyn")).toBe(false);
  });

  it("handles diacritics both ways", () => {
    const l1 = listing("d1", { title: "Café Wha" });
    expect(matchesSearch(l1, "cafe")).toBe(true);
    expect(matchesSearch(l1, "café")).toBe(true);
    const l2 = listing("d2", { title: "Cafe Wha" });
    expect(matchesSearch(l2, "café")).toBe(true);
    expect(matchesSearch(l2, "cafe")).toBe(true);
  });

  it("does not throw when venue/organizer/music are null", () => {
    const l = listing("empty", {
      venue: null,
      organizer: null,
      music: null,
    });
    expect(() => matchesSearch(l, "test")).not.toThrow();
    // title matches
    expect(matchesSearch(l, "empty")).toBe(true);
  });
});

describe("applyFilters with text", () => {
  const NOW = new Date("2026-09-28T17:30:00Z");

  it("filters by text", () => {
    const tango = listing("tango", {
      title: "Milonga",
      families: ["tango"],
    });
    const salsa = listing("salsa", {
      title: "Salsa Social",
      families: ["salsa"],
    });
    const listings = [tango, salsa];
    const filtered = applyFilters(listings, { text: "tango" }, NOW);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("tango");
  });
});
