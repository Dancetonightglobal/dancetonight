import { describe, expect, it } from "vitest";
import {
  scorePair,
  foldWeekdayPlural,
  sameTitleBesideVenue,
  type DedupeSide,
  type PairFacts,
} from "@/src/domain/dedupe";

const at = (hhmm: string, day = "2026-11-02") => new Date(`${day}T${hhmm}:00-05:00`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("19:00"),
  organizerId: null,
  organizerName: null,
  venueId: "v-westwood",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "dj_night",
  endsAt: at("23:00"),
  venueName: "Westwood",
  ...over,
});

const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.3,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

describe("foldWeekdayPlural", () => {
  it("maps plural weekdays to singular", () => {
    expect(foldWeekdayPlural("mondays")).toBe("monday");
    expect(foldWeekdayPlural("tuesdays")).toBe("tuesday");
    expect(foldWeekdayPlural("wednesdays")).toBe("wednesday");
    expect(foldWeekdayPlural("thursdays")).toBe("thursday");
    expect(foldWeekdayPlural("fridays")).toBe("friday");
    expect(foldWeekdayPlural("saturdays")).toBe("saturday");
    expect(foldWeekdayPlural("sundays")).toBe("sunday");
  });

  it("leaves other words unchanged", () => {
    expect(foldWeekdayPlural("monday")).toBe("monday");
    expect(foldWeekdayPlural("mondo")).toBe("mondo");
    expect(foldWeekdayPlural("party")).toBe("party");
  });
});

describe("sameTitleBesideVenue", () => {
  it("matches Westwood pair", () => {
    const a = "mambo monday";
    const b = "Mambo Mondays at Westwood";
    expect(sameTitleBesideVenue(a, b, ["Westwood", "Westwood Cocktail Bar"])).toBe(true);
    expect(sameTitleBesideVenue(b, a, ["Westwood", "Westwood Cocktail Bar"])).toBe(true);
  });

  it("fails when all generic", () => {
    const a = "Salsa Night";
    const b = "Salsa Nights at Westwood";
    expect(sameTitleBesideVenue(a, b, ["Westwood"])).toBe(false);
  });

  it("fails when sets differ", () => {
    const a = "Mambo Monday";
    const b = "Mambo Monday Beginner Class";
    expect(sameTitleBesideVenue(a, b, ["Westwood"])).toBe(false);
  });

  it("works with multiple venue names", () => {
    const a = "mambo monday";
    const b = "Mambo Mondays at Westwood Cocktail Bar";
    expect(sameTitleBesideVenue(a, b, ["Westwood", "Westwood Cocktail Bar"])).toBe(true);
  });
});

describe("D-522 follow-up: Westwood pair", () => {
  it("auto_merge when dj_night vs class but titles same beside venue", () => {
    const a = side({
      id: "westwood",
      title: "mambo monday",
      venueName: "Westwood",
      listingType: "dj_night",
    });
    const b = side({
      id: "gumbo",
      title: "Mambo Mondays at Westwood",
      venueName: "Westwood Cocktail Bar",
      listingType: "class",
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
    expect(scorePair(b, a, facts()).decision).toBe("auto_merge");
  });

  it("NOT auto_merge when title reads as a class", () => {
    const a = side({
      id: "westwood",
      title: "mambo monday",
      venueName: "Westwood",
      listingType: "dj_night",
    });
    const b = side({
      id: "gumbo",
      title: "Mambo Monday Beginner Class",
      venueName: "Westwood Cocktail Bar",
      listingType: "class",
      // 75 min later: outside the one-start rules (D-271's prefix test merges across kinds at one start),
      // inside D-522's 90-minute window, so only the D-522 kind guard decides.
      startsAt: at("20:15"),
    });
    // isClassLike will detect "beginner" in title, so sameTitleBesideVenue will not bypass kind guard
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("NOT auto_merge when sameSource true", () => {
    const a = side({
      id: "westwood",
      title: "mambo monday",
      venueName: "Westwood",
      listingType: "dj_night",
    });
    const b = side({
      id: "gumbo",
      title: "Mambo Mondays at Westwood",
      venueName: "Westwood Cocktail Bar",
      listingType: "class",
    });
    expect(scorePair(a, b, facts({ sameSource: true })).decision).not.toBe("auto_merge");
  });

  it("NOT auto_merge when starts 3 hours apart", () => {
    const a = side({
      id: "westwood",
      title: "mambo monday",
      venueName: "Westwood",
      listingType: "dj_night",
      startsAt: at("19:00"),
    });
    const b = side({
      id: "gumbo",
      title: "Mambo Mondays at Westwood",
      venueName: "Westwood Cocktail Bar",
      listingType: "class",
      startsAt: at("22:00"),
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("auto_merge when both class kind", () => {
    const a = side({
      id: "westwood",
      title: "mambo monday",
      venueName: "Westwood",
      listingType: "class",
    });
    const b = side({
      id: "gumbo",
      title: "Mambo Mondays at Westwood",
      venueName: "Westwood Cocktail Bar",
      listingType: "class",
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
  });

  it("NOT auto_merge when all generic words across kinds", () => {
    const a = side({
      id: "westwood",
      title: "Salsa Monday",
      venueName: "Westwood",
      listingType: "dj_night",
    });
    const b = side({
      id: "gumbo",
      title: "Salsa Mondays at Westwood",
      venueName: "Westwood Cocktail Bar",
      listingType: "class",
    });
    // "salsa" and "monday" are generic, so sameTitleBesideVenue returns false
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });
});
