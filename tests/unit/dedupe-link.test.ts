// The organizer link's pure rules (D-090): own sites, the class gate, the like-with-like start
// check and the mutual choice. Each test fails when its rule is broken.

import { describe, expect, it } from "vitest";

import {
  organizerLink,
  ownSite,
  pickLinkedPairs,
  sameKindOfNight,
  startsConflict,
  type DedupeSide,
  type EveningTimes,
  type LinkCandidate,
  type LinkSide,
} from "@/src/domain/dedupe";

describe("ownSite", () => {
  it("is the organiser's registrable domain", () => {
    expect(ownSite("https://cdny.org/")).toBe("cdny.org");
    expect(ownSite("https://www.cdny.org/events?x=1")).toBe("cdny.org");
  });

  it("is never a platform's shared domain, under any country's suffix", () => {
    expect(ownSite("https://www.eventbrite.com/o/cdny-115478120751")).toBeNull();
    expect(ownSite("https://www.eventbrite.ca/o/x-1")).toBeNull();
    expect(ownSite("https://www.eventbrite.co.uk/o/x-1")).toBeNull();
    expect(ownSite("https://www.facebook.com/cdny")).toBeNull();
    expect(ownSite("https://linktr.ee/cdny")).toBeNull();
    expect(ownSite("https://foo.business.site/")).toBeNull();
    expect(ownSite("https://checkout.square.site/merchant/x")).toBeNull();
    expect(ownSite("https://www.paypal.com/donate?id=1")).toBeNull();
    expect(ownSite("https://www.tickettailor.com/events/x")).toBeNull();
    expect(ownSite("https://publish.billsgigulator.com/shows.html?site=1052&hdr=0")).toBeNull();
  });

  it("tells two tenants of one site builder apart", () => {
    expect(ownSite("https://alhc.square.site/")).toBe("alhc.square.site");
    expect(ownSite("https://other.square.site/")).toBe("other.square.site");
    expect(ownSite("https://someone.github.io/")).toBe("someone.github.io");
  });

  it("is null for anything that is not a web address", () => {
    expect(ownSite(null)).toBeNull();
    expect(ownSite("")).toBeNull();
    expect(ownSite("mailto:hello@cdny.org")).toBeNull();
    expect(ownSite("not a url")).toBeNull();
  });
});

const side = (over: Partial<LinkSide>): LinkSide => ({
  id: "a",
  sourceId: "s1",
  trust: "first_party",
  titleNormalized: "a night",
  listingType: "social",
  sites: [],
  names: [],
  startsAt: null,
  fromRule: false,
  ...over,
});

