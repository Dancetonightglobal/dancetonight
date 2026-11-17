// The one-venue-one-start rule (D-150): one night whose titles differ only by extras, as found on
// the live site on 2026-10-17.
import { describe, expect, it } from "vitest";

import {
  scorePair,
  type DedupeSide,
  coreTitleWords,
  coreTitleKey,
  isStatusCopy,
  coreTitlePrefix,
  oneVenueOneStart,
  sharedTitleSegment,
} from "@/src/domain/dedupe";

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: new Date("2026-09-26T01:00:00Z"),
  organizerId: null,
  organizerName: null,
  venueId: "v1",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "first_party",
  firstSeenAt: new Date("2026-09-20T00:00:00Z"),
  ...over,
});

describe("coreTitleWords", () => {
  it("removes age marks", () => {
    expect(coreTitleWords("Black Coffee - Ages 21+")).toEqual(["black", "coffee"]);
    expect(coreTitleWords("QTS: Brooklyn ft. Farius + Solarstone")).toEqual(["qts", "brooklyn"]);
  });
  it("handles apostrophes", () => {
    expect(coreTitleWords("Willie’s Steak House")).toEqual(["willies", "steak", "house"]);
  });
  it("removes leading status tags", () => {
    // After removing "CANCELLED:", we have "A Barn Dance". Then we drop leading article "a".
    expect(coreTitleWords("CANCELLED: A Barn Dance")).toEqual(["barn", "dance"]);
  });
  it("cuts venue suffix after @", () => {
    expect(
      coreTitleWords("A Nightmare On Vine Street: Halloween Party @ NOTO Philadelphia"),
    ).toEqual(["nightmare", "on", "vine", "street", "halloween", "party"]);
    expect(coreTitleWords("valentino khan @ noto philadelphia")).toEqual(["valentino", "khan"]);
    // "@ The Loft" doesn't match venue suffix pattern, so remains "@ The Loft".
    // After splitting, we get ["the", "loft"], then drop leading article "the".
    expect(coreTitleWords("@ The Loft")).toEqual(["loft"]);
  });
  it("replaces ampersand with and", () => {
    expect(coreTitleWords("Ball & Chain")).toEqual(["ball", "and", "chain"]);
    expect(coreTitleWords("BachaTuesdays at Ball & Chain")).toEqual([
      "bachatuesdays",
      "at",
      "ball",
      "and",
      "chain",
    ]);
  });
  it("drops leading article a/an/the", () => {
    expect(coreTitleWords("A Nightmare On Vine Street")).toEqual([
      "nightmare",
      "on",
      "vine",
      "street",
    ]);
    expect(coreTitleWords("The Nightmare")).toEqual(["nightmare"]);
    expect(coreTitleWords("An Evening")).toEqual(["evening"]);
    expect(coreTitleWords("A Night at the Opera")).toEqual(["night", "at", "the", "opera"]);
    expect(coreTitleWords("The")).toEqual(["the"]);
  });
});

describe("coreTitleKey", () => {
  it("joins words without spaces", () => {
    expect(coreTitleKey("Latin Night at Willie’s Steak House")).toBe(
      "latinnightatwilliessteakhouse",
    );
    expect(coreTitleKey("Latin Night at Willies Steakhouse")).toBe("latinnightatwilliessteakhouse");
  });
});

describe("isStatusCopy", () => {
  it("returns true for cancelled/canceled/postponed", () => {
    expect(isStatusCopy("CANCELLED: A Barn Dance")).toBe(true);
    expect(isStatusCopy("Canceled: Something")).toBe(true);
    expect(isStatusCopy("Postponed: Event")).toBe(true);
  });
  it("returns false for sold out", () => {
    expect(isStatusCopy("Sold Out: X")).toBe(false);
  });
  it("returns false for normal titles", () => {
    expect(isStatusCopy("A Barn Dance")).toBe(false);
  });
});

describe("sharedTitleSegment", () => {
  it("function exists", () => {
    expect(typeof sharedTitleSegment).toBe("function");
  });

  it("returns true for NOTO vs Drake pair", () => {
    const a = "A Nightmare On Vine Street: Halloween Party @ NOTO Philadelphia";
    const b = "Nightmare on Vine Street: Drake vs Bad Bunny Dance Night";
    expect(sharedTitleSegment(a, b)).toBe(true);
  });
  it("returns false for generic-only segment", () => {
    // Assuming "salsa" and "night" are in GENERIC_TITLE_WORDS
    const a = "Salsa Night: Room 1";
    const b = "Salsa Night: Room 2";
    expect(sharedTitleSegment(a, b)).toBe(false);
  });
  it("returns false for no segment separator", () => {
    const a = "Hocus Pocus 2026 (Friday Pass)";
    const b = "Hocus Pocus 2026 (3-Day Pass)";
    expect(sharedTitleSegment(a, b)).toBe(false);
  });
  it("returns false for unrelated titles", () => {
    const a = "NEVER LEAVE MIAMI ON A SUNDAY!";
    const b = "REVENGE MIAMI SUNDAYS";
    expect(sharedTitleSegment(a, b)).toBe(false);
  });
  it("returns true for segment with at least 2 non-generic words", () => {
    const a = "Halloween Party: Special Edition";
    const b = "Halloween Party: Extended Mix";
    expect(sharedTitleSegment(a, b)).toBe(true);
  });
});

