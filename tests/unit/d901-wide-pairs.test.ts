// D-901: the wide pass. Every pair below is from the live site scan of 2026-11-27 (New York,
// London, Los Angeles), with venue points from the venues' own addresses.

import { describe, expect, it } from "vitest";

import type { DedupeSide } from "@/src/domain/dedupe";
import { tellingWords, venueNamesShare, widePairVerdict } from "@/src/domain/wide-pairs";

let n = 0;
function side(
  title: string,
  start: string | null,
  venue: { id: string; name: string; lat: number; lng: number } | null,
  extra: Partial<DedupeSide> = {},
): DedupeSide {
  n += 1;
  return {
    id: `e${n}`,
    startsAt: start === null ? null : new Date(start),
    organizerId: null,
    organizerName: null,
    venueId: venue?.id ?? null,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-11-20T00:00:00Z"),
    title,
    titleNormalized: title.toLowerCase(),
    listingType: "party",
    venueName: venue?.name,
    venuePoint: venue === null ? undefined : { lat: venue.lat, lng: venue.lng },
    ...extra,
  };
}

const ECHOPLEX = { id: "v-echoplex", name: "Echoplex", lat: 34.07766, lng: -118.26058 };
const THE_ECHO = { id: "v-echo", name: "The Echo", lat: 34.07772, lng: -118.26027 };
const FIRE_A = { id: "v-fire-a", name: "Fire Night Club Vauxhall", lat: 51.48551, lng: -0.12367 };
const FIRE_B = { id: "v-fire-b", name: "Fire", lat: 51.4857, lng: -0.1243 };
const MEADOWS = { id: "v-meadows", name: "The Meadows", lat: 40.70636, lng: -73.93273 };
const MONARCH = { id: "v-monarch", name: "The Brooklyn Monarch", lat: 40.70653, lng: -73.93248 };
const PACHA_NY = { id: "v-pacha", name: "Pacha New York", lat: 40.7616, lng: -73.9993 };
const BROOKLYN_PACHA = { id: "v-bpacha", name: "Brooklyn Pacha", lat: 40.7177, lng: -73.9582 };
const BIG_APPLE = { id: "v-bab", name: "Big Apple Ballroom", lat: 40.7339, lng: -73.9935 };
const LA_VENUE = { id: "v-la", name: "Hollywood Palladium", lat: 34.0983, lng: -118.3247 };

describe("widePairVerdict merges by rule (D-901)", () => {
  it("one title at two venue rows of one building (Echoplex / The Echo, Ticketmaster twice)", () => {
    const a = side(
      "Electric Feels: Indie Rock + Electronic Dance Party",
      "2026-11-29T05:00:00Z",
      ECHOPLEX,
    );
    const b = side(
      "Electric Feels: Indie Rock + Electronic Dance Party",
      "2026-11-29T05:00:00Z",
      THE_ECHO,
    );
    expect(widePairVerdict(a, b, false)).toBe("merge");
  });

  it("one title an hour apart at the club's two names (Tremendo, DICE 10pm / Tickeri 11pm)", () => {
    const a = side("Tremendo (Mexa Sounds) [21+]", "2026-11-29T03:00:00Z", MEADOWS);
    const b = side("Tremendo (Mexa Sounds) [21+]", "2026-11-29T04:00:00Z", MONARCH);
    expect(widePairVerdict(a, b, false)).toBe("merge");
  });

  it("venue names that share a word count as one place (Fire Night Club Vauxhall / Fire)", () => {
    expect(venueNamesShare(FIRE_A.name, FIRE_B.name)).toBe(true);
    const a = side("Candy with Special Guest Ana Julieta", "2026-11-29T23:45:00Z", FIRE_A);
    const b = side("Candy with Special Guest Ana Julieta", null, FIRE_B);
    expect(widePairVerdict(a, b, false)).toBe("merge");
  });

  it("one event page on both, one side unplaced (Mutate on TicketWeb twice)", () => {
    const url = "https://www.ticketweb.com/event/mutate-luciid-w-callush-360";
    const a = side("Mutate: LUCIID w/ Callush 360º Stage", "2026-11-29T06:00:00Z", LA_VENUE, {
      ticketUrl: url,
    });
    const b = side("Mutate: LUCIID w/ Callush 360°", "2026-11-29T06:00:00Z", null, {
      ticketUrl: url,
    });
    expect(widePairVerdict(a, b, true)).toBe("merge");
  });
});

