import { describe, expect, it } from "vitest";
import { scorePair, sharedEventPage, type DedupeSide, type PairFacts } from "@/src/domain/dedupe";

// D-749: a directory's page for one event (salsavida.com/event/...) shared by two copies of one
// night is one event, like a seller's or platform's page (D-592). Mexico City 2026-11-05 (daily
// check): salsavida "Mama Rumba Mexico City: Salsa Nights" 9pm stood beside where-to-dance's
// "Salsa Night at Mama Rumba (Thursday)" 8pm, which carried the same salsavida page as a
// secondary source. The pair was queued (0.729) because the page was not a "hosted" event page.

const PAGE = "https://www.salsavida.com/event/mexico/mexico-city/salsa-nights-at-mama-rumba/";
const at = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00Z`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("02:00"),
  organizerId: null,
  organizerName: null,
  venueId: "v-mama",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "social",
  endsAt: null,
  venueName: "Mama Rumba",
  ...over,
});
const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.45,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

const salsavida = side({
  id: "sv",
  title: "Mama Rumba Mexico City: Salsa Nights",
  startsAt: at("03:00"),
  links: ["https://www.salsavida.com/guides/mexico/mexico-city/", PAGE],
});
const wtd = side({
  id: "wtd",
  title: "Salsa Night at Mama Rumba (Thursday)",
  venueId: "v-mama-2",
  links: [
    "https://www.where-to-dance-salsa.com/mexico-city/",
    "https://www.salsavida.com/guides/mexico/mexico-city/",
    PAGE.replace("https://www.", "https://"),
  ],
});

describe("a directory's page for one event (D-749)", () => {
  it("counts as one shared event page", () => {
    expect(sharedEventPage(salsavida, wtd)).toBe(true);
  });
  it("merges the two Mama Rumba copies an hour apart", () => {
    expect(scorePair(salsavida, wtd, facts()).decision).toBe("auto_merge");
  });
  it("does not count the directory's city guide (a list of many nights)", () => {
    const a = side({ links: ["https://www.salsavida.com/guides/mexico/mexico-city/"] });
    const b = side({ links: ["https://www.salsavida.com/guides/mexico/mexico-city/"] });
    expect(sharedEventPage(a, b)).toBe(false);
  });
  it("does not count a directory's venue page", () => {
    const v = "https://www.where-to-dance-salsa.com/venues/mama-rumba";
    expect(sharedEventPage(side({ links: [v] }), side({ links: [v] }))).toBe(false);
  });
  it("does not count a page on a site that is not a directory", () => {
    const own = "https://mamarumba.com.mx/salsa-nights";
    expect(sharedEventPage(side({ links: [own] }), side({ links: [own] }))).toBe(false);
  });
  it("does not merge two different nights on one directory page", () => {
    const a = side({ id: "x", title: "Bachata Workshop", startsAt: at("00:00"), links: [PAGE] });
    expect(scorePair(salsavida, a, facts({ titleSimilarity: 0.05 })).decision).not.toBe(
      "auto_merge",
    );
  });
});

describe("both titles name the venue, one event page (D-749)", () => {
  it("does not merge a class with a night even when both name the venue", () => {
    const cls = side({
      id: "c",
      title: "Salsa Class at Mama Rumba",
      listingType: "class",
      links: [PAGE],
    });
    expect(scorePair(salsavida, cls, facts()).decision).not.toBe("auto_merge");
  });
  it("needs the shared page: same venue in both titles alone is not enough", () => {
    const a = { ...salsavida, links: [] };
    const b = { ...wtd, links: [] };
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });
});
