import { describe, expect, it } from "vitest";
import {
  scorePair,
  titleWordsWithinBesideVenue,
  type DedupeSide,
  type PairFacts,
} from "@/src/domain/dedupe";

const at = (hhmm: string, day = "2026-11-06") => new Date(`${day}T${hhmm}:00-04:00`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("22:00"),
  organizerId: null,
  organizerName: null,
  venueId: "v-barbary",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "dj_night",
  endsAt: null,
  venueName: "The Barbary",
  ...over,
});

const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.3,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

describe("D-522: untimed side joins too, and 'and' is not a telling word", () => {
  it("RA timed vs venue untimed -> auto_merge", () => {
    const a = side({
      id: "ra",
      title: "The Barbary pres. Chus & Ceballos + Caleb Jackson",
      startsAt: at("22:00"),
    });
    const b = side({
      id: "venue",
      title: "CHUS + CEBALLOS / CALEB JACKSON / DRESDÔN",
      startsAt: null,
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
    expect(scorePair(b, a, facts()).decision).toBe("auto_merge");
  });

  it("both timed within 90 min -> auto_merge", () => {
    const a = side({
      id: "ra",
      title: "The Barbary pres. Chus & Ceballos + Caleb Jackson",
      startsAt: at("22:00"),
    });
    const b = side({
      id: "venue",
      title: "CHUS + CEBALLOS / CALEB JACKSON / DRESDÔN",
      startsAt: at("23:00"),
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
  });

  it("sameSource true -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "The Barbary pres. Chus & Ceballos + Caleb Jackson",
      startsAt: at("22:00"),
    });
    const b = side({
      id: "venue",
      title: "CHUS + CEBALLOS / CALEB JACKSON / DRESDÔN",
      startsAt: null,
    });
    expect(scorePair(a, b, facts({ sameSource: true })).decision).not.toBe("auto_merge");
  });

  it("one untimed, other venue -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "The Barbary pres. Chus & Ceballos + Caleb Jackson",
      startsAt: at("22:00"),
      venueId: "v-barbary",
      venueName: "The Barbary",
    });
    const b = side({
      id: "venue",
      title: "CHUS + CEBALLOS / CALEB JACKSON / DRESDÔN",
      startsAt: null,
      venueId: "v-other",
      venueName: "Other Club",
      venuePoint: undefined,
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("one untimed, unrelated titles -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "Chus & Ceballos + Caleb Jackson",
      startsAt: at("22:00"),
    });
    const b = side({
      id: "venue",
      title: "Salsa Social Night",
      startsAt: null,
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("one untimed, listingType class -> not auto_merge", () => {
    const a = side({
      id: "ra",
      title: "The Barbary pres. Chus & Ceballos + Caleb Jackson",
      startsAt: at("22:00"),
      listingType: "class",
    });
    const b = side({
      id: "venue",
      title: "CHUS + CEBALLOS / CALEB JACKSON / DRESDÔN",
      startsAt: null,
      listingType: "dj_night",
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("titleWordsWithinBesideVenue with 'and' dropped", () => {
    expect(
      titleWordsWithinBesideVenue(
        "Chus & Ceballos + Caleb Jackson",
        "CHUS + CEBALLOS / CALEB JACKSON / DRESDÔN",
        "The Barbary",
      ),
    ).toBe(true);
  });

  it("titleWordsWithinBesideVenue with generic words", () => {
    // "salsa" and "bachata" are both in GENERIC_TITLE_WORDS (see config/dedupe.ts)
    // So short list has 0 non-generic words -> false
    expect(
      titleWordsWithinBesideVenue("Salsa & Bachata", "Salsa Bachata Night", "The Barbary"),
    ).toBe(false);
  });
});
