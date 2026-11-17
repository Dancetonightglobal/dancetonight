// Ticketmaster's "Other": an event read through its headliner, and nights listed twice (D-132).
// The events are Ticketmaster's own answer of 2026-09-29 (run 33), saved.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  danceRelevance,
  headlinerOf,
  ticketmasterToListings,
  twinsOf,
} from "@/src/adapters/apis/ticketmaster";
import type { Metro } from "@/src/adapters/types";

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};
const TM = JSON.parse(
  readFileSync(
    path.join(__dirname, "../../../tests/unit/fixtures/ticketmaster/nyc-2026-09-29.json"),
    "utf8",
  ),
) as { events: Array<Record<string, unknown>> };
const named = (prefix: string) => TM.events.filter((e) => String(e.name).startsWith(prefix));
const other = { segment: "Music", genre: "Other", subGenre: "Other" };

describe("an event filed under Other, read through its headliner", () => {
  it("keeps Dusky, whose headliner is Club Dance, as a club night", () => {
    const dusky = named("Dusky")[0]!;
    expect(headlinerOf(dusky)).toEqual({
      segment: "Music",
      genre: "Dance/Electronic",
      subGenre: "Club Dance",
    });
    expect(danceRelevance("Dusky - 21+", other, "Elsewhere", headlinerOf(dusky))).toMatchObject({
      keep: true,
      type: "club_night",
      reason: "headliner's genre Dance/Electronic",
    });
  });

  it("reads the first attraction only: Harry Styles's opener is Jamie xx, a DJ", () => {
    const harry = named("Harry Styles")[0]!;
    // Jamie xx is Dance/Electronic; were the show filed Other, any attraction would list it.
    expect(headlinerOf(harry)?.genre).toBe("Pop");
    expect(
      danceRelevance("Harry Styles", other, "Madison Square Garden", headlinerOf(harry)).keep,
    ).toBe(false);
  });

  it("leaves a dance-pop singer's concert out, and a genre Ticketmaster did name alone", () => {
    const dadi = named("Dadi Freyr")[0]!;
    expect(headlinerOf(dadi)?.subGenre).toBe("Dance Pop");
    expect(
      danceRelevance("Dadi Freyr (16 and Over)", other, "Brooklyn Steel", headlinerOf(dadi)).keep,
    ).toBe(false);
    // A Pop event with a Dance/Electronic headliner: Ticketmaster named the event, and said Pop.
    const dj = { segment: "Music", genre: "Dance/Electronic", subGenre: "Club Dance" };
    expect(
      danceRelevance("Someone", { segment: "Music", genre: "Pop", subGenre: null }, null, dj).keep,
    ).toBe(false);
    // Unclassified altogether ("Undefined" is read as no genre) counts as Other.
    expect(
      danceRelevance("Someone", { segment: null, genre: null, subGenre: null }, null, dj).keep,
    ).toBe(true);
  });
});