describe("coreTitlePrefix", () => {
  it("returns true for matching core keys", () => {
    expect(
      coreTitlePrefix("Latin Night at Willie’s Steak House", "Latin Night at Willies Steakhouse"),
    ).toBe(true);
  });
  it("returns true for prefix matches", () => {
    expect(coreTitlePrefix("Midtown Swings", "Midtown Swings Weekly Party")).toBe(true);
  });
  it("returns false for generic-only titles", () => {
    expect(coreTitlePrefix("Salsa", "Salsa Level 2")).toBe(false);
    expect(coreTitlePrefix("Bachata Social", "Bachata Social with DJ Tony")).toBe(false);
  });
});

describe("oneVenueOneStart", () => {
  const a = side({ venueId: "v1", startsAt: new Date("2026-09-26T01:00:00Z") });
  const b = side({ venueId: "v1", startsAt: new Date("2026-09-26T01:00:00Z") });
  const c = side({ venueId: "v2", startsAt: new Date("2026-09-26T01:00:00Z") });
  const d = side({ venueId: "v1", startsAt: new Date("2026-09-26T01:30:00Z") });
  const e = side({ venueId: null, startsAt: new Date("2026-09-26T01:00:00Z") });
  const f = side({ venueId: "v1", startsAt: null });

  it("returns true for same venue and start within threshold", () => {
    expect(oneVenueOneStart(a, b)).toBe(true);
  });
  it("returns false for different venue", () => {
    expect(oneVenueOneStart(a, c)).toBe(false);
  });
  it("returns false for start beyond threshold", () => {
    expect(oneVenueOneStart(a, d)).toBe(false);
  });
  it("returns false for null venueId", () => {
    expect(oneVenueOneStart(a, e)).toBe(false);
  });
  it("returns false for null startsAt", () => {
    expect(oneVenueOneStart(a, f)).toBe(false);
  });
});

describe("D-146 one venue one start rule", () => {
  const venueId = "v1";
  const start = new Date("2026-09-26T01:00:00Z");
  const baseSide = (title: string) => side({ title, venueId, startsAt: start });

  it("leaves the NOTO / Drake pair apart at two venues", () => {
    const a = side({
      title: "A Nightmare On Vine Street: Halloween Party @ NOTO Philadelphia",
      venueId: "v1",
      startsAt: start,
    });
    const b = side({
      title: "Nightmare on Vine Street: Drake vs Bad Bunny Dance Night",
      venueId: "v2",
      startsAt: start,
    });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).not.toBe("auto_merge");
  });

  it("merges Mireya pair", () => {
    const a = baseSide("Mireya");
    const b = baseSide("Mireya Ramos (of Flor de Toloache)");
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("merges Black Coffee pair", () => {
    const a = baseSide("Black Coffee");
    const b = baseSide("Black Coffee - Ages 21+");
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("merges QTS pair", () => {
    const a = baseSide("QTS: Brooklyn");
    const b = baseSide("QTS: Brooklyn ft. Farius + Solarstone");
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("merges KEIN KLUB pair", () => {
    const a = baseSide("KEIN KLUB");
    const b = baseSide("Kein Klub: Intergalactic Gary, Soundstream, Mike Servito, Amelia Holt");
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("merges Midtown Swings pair", () => {
    const a = baseSide("Midtown Swings");
    const b = baseSide("Midtown Swings – Weekly Swing Dance Party");
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("merges Barn Dance pair", () => {
    const a = baseSide("A Barn Dance in Battery Park City!");
    const b = baseSide("CANCELLED: A Barn Dance in Battery Park City!");
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("merges Latin Night pair", () => {
    const a = baseSide("Latin Night at Willie’s Steak House");
    const b = baseSide("Latin Night at Willies Steakhouse");
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("does not merge with different venue", () => {
    const a = side({ title: "Mireya", venueId: "v1", startsAt: start });
    const b = side({ title: "Mireya Ramos (of Flor de Toloache)", venueId: "v2", startsAt: start });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("does not merge with start 30 minutes apart", () => {
    const later = new Date("2026-09-26T01:30:00Z");
    const a = side({ title: "Mireya", venueId: "v1", startsAt: start });
    const b = side({ title: "Mireya Ramos (of Flor de Toloache)", venueId: "v1", startsAt: later });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("does not merge generic-only titles", () => {
    const a = side({ title: "Salsa", venueId: "v1", startsAt: start });
    const b = side({ title: "Salsa Level 2", venueId: "v1", startsAt: start });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("does not merge Bachata Social generic", () => {
    const a = side({ title: "Bachata Social", venueId: "v1", startsAt: start });
    const b = side({ title: "Bachata Social with DJ Tony", venueId: "v1", startsAt: start });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("does not merge when title is missing", () => {
    const a = side({ venueId: "v1", startsAt: start }); // no title
    const b = side({ title: "Mireya Ramos (of Flor de Toloache)", venueId: "v1", startsAt: start });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("merges NOTO pair via sharedTitleSegment", () => {
    const a = side({
      title: "A Nightmare On Vine Street: Halloween Party @ NOTO Philadelphia",
      venueId: "v1",
      startsAt: new Date("2026-09-26T01:00:00Z"),
    });
    const b = side({
      title: "Nightmare on Vine Street: Drake vs Bad Bunny Dance Night",
      venueId: "v1",
      startsAt: new Date("2026-09-26T01:00:00Z"),
    });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("does not merge NOTO pair with different venue", () => {
    const a = side({
      title: "A Nightmare On Vine Street: Halloween Party @ NOTO Philadelphia",
      venueId: "v1",
      startsAt: new Date("2026-09-26T01:00:00Z"),
    });
    const b = side({
      title: "Nightmare on Vine Street: Drake vs Bad Bunny Dance Night",
      venueId: "v2", // different venue
      startsAt: new Date("2026-09-26T01:00:00Z"),
    });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.3,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("distinct");
  });
});
