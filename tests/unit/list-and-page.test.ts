import { describe, expect, it } from "vitest";
import { listCopyAndOwnPage } from "@/src/domain/list-and-page";
import { GENERIC_TITLE_WORDS } from "@/config/dedupe";
import { coreTitleWords, onePlace, sameKindOfNight, type DedupeSide } from "@/src/domain/dedupe";
import { looksLikeEventPage } from "@/src/domain/event-links";

describe("listCopyAndOwnPage", () => {
  const baseSide: DedupeSide = {
    id: "1",
    startsAt: null,
    organizerId: "org1",
    organizerName: "Org",
    venueId: "v1",
    venuePoint: { lat: 39.9612, lng: -75.15 },
    venueName: "Venue",
    venueAddress: "123 Street",
    ticketUrl: null,
    canonicalUrl: null,
    trust: "first_party",
    firstSeenAt: new Date(),
    title: "",
    listingType: "club_night",
    cancelled: undefined,
    links: [],
  };

  it("Silk City exact case - both untimed -> true", () => {
    const listSide: DedupeSide = {
      ...baseSide,
      id: "list",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
    };
    const ownPageSide: DedupeSide = {
      ...baseSide,
      id: "own",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
    };

    expect(listCopyAndOwnPage(listSide, ownPageSide)).toBe(true);
    expect(listCopyAndOwnPage(ownPageSide, listSide)).toBe(true);
  });

  it("both copies on list page (no own page) -> false", () => {
    const side1: DedupeSide = {
      ...baseSide,
      id: "1",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
    };
    const side2: DedupeSide = {
      ...baseSide,
      id: "2",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=dj%20CARIBBEAN%20NIGHT",
    };

    expect(listCopyAndOwnPage(side1, side2)).toBe(false);
  });

  it("both have own pages -> false", () => {
    const side1: DedupeSide = {
      ...baseSide,
      id: "1",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
    };
    const side2: DedupeSide = {
      ...baseSide,
      id: "2",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-3/",
    };

    expect(listCopyAndOwnPage(side1, side2)).toBe(false);
  });

  it("titles 'CARIBBEAN NIGHT' / 'AFROBEATS NIGHT' -> false", () => {
    const side1: DedupeSide = {
      ...baseSide,
      id: "1",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
    };
    const side2: DedupeSide = {
      ...baseSide,
      id: "2",
      title: "AFROBEATS NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/afrobeats-night-2/",
    };

    expect(listCopyAndOwnPage(side1, side2)).toBe(false);
  });

  it("titles 'Salsa Night' / 'dj Salsa Night' -> false (no non-generic 4+ letter word)", () => {
    const side1: DedupeSide = {
      ...baseSide,
      id: "1",
      title: "Salsa Night",
      canonicalUrl: "https://example.com/events/#:~:text=Salsa%20Night",
    };
    const side2: DedupeSide = {
      ...baseSide,
      id: "2",
      title: "dj Salsa Night",
      canonicalUrl: "https://example.com/events/salsa-night-2/",
    };

    expect(listCopyAndOwnPage(side1, side2)).toBe(false);
  });

  it("titles 'CARIBBEAN NIGHT' / 'CARIBBEAN NIGHT Halloween Edition' -> false (extra non-generic words)", () => {
    const side1: DedupeSide = {
      ...baseSide,
      id: "1",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://example.com/events/#:~:text=CARIBBEAN%20NIGHT",
    };
    const side2: DedupeSide = {
      ...baseSide,
      id: "2",
      title: "CARIBBEAN NIGHT Halloween Edition",
      canonicalUrl: "https://example.com/events/caribbean-night-halloween/",
    };

    expect(listCopyAndOwnPage(side1, side2)).toBe(false);
  });

  it("one untimed, one timed -> false", () => {
    const listSide: DedupeSide = {
      ...baseSide,
      id: "list",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
      startsAt: null,
    };
    const ownPageSide: DedupeSide = {
      ...baseSide,
      id: "own",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
      startsAt: new Date("2026-11-06T22:00:00"),
    };

    expect(listCopyAndOwnPage(listSide, ownPageSide)).toBe(false);
  });

  it("both timed 22:00 equal -> true", () => {
    const date = new Date("2026-11-06T22:00:00");
    const listSide: DedupeSide = {
      ...baseSide,
      id: "list",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
      startsAt: date,
    };
    const ownPageSide: DedupeSide = {
      ...baseSide,
      id: "own",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
      startsAt: new Date(date),
    };

    expect(listCopyAndOwnPage(listSide, ownPageSide)).toBe(true);
  });

  it("22:00 vs 23:00 -> false", () => {
    const listSide: DedupeSide = {
      ...baseSide,
      id: "list",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
      startsAt: new Date("2026-11-06T22:00:00"),
    };
    const ownPageSide: DedupeSide = {
      ...baseSide,
      id: "own",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
      startsAt: new Date("2026-11-06T23:00:00"),
    };

    expect(listCopyAndOwnPage(listSide, ownPageSide)).toBe(false);
  });

  it("one cancelled -> false", () => {
    const listSide: DedupeSide = {
      ...baseSide,
      id: "list",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
      cancelled: true,
    };
    const ownPageSide: DedupeSide = {
      ...baseSide,
      id: "own",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
    };

    expect(listCopyAndOwnPage(listSide, ownPageSide)).toBe(false);
  });

  it("two venues 7 km apart -> false", () => {
    const listSide: DedupeSide = {
      ...baseSide,
      id: "list",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
      venueId: "v1",
      venuePoint: { lat: 39.9612, lng: -75.15 },
    };
    const ownPageSide: DedupeSide = {
      ...baseSide,
      id: "own",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
      venueId: "v2",
      venuePoint: { lat: 39.9, lng: -75.23 },
    };

    expect(listCopyAndOwnPage(listSide, ownPageSide)).toBe(false);
  });

  it("'class' vs 'club_night' -> false", () => {
    const listSide: DedupeSide = {
      ...baseSide,
      id: "list",
      title: "CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/#:~:text=CARIBBEAN%20NIGHT",
      listingType: "class",
    };
    const ownPageSide: DedupeSide = {
      ...baseSide,
      id: "own",
      title: "dj CARIBBEAN NIGHT",
      canonicalUrl: "https://silkcityphilly.com/events/caribbean-night-2/",
      listingType: "club_night",
    };

    expect(listCopyAndOwnPage(listSide, ownPageSide)).toBe(false);
  });
});
