import { describe, expect, it } from "vitest";
import { scorePair, sharedEventPage, type DedupeSide, type PairFacts } from "@/src/domain/dedupe";

// D-592: one seller's or platform's page for one event, on one night, is one event whatever the
// starts and whichever source carried it. London Palais 2026-11-06 (daily check 11-05): the ra.co
// page said 7pm-5am, palais.co.uk 11pm with its ticket link to that same ra.co page, and dice
// 10pm-4am, whose earlier copy had already been merged into the palais.co.uk listing (so the two
// shared a source and every cross-source rule was off). Three cards for one night.

const at = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00Z`);

const RA = "https://ra.co/events/2532212";
const DICE = "https://dice.fm/event/6aac7015a78d56000151d695";

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("23:00"),
  organizerId: null,
  organizerName: null,
  venueId: "v-palais",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "dj_night",
  endsAt: null,
  venueName: "Palais",
  ...over,
});

const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.55,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

// palais.co.uk's listing: 11pm, tickets at ra.co, the dice copy merged in earlier.
const palais = side({
  id: "palais",
  title: "Axel Boman, CC:DISCO!",
  trust: "first_party",
  organizerId: "o-palais",
  ticketUrl: RA,
  canonicalUrl: "https://palais.co.uk/whats-on",
  links: ["https://palais.co.uk/whats-on", RA, DICE],
});
const ra = side({
  id: "ra",
  title: "Palais: Axel Boman & CC:DISCO",
  startsAt: at("19:00"),
  endsAt: new Date("2026-11-07T05:00:00Z"),
  ticketUrl: RA,
  canonicalUrl: RA,
  links: [RA],
});
const dice = side({
  id: "dice",
  title: "Palais: Axel Boman & CC:DISCO",
  startsAt: at("22:00"),
  endsAt: new Date("2026-11-07T04:00:00Z"),
  ticketUrl: DICE,
  canonicalUrl: DICE,
  links: [DICE],
});

describe("sharedEventPage", () => {
  it("is true for one ra.co event page on both sides", () => {
    expect(sharedEventPage(palais, ra)).toBe(true);
  });
  it("counts a link carried by a merged-in source", () => {
    expect(sharedEventPage(palais, dice)).toBe(true);
  });
  it("matches the same page written differently (www, trailing slash, tracking)", () => {
    const a = side({ links: ["https://www.ra.co/events/2532212/?utm_source=x"] });
    const b = side({ ticketUrl: RA });
    expect(sharedEventPage(a, b)).toBe(true);
  });
  it("is false for a shared venue listing page", () => {
    const a = side({ links: ["https://palais.co.uk/whats-on"] });
    const b = side({ canonicalUrl: "https://palais.co.uk/whats-on" });
    expect(sharedEventPage(a, b)).toBe(false);
  });
  it("is false for a seller's organiser page (lists many nights)", () => {
    const org = "https://www.eventbrite.co.uk/o/funky-mambo-123456";
    expect(sharedEventPage(side({ ticketUrl: org }), side({ ticketUrl: org }))).toBe(false);
  });
  it("is false with no links", () => {
    expect(sharedEventPage(side({}), side({}))).toBe(false);
  });
});

describe("one event page, one night (D-592)", () => {
  it("merges ra.co 7pm with palais.co.uk 11pm (same ra.co ticket link, 4h apart)", () => {
    expect(scorePair(palais, ra, facts()).decision).toBe("auto_merge");
  });
  it("merges dice 10pm into the listing its earlier copy was merged into (shared source)", () => {
    expect(scorePair(palais, dice, facts({ sameSource: true })).decision).toBe("auto_merge");
  });
  it("does not merge two different shows sold on one event page", () => {
    const early = side({ id: "e", title: "Comedy Hour", startsAt: at("19:00"), ticketUrl: RA });
    const late = side({ id: "l", title: "Techno All Night", startsAt: at("23:00"), ticketUrl: RA });
    expect(scorePair(early, late, facts({ titleSimilarity: 0.05 })).decision).not.toBe(
      "auto_merge",
    );
  });
  it("does not join a cancelled listing to a live one through the rule", () => {
    const gone = { ...ra, cancelled: true };
    expect(scorePair(palais, gone, facts({ titleSimilarity: 0.3 })).decision).not.toBe(
      "auto_merge",
    );
  });
  it("does not merge a class with a night on one page", () => {
    const cls = side({
      id: "c",
      title: "Axel Boman, CC:DISCO! warm-up class",
      listingType: "class",
      startsAt: at("19:00"),
      ticketUrl: RA,
    });
    expect(scorePair(palais, cls, facts({ titleSimilarity: 0.3 })).decision).not.toBe("auto_merge");
  });
  it("needs an event page: a shared venue page and a 4h gap stay apart", () => {
    const a = { ...palais, ticketUrl: null, links: ["https://palais.co.uk/whats-on"] };
    const b = {
      ...ra,
      ticketUrl: null,
      canonicalUrl: null,
      links: ["https://palais.co.uk/whats-on"],
    };
    expect(scorePair(a, b, facts({ titleSimilarity: 0.3 })).decision).not.toBe("auto_merge");
  });
});