describe("nights Ticketmaster lists twice", () => {
  it("keeps the copy Ticketmaster classed, and retires the one it filed under Other", () => {
    const pauly = named("Project 91 Presents DJ Pauly D");
    expect(pauly).toHaveLength(2);
    const twins = twinsOf(TM.events);
    expect(twins.size).toBe(2);
    const { listings, screened } = ticketmasterToListings(TM.events, {
      metro: NYC,
      fetchedAt: new Date("2026-09-29T21:21:07Z"),
    });
    for (const title of [
      "Project 91 Presents DJ Pauly D",
      "San Holo presents TRUE LOVE IN A MADE UP WORLD",
    ]) {
      const kept = listings.filter((l) => l.listing.title === title);
      expect(kept).toHaveLength(1);
      // The kept copy is the one classed Dance/Electronic, which the site already lists.
      expect(kept[0]!.listing.evidence.listing_type).toBe("genre Dance/Electronic");
      const dropped = screened.filter((s) => s.title === title);
      expect(dropped).toHaveLength(1);
      expect(dropped[0]!.reason).toBe(
        `the same night as ${kept[0]!.externalId}, listed twice by Ticketmaster`,
      );
    }
  });

  const twin = (
    id: string,
    genre: string,
    extra: {
      status?: string;
      headliner?: string;
      venue?: string | null;
      time?: string | null;
    } = {},
  ) => ({
    id,
    name: "Late Show",
    url: `https://www.ticketmaster.com/event/${id}`,
    dates: {
      start: {
        localDate: "2026-10-09",
        ...(extra.time === null ? {} : { localTime: extra.time ?? "22:00:00" }),
      },
      timezone: "America/New_York",
      status: { code: extra.status ?? "onsale" },
    },
    classifications: [
      { segment: { name: "Music" }, genre: { name: genre }, subGenre: { name: "Undefined" } },
    ],
    _embedded: {
      ...(extra.venue === null ? {} : { venues: [{ name: extra.venue ?? "Webster Hall" }] }),
      attractions: [
        {
          name: "Headliner",
          classifications: [
            {
              segment: { name: "Music" },
              genre: { name: extra.headliner ?? "Rock" },
              subGenre: { name: "Undefined" },
            },
          ],
        },
      ],
    },
  });
  const read = (events: unknown[]) =>
    ticketmasterToListings(events, { metro: NYC, fetchedAt: new Date("2026-10-04T16:00:00Z") });

  it("keeps the copy the rules keep, so a night never vanishes with its twin", () => {
    // Copy A is Rock (no dance); copy B is Other with a Dance/Electronic headliner.
    const a = twin("A", "Rock");
    const b = twin("B", "Other", { headliner: "Dance/Electronic" });
    const { listings, screened, notes } = read([a, b]);
    expect(listings.map((l) => l.externalId)).toEqual(["tm:B"]);
    expect(screened.find((s) => s.externalId === "tm:A")?.reason).toBe(
      "the same night as tm:B, listed twice by Ticketmaster",
    );
    expect(notes).toContain("listed twice by Ticketmaster: Late Show (tm:B kept, tm:A left out)");
  });

  it("prefers an onsale copy to a cancelled one, and never depends on the answer's order", () => {
    const live = twin("Z", "Dance/Electronic");
    const off = twin("A", "Dance/Electronic", { status: "cancelled" });
    expect(read([off, live]).listings.map((l) => [l.externalId, l.listing.cancelled])).toEqual([
      ["tm:Z", null],
    ]);
    const x = twin("X2", "Other", { headliner: "Dance/Electronic" });
    const y = twin("X1", "Other", { headliner: "Dance/Electronic" });
    expect(twinsOf([x, y])).toEqual(twinsOf([y, x]));
    expect(twinsOf([x, y])).toEqual(new Map([["X2", "X1"]]));
  });

  it("never pairs events with no venue or no start time", () => {
    const untimed = [
      twin("U1", "Dance/Electronic", { time: null }),
      twin("U2", "Dance/Electronic", { time: null }),
    ];
    expect(twinsOf(untimed).size).toBe(0);
    const nowhere = [
      twin("N1", "Dance/Electronic", { venue: null }),
      twin("N2", "Dance/Electronic", { venue: null }),
    ];
    expect(twinsOf(nowhere).size).toBe(0);
  });

  it('reads Ticketmaster\'s "Undefined" genre as none, so the headliner decides', () => {
    const solo = twin("S", "Undefined", { headliner: "Dance/Electronic" });
    expect(read([solo]).listings.map((l) => l.listing.evidence.listing_type)).toEqual([
      "headliner's genre Dance/Electronic",
    ]);
  });

  it("adds four club nights over run 33's window, and nothing else", () => {
    const { listings } = ticketmasterToListings(TM.events, {
      metro: NYC,
      fetchedAt: new Date("2026-09-29T21:21:07Z"),
    });
    const added = listings
      .filter((l) => l.listing.evidence.listing_type === "headliner's genre Dance/Electronic")
      .map((l) => [l.listing.local_date, l.listing.title, l.listing.listing_type]);
    expect(added).toEqual([
      ["2026-10-01", "Kruder & Dorfmeister (16 and Over)", "club_night"],
      ["2026-10-02", "Dusky - 21+", "club_night"],
      ["2026-10-03", "Dom Dolla w/ Peggy Gou", "club_night"],
      ["2026-10-10", "NOTD (16 and Over)", "club_night"],
    ]);
    expect(listings).toHaveLength(20);
  });
});