describe("organizerLink", () => {
  const cdny = side({ id: "c", sourceId: "cdny", sites: ["cdny.org"], listingType: "class" });
  const eb = side({
    id: "e",
    sourceId: "eb",
    trust: "ticketing",
    sites: ["cdny.org"],
    listingType: "other",
  });

  it("links two sources that share the organiser's own site", () => {
    expect(organizerLink(cdny, eb)).toBe("same_site");
  });

  it("links a directory's listing titled exactly by the first-party source's name", () => {
    const twis = side({
      id: "t",
      sourceId: "twis",
      trust: "directory",
      titleNormalized: "swing remix",
    });
    const remix = side({ id: "r", sourceId: "remix", names: ["swing remix"] });
    expect(organizerLink(twis, remix)).toBe("named");
    expect(organizerLink(remix, twis)).toBe("named");
  });

  it("never links two listings of one source", () => {
    expect(organizerLink(cdny, { ...eb, sourceId: "cdny" })).toBeNull();
  });

  it("never links a class to a night that is not one", () => {
    expect(
      organizerLink({ ...cdny, listingType: "class" }, { ...eb, listingType: "social" }),
    ).toBeNull();
    const twis = side({
      id: "t",
      sourceId: "twis",
      trust: "directory",
      titleNormalized: "nylx",
      listingType: "social",
    });
    const nylindy = side({ id: "n", sourceId: "nylindy", names: ["nylx"], listingType: "class" });
    expect(organizerLink(twis, nylindy)).toBeNull();
  });

  it("does not let a first-party title vouch for itself", () => {
    const a = side({ id: "a", sourceId: "s1", titleNormalized: "swing remix" });
    const b = side({ id: "b", sourceId: "s2", names: ["swing remix"] });
    expect(organizerLink(a, b)).toBeNull();
  });

  it("never links two venues that share a calendar host (Bill's Gigulator)", () => {
    const spottedCat = side({
      id: "sc",
      sourceId: "spotted-cat",
      trust: "first_party",
      listingType: "social",
      sites: [ownSite("https://publish.billsgigulator.com/shows.html?site=1052&hdr=0")].filter(
        (s): s is string => s !== null,
      ),
      names: ["the spotted cat"],
      titleNormalized: "jenavieve cooke the winding boys",
      startsAt: new Date("2026-10-29T23:00:00Z"),
    });
    const dba = side({
      id: "dba",
      sourceId: "dba",
      trust: "first_party",
      listingType: "social",
      sites: [ownSite("https://publish.billsgigulator.com/shows.html?site=1048&hdr=0")].filter(
        (s): s is string => s !== null,
      ),
      names: ["d b a"],
      titleNormalized: "ethan santos",
      startsAt: new Date("2026-10-29T23:00:00Z"),
    });
    expect(organizerLink(spottedCat, dba)).toBeNull();
  });
});

describe("sameKindOfNight", () => {
  it("keeps a class apart from every other kind, and lets an unstated kind match anything", () => {
    expect(sameKindOfNight("class", "class")).toBe(true);
    expect(sameKindOfNight("social", "jam")).toBe(true);
    expect(sameKindOfNight("class", "social")).toBe(false);
    expect(sameKindOfNight("practica", "class")).toBe(false);
    expect(sameKindOfNight("other", "class")).toBe(true);
    expect(sameKindOfNight("social", "other")).toBe(true);
  });
});

describe("startsConflict", () => {
  const at = (hhmm: string) => new Date(`2026-10-08T${hhmm}:00-04:00`);
  const sideWith = (times: Partial<EveningTimes>): DedupeSide => {
    const t: EveningTimes = { doors: null, lesson: null, dancing: null, ...times };
    return {
      id: "x",
      startsAt: t.doors ?? t.lesson ?? t.dancing,
      organizerId: null,
      organizerName: null,
      venueId: null,
      ticketUrl: null,
      canonicalUrl: null,
      trust: "first_party",
      firstSeenAt: new Date(0),
      times: t,
    };
  };

  it("reads one source's lesson and the other's dancing soon after as one evening (F6)", () => {
    expect(
      startsConflict(sideWith({ lesson: at("20:30") }), sideWith({ dancing: at("21:00") })),
    ).toBe(false);
    expect(
      startsConflict(sideWith({ dancing: at("21:00") }), sideWith({ lesson: at("20:30") })),
    ).toBe(false);
  });

  it("still flags a structured start against dancing an hour and a half later (P2)", () => {
    expect(
      startsConflict(sideWith({ doors: at("19:00") }), sideWith({ dancing: at("20:30") })),
    ).toBe(true);
  });

  it("flags dancing before the other source's lesson (P3)", () => {
    expect(
      startsConflict(sideWith({ dancing: at("20:00") }), sideWith({ lesson: at("21:15") })),
    ).toBe(true);
  });

  it("flags a lesson with dancing more than an hour later", () => {
    expect(
      startsConflict(sideWith({ lesson: at("19:00") }), sideWith({ dancing: at("20:30") })),
    ).toBe(true);
  });

  it("compares two dancing starts as starts", () => {
    expect(
      startsConflict(sideWith({ dancing: at("21:00") }), sideWith({ dancing: at("21:30") })),
    ).toBe(true);
    expect(
      startsConflict(sideWith({ dancing: at("21:00") }), sideWith({ dancing: at("21:10") })),
    ).toBe(false);
  });
});

