import { describe, expect, it } from "vitest";
import type { DedupeSide } from "@/src/domain/dedupe";
import { sameTitleNearVenues } from "@/src/domain/same-title-near-venues";

const at = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00Z`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("23:45"),
  organizerId: null,
  organizerName: null,
  venueId: "v1",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "ticketing",
  firstSeenAt: new Date("2026-10-29T00:00:00Z"),
  listingType: "other",
  endsAt: null,
  venueName: "Fire Night Club Vauxhall",
  title: "Fuego",
  titleNormalized: "fuego",
  venuePoint: { lat: 51.48585, lng: -0.12275 },
  ...over,
});

describe("sameTitleNearVenues", () => {
  // True cases
  it("true for Fuego case", () => {
    const a = side({});
    const b = side({
      id: "b",
      venueId: "v2",
      venueName: "FIRE Nightclub London",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(true);
  });

  it("true for House of Yes case", () => {
    const a = side({
      title: "Rhythm in Ritual: Native Sun, JazzyWoo, DJ Shango, DJ Born & Zen Xaria",
      titleNormalized: "rhythm in ritual native sun jazzywoo dj shango dj born zen xaria",
      startsAt: at("22:00"),
      venueName: "House of Yes",
      venuePoint: { lat: 40.71239, lng: -73.93534 },
    });
    const b = side({
      id: "b",
      title: "Rhythm in Ritual: Native Sun, JazzyWoo, DJ Shango, DJ Born & Zen Xaria",
      titleNormalized: "rhythm in ritual native sun jazzywoo dj shango dj born zen xaria",
      startsAt: at("22:00"),
      venueName: "The Onyx Room at House of Yes",
      venuePoint: { lat: 40.70658, lng: -73.92339 },
      trust: "directory",
      endsAt: new Date("2026-11-15T04:00:00Z"),
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(true);
  });

  it("true for Rio case", () => {
    const a = side({
      title: "dominguinho bem forrado",
      titleNormalized: "dominguinho bem forrado",
      startsAt: at("20:00"),
      venuePoint: { lat: -22.9568, lng: -43.19246 },
    });
    const b = side({
      id: "b",
      title: "dominguinho bem forrado",
      titleNormalized: "dominguinho bem forrado",
      startsAt: at("20:00"),
      venuePoint: { lat: -22.95681, lng: -43.19246 },
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(true);
  });

  it("true with closing tail", () => {
    const a = side({
      title: "club mix till 4am",
      titleNormalized: "club mix till 4am",
    });
    const b = side({
      id: "b",
      title: "club mix",
      titleNormalized: "club mix",
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(true);
  });

  // False cases
  it("false when sameSource is true", () => {
    const a = side({});
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
    });
    expect(sameTitleNearVenues(a, b, true)).toBe(false);
  });

  it("false when one side cancelled", () => {
    const a = side({ cancelled: true });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when starts differ by 30 minutes", () => {
    const a = side({});
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
      startsAt: at("23:15"),
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when one startsAt is null", () => {
    const a = side({ startsAt: null });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when titles differ", () => {
    const a = side({ title: "fuego", titleNormalized: "fuego" });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
      title: "fuego vip",
      titleNormalized: "fuego vip",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when title only generic words", () => {
    const a = side({ title: "salsa night", titleNormalized: "salsa night" });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
      title: "salsa night",
      titleNormalized: "salsa night",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when one venueId is null", () => {
    const a = side({ venueId: null });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when one venuePoint missing", () => {
    const a = side({ venuePoint: undefined });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when venues 2 km apart", () => {
    const a = side({});
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.5, lng: -0.14 },
      trust: "directory",
    });
    // Distance > NEAR_VENUES_METRES (1500)
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when one listingType is class", () => {
    const a = side({ listingType: "class" });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when title is class-like (beginner salsa class)", () => {
    const a = side({
      title: "beginner salsa class",
      titleNormalized: "beginner salsa class",
      listingType: "social",
    });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
      title: "beginner salsa class",
      titleNormalized: "beginner salsa class",
      listingType: "social",
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });

  it("false when both endsAt differ by 2 hours", () => {
    const a = side({
      endsAt: new Date("2026-11-15T01:00:00Z"),
    });
    const b = side({
      id: "b",
      venueId: "v2",
      venuePoint: { lat: 51.48456, lng: -0.12374 },
      trust: "directory",
      endsAt: new Date("2026-11-15T03:00:00Z"),
    });
    expect(sameTitleNearVenues(a, b, false)).toBe(false);
  });
});
