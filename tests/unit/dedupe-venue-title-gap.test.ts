import { describe, expect, it } from "vitest";
import {
  scorePair,
  titleWordsWithinBesideVenue,
  venueNamedTitle,
  type DedupeSide,
  type PairFacts,
} from "@/src/domain/dedupe";

// D-522: two sources' listings at one place, starts up to 90 min apart, titles alike beside venue name
// Istanbul read 41212702651: RA vs Bugece duplicates at Klein Phönix, each an hour apart.

const at = (hhmm: string, day = "2026-10-31") => new Date(`${day}T${hhmm}:00+03:00`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("21:00"),
  organizerId: null,
  organizerName: null,
  venueId: "v-klein",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "dj_night",
  endsAt: null,
  venueName: "Klein Phönix",
  ...over,
});

const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.3,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

describe("titleWordsWithinBesideVenue", () => {
  it("Henri Bergmann pair true", () => {
    const a = "Henri Bergmann | Klein Phönix";
    const b = "Henri Bergmann + NODUS + Arian & Aryou Sepassi";
    expect(titleWordsWithinBesideVenue(a, b, "Klein Phönix")).toBe(true);
    expect(titleWordsWithinBesideVenue(b, a, "Klein Phönix")).toBe(true);
  });

  it("Salsa Night | Klein Phönix vs Salsa Night Party depends on GENERIC_TITLE_WORDS", () => {
    // "salsa" and "night" are both in GENERIC_TITLE_WORDS (see config/dedupe.ts)
    // So short list has 0 non-generic words -> false
    const a = "Salsa Night | Klein Phönix";
    const b = "Salsa Night Party";
    expect(titleWordsWithinBesideVenue(a, b, "Klein Phönix")).toBe(false);
  });

  it("missing venueName false", () => {
    const a = "Henri Bergmann | Klein Phönix";
    const b = "Henri Bergmann + NODUS";
    expect(titleWordsWithinBesideVenue(a, b, undefined)).toBe(false);
    expect(titleWordsWithinBesideVenue(a, b, "")).toBe(false);
  });

  it("venueNamedTitle with 'en' (Spanish/Portuguese)", () => {
    // venueNamedTitle should now accept "en" as optional word before venue name
    expect(venueNamedTitle("Pixie en Niceto", "Pixie Club", "Niceto")).toBe(false);
    expect(venueNamedTitle("Mermelada en Niceto", "Mermelada", "Niceto")).toBe(true);
  });
});

describe("D-522: two sources, one venue, starts up to 90 min apart, titles alike beside venue name", () => {
  it("Henri Bergmann pair, 21:00 vs 22:00 -> auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Henri Bergmann + NODUS + Arian & Aryou Sepassi",
      startsAt: at("21:00"),
    });
    const b = side({
      id: "bugece",
      title: "Henri Bergmann | Klein Phönix",
      startsAt: at("22:00"),
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
    expect(scorePair(b, a, facts()).decision).toBe("auto_merge");
  });

  it("Avangart Tabldot pair, 21:00 vs 22:00 -> auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Avangart Tabldot // All night long",
      startsAt: at("21:00"),
    });
    const b = side({
      id: "bugece",
      title: "All Night Long: Avangart Tabldot | Klein Phönix",
      startsAt: at("22:00"),
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
  });

  it("sameSource: true -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Henri Bergmann + NODUS + Arian & Aryou Sepassi",
      startsAt: at("21:00"),
    });
    const b = side({
      id: "bugece",
      title: "Henri Bergmann | Klein Phönix",
      startsAt: at("22:00"),
    });
    expect(scorePair(a, b, facts({ sameSource: true })).decision).not.toBe("auto_merge");
  });

  it("starts 120 min apart -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Henri Bergmann + NODUS + Arian & Aryou Sepassi",
      startsAt: at("21:00"),
    });
    const b = side({
      id: "bugece",
      title: "Henri Bergmann | Klein Phönix",
      startsAt: at("23:00"),
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("different venues -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Henri Bergmann + NODUS + Arian & Aryou Sepassi",
      startsAt: at("21:00"),
      venueId: "v-klein",
      venueName: "Klein Phönix",
    });
    const b = side({
      id: "bugece",
      title: "Henri Bergmann | Klein Phönix",
      startsAt: at("22:00"),
      venueId: "v-other",
      venueName: "Other Club",
      venuePoint: undefined,
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("one side listingType class -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Henri Bergmann + NODUS + Arian & Aryou Sepassi",
      startsAt: at("21:00"),
      listingType: "class",
    });
    const b = side({
      id: "bugece",
      title: "Henri Bergmann | Klein Phönix",
      startsAt: at("22:00"),
      listingType: "dj_night",
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("ends far apart -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Henri Bergmann + NODUS + Arian & Aryou Sepassi",
      startsAt: at("21:00"),
      endsAt: at("02:00", "2026-11-01"),
    });
    const b = side({
      id: "bugece",
      title: "Henri Bergmann | Klein Phönix",
      startsAt: at("22:00"),
      endsAt: at("05:00", "2026-11-01"),
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("unrelated titles at one venue 1h apart -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Henri Bergmann | Klein Phönix",
      startsAt: at("21:00"),
    });
    const b = side({
      id: "bugece",
      title: "Kybba All Night",
      startsAt: at("22:00"),
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });
});