describe("widePairVerdict asks the model when unsure (D-901)", () => {
  it("one exact title at one start at two clubs miles apart (Mathame: Pacha NY vs RA's Brooklyn Pacha)", () => {
    const a = side("Mathame", "2026-11-29T03:00:00Z", PACHA_NY);
    const b = side("Mathame", "2026-11-29T03:00:00Z", BROOKLYN_PACHA);
    expect(widePairVerdict(a, b, false)).toBe("ask");
  });

  it("one title inside the other at one venue, an hour apart", () => {
    const a = side("Guy Gerber", "2026-11-28T03:00:00Z", PACHA_NY);
    const b = side("Guy Gerber, Heron Preston + more", "2026-11-28T04:00:00Z", PACHA_NY);
    expect(widePairVerdict(a, b, false)).toBe("ask");
  });

  it("an exact title with no place on one side and starts an hour apart", () => {
    const a = side("The Official Museum Afterparty with Tricky", "2026-11-28T00:00:00Z", PACHA_NY);
    const b = side("The Official Museum Afterparty with Tricky", "2026-11-28T01:00:00Z", null);
    expect(widePairVerdict(a, b, false)).toBe("ask");
  });
});

describe("a chain's two branches (D-901)", () => {
  it("one title at one start at two branches of one chain is asked about, never merged by rule", () => {
    const islington = { id: "v-bo-i", name: "Bubba Oasis Islington", lat: 51.5362, lng: -0.1033 };
    const clapham = { id: "v-bo-c", name: "Bubba Oasis Clapham", lat: 51.4618, lng: -0.1384 };
    const a = side("Bubba Oasis Christmas Takeover", "2026-11-28T21:00:00Z", islington);
    const b = side("Bubba Oasis Christmas Takeover", "2026-11-28T21:00:00Z", clapham);
    expect(widePairVerdict(a, b, false)).toBe("ask");
  });
});

describe("widePairVerdict leaves these alone (D-901)", () => {
  it("titles with no telling word: Live DJ, All Night Long, DJ Night, Saturday Nights", () => {
    for (const title of [
      "Live DJ",
      "All Night Long",
      "DJ NIGHT",
      "Saturday Nights",
      "House Party",
    ]) {
      expect(tellingWords(title)).toEqual([]);
      const a = side(title, "2026-11-28T02:00:00Z", MEADOWS);
      const b = side(title, "2026-11-28T02:00:00Z", MONARCH);
      expect(widePairVerdict(a, b, false)).toBeNull();
    }
  });

  it("two levels of one class series (Level 1 / Level 2 @ Big Apple Ballroom)", () => {
    const a = side("Level 1 @ Big Apple Ballroom", "2026-11-28T19:00:00Z", BIG_APPLE, {
      listingType: "class",
    });
    const b = side("Level 2 @ Big Apple Ballroom", "2026-11-28T20:00:00Z", BIG_APPLE, {
      listingType: "class",
    });
    expect(widePairVerdict(a, b, false)).toBeNull();
  });

  it("a class beside a social, a cancelled copy, or starts over three hours apart", () => {
    const party = side("Esa! Milonga", "2026-11-29T01:00:00Z", BIG_APPLE);
    const klass = side("Esa! Milonga", "2026-11-29T00:00:00Z", BIG_APPLE, { listingType: "class" });
    expect(widePairVerdict(party, klass, false)).toBeNull();
    const cancelled = side("Esa! Milonga", "2026-11-29T01:00:00Z", BIG_APPLE, { cancelled: true });
    expect(widePairVerdict(party, cancelled, false)).toBeNull();
    const late = side("Esa! Milonga", "2026-11-29T04:30:00Z", BIG_APPLE);
    expect(widePairVerdict(party, late, false)).toBeNull();
  });

  it("one source's two listings with one title at two times (Bachateame at 2pm and 6:45pm)", () => {
    const a = side("Bachateame Saturdays London Sensual Night", "2026-11-28T14:00:00Z", FIRE_A);
    const b = side("Bachateame Saturdays London Sensual Night", "2026-11-28T15:00:00Z", FIRE_A);
    expect(widePairVerdict(a, b, true)).toBeNull();
  });

  it("two pages on one ticket seller, or two listed ends over an hour apart, are two events", () => {
    const a = side("Tremendo (Mexa Sounds) [21+]", "2026-11-29T03:00:00Z", MEADOWS, {
      ticketUrl: "https://dice.fm/event/abc",
    });
    const b = side("Tremendo (Mexa Sounds) [21+]", "2026-11-29T03:00:00Z", MONARCH, {
      ticketUrl: "https://dice.fm/event/xyz",
    });
    expect(widePairVerdict(a, b, false)).toBeNull();
    const early = side("Tremendo (Mexa Sounds) [21+]", "2026-11-29T00:00:00Z", MEADOWS, {
      endsAt: new Date("2026-11-29T03:00:00Z"),
    });
    const late = side("Tremendo (Mexa Sounds) [21+]", "2026-11-29T02:00:00Z", MONARCH, {
      endsAt: new Date("2026-11-29T07:00:00Z"),
    });
    expect(widePairVerdict(early, late, false)).toBeNull();
  });

  it("titles that are not alike", () => {
    const a = side("Loco Carnaval", "2026-11-28T04:00:00Z", MEADOWS);
    const b = side("Michael Simpson", "2026-11-28T04:00:00Z", MEADOWS);
    expect(widePairVerdict(a, b, false)).toBeNull();
  });
});