describe("pickLinkedPairs", () => {
  const remix = (id: string, title: string) =>
    side({ id, sourceId: "remix", names: ["swing remix"], titleNormalized: title });
  const twis = side({
    id: "t",
    sourceId: "twis",
    trust: "directory",
    titleNormalized: "swing remix",
  });
  const cand = (a: LinkSide, b: LinkSide, titleSimilarity = 0, near = false): LinkCandidate => ({
    a,
    b,
    near,
    titleSimilarity,
  });

  it("merges a directory's night into the organiser's only listing of the night", () => {
    const picked = pickLinkedPairs([cand(twis, remix("r1", "the brooks prumo orchestra"))]);
    expect(picked.map((p) => [p.a.id, p.b.id, p.link])).toEqual([["t", "r1", "named"]]);
  });

  it("leaves both listed when two partners tie (never guess)", () => {
    const picked = pickLinkedPairs([
      cand(twis, remix("r1", "band one"), 0.0),
      cand(twis, remix("r2", "band two"), 0.05),
    ]);
    expect(picked).toEqual([]);
  });

  it("lets a title that leads by the margin decide", () => {
    const picked = pickLinkedPairs([
      cand(twis, remix("r1", "band one"), 0.0),
      cand(twis, remix("r2", "swing remix night"), 0.4),
    ]);
    expect(picked.map((p) => p.b.id)).toEqual(["r2"]);
  });

  it("prefers a dated night over one a weekly rule projected, whatever the titles", () => {
    const dated = side({
      id: "d",
      sourceId: "cdny",
      sites: ["cdny.org"],
      titleNormalized: "special double contra dance",
    });
    const rule = side({
      id: "r",
      sourceId: "cdny",
      sites: ["cdny.org"],
      fromRule: true,
      titleNormalized: "contra saturdays",
    });
    const eb = side({
      id: "e",
      sourceId: "eb",
      trust: "ticketing",
      sites: ["cdny.org"],
      listingType: "other",
    });
    const picked = pickLinkedPairs([cand(eb, rule, 0.6, true), cand(eb, dated, 0.2, true)]);
    expect(picked.map((p) => p.b.id)).toEqual(["d"]);
  });

  it("needs a shared place for a shared site", () => {
    const cdny = side({ id: "c", sourceId: "cdny", sites: ["cdny.org"] });
    const eb = side({
      id: "e",
      sourceId: "eb",
      trust: "ticketing",
      sites: ["cdny.org"],
      listingType: "other",
    });
    expect(pickLinkedPairs([cand(eb, cdny, 0.2, false)])).toEqual([]);
    expect(pickLinkedPairs([cand(eb, cdny, 0.2, true)])).toHaveLength(1);
  });

  it("keeps a pair only when each side is the other's choice", () => {
    // The directory's night picks r1 (title), but r1's best partner from the directory is t2.
    const t2 = side({
      id: "t2",
      sourceId: "twis",
      trust: "directory",
      titleNormalized: "swing remix",
    });
    const r1 = remix("r1", "swing remix late");
    const r2 = remix("r2", "other band");
    const picked = pickLinkedPairs([cand(twis, r1, 0.5), cand(twis, r2, 0.0), cand(t2, r1, 0.9)]);
    expect(picked.map((p) => [p.a.id, p.b.id])).toEqual([["t2", "r1"]]);
  });

  it("never pairs listings whose starts are more than 90 minutes apart", () => {
    const a = { ...twis, startsAt: new Date("2026-10-03T20:00:00-04:00") };
    const b = { ...remix("r1", "x"), startsAt: new Date("2026-10-03T22:00:00-04:00") };
    expect(pickLinkedPairs([cand(a, b)])).toEqual([]);
  });
});
