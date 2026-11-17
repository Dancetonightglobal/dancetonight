import { describe, expect, it } from "vitest";

import {
  chooseSurvivor,
  fillsTime,
  sameNight,
  scorePair,
  startsConflict,
  urlFamily,
  type DedupeSide,
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

describe("D-146 one night from two sources", () => {
  it("same default start, titleSimilarity 0.95, no organizer, no URL -> auto_merge", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b" });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.95,
      organizerSimilarity: null,
    });
    expect(scored.decision).toBe("auto_merge");
    expect(scored.score).toBeCloseTo(0.5 * 0.95 + 0.1, 3); // 0.575
  });

  it("starts 10 minutes apart, titleSimilarity 0.9 -> auto_merge", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b", startsAt: new Date("2026-09-26T01:10:00Z") });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.9,
      organizerSimilarity: null,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("starts 30 minutes apart, titleSimilarity 1 -> not auto_merge (queued)", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b", startsAt: new Date("2026-09-26T01:30:00Z") });
    const scored = scorePair(a, b, {
      titleSimilarity: 1,
      organizerSimilarity: null,
    });
    expect(scored.decision).toBe("queued");
    expect(scored.score).toBeCloseTo(0.6, 3); // 0.5*1 + 0.1
  });

  it("titleSimilarity 0.85, same start -> queued", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b" });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.85,
      organizerSimilarity: null,
    });
    expect(scored.decision).toBe("queued");
  });

  it("one side startsAt: null, titleSimilarity 1 -> auto_merge (untimed copy)", () => {
    const a = side({ id: "a", startsAt: null });
    const b = side({ id: "b" });
    const scored = scorePair(a, b, {
      titleSimilarity: 1,
      organizerSimilarity: null,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("sameNight returns true for matching criteria", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b" });
    const facts = { titleSimilarity: 0.95, organizerSimilarity: null };
    expect(sameNight(a, b, facts)).toBe(true);
  });

  it("sameNight returns false when starts are too far apart", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b", startsAt: new Date("2026-09-26T01:30:00Z") });
    const facts = { titleSimilarity: 1, organizerSimilarity: null };
    expect(sameNight(a, b, facts)).toBe(false);
  });

  it("titlePrefix true, same start -> auto_merge", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b" });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.5,
      organizerSimilarity: null,
      titlePrefix: true,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("titlePrefix true, starts 30 minutes apart -> not auto_merge", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b", startsAt: new Date("2026-09-26T01:30:00Z") });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.5,
      organizerSimilarity: null,
      titlePrefix: true,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("titlePrefix false, low similarity -> distinct", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b" });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.5,
      organizerSimilarity: null,
      titlePrefix: false,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("untimed side + titleSimilarity 0.95 -> auto_merge", () => {
    const a = side({ id: "a", startsAt: null });
    const b = side({ id: "b" });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.95,
      organizerSimilarity: null,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("untimed side + titleSimilarity 0.6 -> not auto_merge", () => {
    const a = side({ id: "a", startsAt: null });
    const b = side({ id: "b" });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.6,
      organizerSimilarity: null,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("both timed 3 hours apart, titleSimilarity 1, shiftedSource: true -> auto_merge", () => {
    const a = side({ id: "a", startsAt: new Date("2026-09-26T01:00:00Z") });
    const b = side({ id: "b", startsAt: new Date("2026-09-26T04:00:00Z") });
    const scored = scorePair(a, b, {
      titleSimilarity: 1,
      organizerSimilarity: null,
      shiftedSource: true,
    });
    expect(scored.decision).toBe("auto_merge");
  });

  it("both timed 3 hours apart, titleSimilarity 1, shiftedSource: false -> not auto_merge", () => {
    const a = side({ id: "a", startsAt: new Date("2026-09-26T01:00:00Z") });
    const b = side({ id: "b", startsAt: new Date("2026-09-26T04:00:00Z") });
    const scored = scorePair(a, b, {
      titleSimilarity: 1,
      organizerSimilarity: null,
      shiftedSource: false,
    });
    expect(scored.decision).toBe("queued");
  });
});

describe("D-006 scoring", () => {
  it("merges the same night listed by its organizer and a ticketing site", () => {
    const a = side({ id: "a", organizerId: "o1", ticketUrl: "https://tix.example/1" });
    const b = side({
      id: "b",
      organizerId: "o1",
      ticketUrl: "https://tix.example/1",
      trust: "ticketing",
    });
    const scored = scorePair(a, b, { titleSimilarity: 0.7, organizerSimilarity: null });
    expect(scored.score).toBeCloseTo(0.85, 3);
    expect(scored.decision).toBe("auto_merge");
  });

  it("queues the borderline band for a later model check", () => {
    const a = side({ id: "a" });
    const b = side({ id: "b", startsAt: new Date("2026-09-26T02:00:00Z") });
    const scored = scorePair(a, b, {
      titleSimilarity: 0.9,
      organizerSimilarity: null,
    });
    expect(scored).toMatchObject({ score: 0.55, decision: "queued" });
  });

  it("keeps two different nights at one venue distinct", () => {
    // Tango La Nacional and Blues Dance New York share 239 W 14th St (SOURCES 8).
    const scored = scorePair(side({ id: "a" }), side({ id: "b" }), {
      titleSimilarity: 0.1,
      organizerSimilarity: 0.2,
    });
    expect(scored.decision).toBe("distinct");
  });

  it("counts organizer names that match closely as one organizer", () => {
    const scored = scorePair(side({ id: "a" }), side({ id: "b" }), {
      titleSimilarity: 1,
      organizerSimilarity: 0.95,
    });
    expect(scored.parts.organizer).toBe(0.2);
    expect(scored.decision).toBe("auto_merge");
  });

  it("does not count two listings on one aggregator as the same URL", () => {
    expect(urlFamily("https://www.eventbrite.com/e/salsa-123")).toBe("eventbrite.com/e");
    const scored = scorePair(
      side({ id: "a", canonicalUrl: "https://www.eventbrite.com/e/salsa-1" }),
      side({ id: "b", canonicalUrl: "https://www.eventbrite.com/e/bachata-2" }),
      { titleSimilarity: 0.5, organizerSimilarity: null },
    );
    expect(scored.parts.url).toBe(0);
  });
});

describe("sameNight: one end at one venue", () => {
  const facts = { titleSimilarity: 1, organizerSimilarity: null };
  const END = new Date("2026-09-26T10:00:00Z");
  const LATE_START = new Date("2026-09-26T02:15:00Z"); // 75 minutes after the default start

  it("joins equal ends at one venue despite starts 75 minutes apart, and shows both starts", () => {
    const a = side({ id: "a", endsAt: END });
    const b = side({ id: "b", startsAt: LATE_START, endsAt: END });
    expect(sameNight(a, b, facts)).toBe(true);
    expect(scorePair(a, b, facts).decision).toBe("auto_merge");
    expect(startsConflict(a, b)).toBe(true);
  });

  it("does not join ends one minute apart", () => {
    const a = side({ id: "a", endsAt: END });
    const b = side({
      id: "b",
      startsAt: LATE_START,
      endsAt: new Date(END.getTime() + 60_000),
    });
    expect(sameNight(a, b, facts)).toBe(false);
  });

  it("does not apply when one end is null", () => {
    const a = side({ id: "a", endsAt: END });
    const b = side({ id: "b", startsAt: LATE_START, endsAt: null });
    expect(sameNight(a, b, facts)).toBe(false);
  });

  it("does not apply at different venues", () => {
    const a = side({ id: "a", endsAt: END });
    const b = side({ id: "b", startsAt: LATE_START, endsAt: END, venueId: "v2" });
    expect(sameNight(a, b, facts)).toBe(false);
  });

  it("does not apply when neither side has a venue", () => {
    const a = side({ id: "a", venueId: null, endsAt: END });
    const b = side({ id: "b", venueId: null, startsAt: LATE_START, endsAt: END });
    expect(sameNight(a, b, facts)).toBe(false);
  });

  it("does not apply when the titles are not alike", () => {
    const a = side({ id: "a", endsAt: END });
    const b = side({ id: "b", startsAt: LATE_START, endsAt: END });
    expect(
      sameNight(a, b, { titleSimilarity: 0.5, organizerSimilarity: null, titlePrefix: false }),
    ).toBe(false);
  });
});

describe("merging", () => {
  it("keeps the first-party listing, then the earliest seen, then the lower id", () => {
    const first = side({ id: "z", trust: "first_party" });
    const ticket = side({ id: "a", trust: "ticketing" });
    expect(chooseSurvivor(ticket, first).survivor.id).toBe("z");
    const older = side({ id: "b", firstSeenAt: new Date("2026-09-01T00:00:00Z") });
    expect(chooseSurvivor(side({ id: "a" }), older).survivor.id).toBe("b");
    expect(chooseSurvivor(side({ id: "b" }), side({ id: "a" })).survivor.id).toBe("a");
  });

  it("marks starts more than 15 minutes apart as a conflict", () => {
    expect(startsConflict(side({}), side({ startsAt: new Date("2026-09-26T01:10:00Z") }))).toBe(
      false,
    );
    expect(startsConflict(side({}), side({ startsAt: new Date("2026-09-26T01:30:00Z") }))).toBe(
      true,
    );
  });

  it("never counts a listing with no time as a conflict (D-060)", () => {
    expect(startsConflict(side({ startsAt: null }), side({}))).toBe(false);
    expect(startsConflict(side({}), side({ startsAt: null }))).toBe(false);
    expect(startsConflict(side({ startsAt: null }), side({ startsAt: null }))).toBe(false);
  });

  it("keeps trust precedence for the survivor, and fills its times only when it has none", () => {
    const untimedFirstParty = side({ id: "own", startsAt: null, trust: "first_party" });
    const timedTicketing = side({ id: "tix", trust: "ticketing" });
    const { survivor, merged } = chooseSurvivor(timedTicketing, untimedFirstParty);
    expect(survivor.id).toBe("own");
    expect(fillsTime(survivor, merged)).toBe(true);
    // The other way round there is nothing to fill: the survivor has its own time.
    expect(fillsTime(timedTicketing, untimedFirstParty)).toBe(false);
    expect(fillsTime(side({ startsAt: null }), side({ startsAt: null }))).toBe(false);
    expect(fillsTime(side({}), side({}))).toBe(false);
  });
});
