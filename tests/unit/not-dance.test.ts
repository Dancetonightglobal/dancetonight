// PR 2, wrong listings on the site: events that are no dance night. Ticketmaster's concerts whose
// genre alone named a dance, a battle of bands, and a line of a price table read as a title. The
// events are Ticketmaster's own answer of 2026-09-29 (run 33), saved.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { familyOf, matchStyles } from "@/config/styles";
import {
  danceRelevance,
  isBigVenue,
  ticketmasterToListings,
} from "@/src/adapters/apis/ticketmaster";
import type { Metro } from "@/src/adapters/types";
import { screenTitle } from "@/src/domain/listing-screen";
import { titleBlocks } from "@/src/domain/title-blocks";

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
  readFileSync(`${__dirname}/fixtures/ticketmaster/nyc-2026-09-29.json`, "utf8"),
) as { events: unknown[] };

describe("Ticketmaster: a genre names the music, not a dance (F15)", () => {
  const { listings, notes, screened } = ticketmasterToListings(TM.events, {
    metro: NYC,
    fetchedAt: new Date("2026-09-29T21:21:07Z"),
  });
  const byTitle = new Map(listings.map((l) => [l.listing.title, l.listing]));

  it("leaves out the arena tour and the rap concert whose only dance was the genre, and says so", () => {
    expect(byTitle.has('Don Omar "The Last King World Tour"')).toBe(false);
    expect(byTitle.has("Wesley Joseph")).toBe(false);
    // Lane 5's twin lines (D-132) are tested beside its rule.
    expect(notes.filter((n) => n.startsWith("left out:"))).toEqual([
      'left out: Don Omar "The Last King World Tour" on 2026-10-10 at Barclays Center (a Hip-Hop/Rap / Reggaeton concert at an arena or stadium)',
      'left out: Don Omar "The Last King World Tour" on 2026-10-11 at Prudential Center (a Hip-Hop/Rap / Reggaeton concert at an arena or stadium)',
      "left out: Wesley Joseph on 2026-10-12 at Bowery Ballroom (Ticketmaster's genre Hip-Hop/Rap / Trap names the music, not a dance)",
    ]);
    // Every event left out is reported by the id its listing would carry, so a stored row goes.
    expect(screened.map((s) => s.title)).toContain('Don Omar "The Last King World Tour"');
    expect(screened.every((s) => s.externalId.startsWith("tm:"))).toBe(true);
  });

  it("leaves out a battle of bands", () => {
    expect(byTitle.has("Hell Gate Battle of Journalist Bands")).toBe(false);
  });

  it("keeps the club nights and the dances its names state, with the styles the names give", () => {
    expect([...byTitle.keys()].sort()).toEqual(
      [
        "Bolden. Who you really are. Tour 2026.",
        "Bop To The Top (18+)",
        "Boot Scootin' Line Dance Party At Hard Rock Cafe",
        "Cunty Classics",
        "DANCEHALL at 9AM",
        "DJ Shadow",
        "Do Si Don'tcha: Country Line Dancing",
        "Earlybirds Club - Ages 21+",
        "It's A 2000's Party!",
        "Mind Enterprises (16 and Over)",
        "Project 91 Presents DJ Pauly D",
        "Reggaetón Y2K (18+)",
        "SUPERTALL",
        "San Holo presents TRUE LOVE IN A MADE UP WORLD",
        "Send It Up",
        "jigitz",
        // Lane 5 (D-132): filed Music / Other, with a Dance/Electronic headliner.
        "Dom Dolla w/ Peggy Gou",
        "Dusky - 21+",
        "Kruder & Dorfmeister (16 and Over)",
        "NOTD (16 and Over)",
      ].sort(),
    );
    // Ticketmaster's sub-genre "Amapiano" sits on six events none of which is amapiano.
    // A club night that names no style is a DJ night (D-771).
    expect(byTitle.get("jigitz")?.styles).toEqual(["dj_night"]);
    expect(byTitle.get("Bop To The Top (18+)")?.styles).toEqual(["dj_night"]);
    expect(byTitle.get("Reggaetón Y2K (18+)")?.styles).toEqual(["reggaeton"]);
    expect(byTitle.get("DANCEHALL at 9AM")?.styles).toEqual(["dancehall"]);
    expect(byTitle.get("Do Si Don'tcha: Country Line Dancing")?.styles).toEqual(["line_dance"]);
  });
});

describe("Ticketmaster: dance music at a club is live music with dancing (the owner, PR 2)", () => {
  const music = (genre: string, subGenre: string) => ({ segment: "Music", genre, subGenre });

  it.each([
    ["Tito Nieves & Orquesta", music("Latin", "Salsa"), "SOB's", ["salsa"]],
    ["T-Vice Live", music("World", "Kompa"), "Amazura", ["kompa"]],
    ["Machel Montano", music("Reggae", "Soca"), "Brooklyn Steel", ["dancehall"]],
    [
      "Jimmy Sturr and His Orchestra",
      music("Folk", "Polka"),
      "Bohemian Hall & Beer Garden",
      ["polka"],
    ],
  ])("keeps %s at a club, with the genre's styles", (name, c, venue, styles) => {
    expect(danceRelevance(name, c, venue)).toMatchObject({
      keep: true,
      type: "live_music_with_dancing",
      styles,
    });
  });

  it.each([
    ["Tito Nieves & Orquesta", music("Latin", "Salsa"), "Madison Square Garden"],
    ["Machel Montano", music("Reggae", "Soca"), "UBS Arena"],
    ['Don Omar "The Last King World Tour"', music("Hip-Hop/Rap", "Reggaeton"), "Barclays Center"],
    ["Carlos Vives", music("Latin", "Cumbia"), "Citi Field"],
  ])("leaves out %s at %s", (name, c, venue) => {
    expect(danceRelevance(name, c, venue)).toMatchObject({ keep: false });
  });

  it("never takes rap or K-pop for a dance, at any venue", () => {
    expect(
      danceRelevance("Wesley Joseph", music("Hip-Hop/Rap", "Trap"), "Bowery Ballroom"),
    ).toMatchObject({
      keep: false,
      reason: "not a dance",
    });
    expect(danceRelevance("Stray Kids", music("Pop", "K-Pop"), "Webster Hall")).toMatchObject({
      keep: false,
    });
  });

  it("names a DJ's night left out for a rap genre, saying a repeated genre once", () => {
    const event = {
      id: "x1",
      name: "Funkmaster Flex Presents",
      classifications: [
        {
          segment: { name: "Music" },
          genre: { name: "Hip-Hop/Rap" },
          subGenre: { name: "Hip-Hop/Rap" },
        },
      ],
      dates: { start: { localDate: "2026-10-01", localTime: "22:00:00" } },
      _embedded: { venues: [{ name: "Club X" }] },
    };
    const out = ticketmasterToListings([event], { metro: NYC, fetchedAt: new Date() });
    expect(out.listings).toEqual([]);
    expect(out.notes).toEqual([
      "left out: Funkmaster Flex Presents on 2026-10-01 at Club X (Ticketmaster's genre Hip-Hop/Rap names the music, not a dance)",
    ]);
  });

  it("keeps a party by its name, whatever the genre, as a club night", () => {
    expect(
      danceRelevance("Everybody Loves Drake: A Party", music("Hip-Hop/Rap", "Hip-Hop/Rap")),
    ).toMatchObject({ keep: true, type: "club_night", styles: [] });
    expect(danceRelevance("Afro Nation Party", music("World", "Afrobeats"))).toMatchObject({
      keep: true,
      type: "club_night",
    });
  });

  it.each([
    ["Barclays Center", true],
    ["Prudential Center", true],
    ["Madison Square Garden", true],
    ["UBS Arena", true],
    ["Citi Field", true],
    ["Flushing Meadows Corona Park", true],
    ["Forest Hills Stadium", true],
    ["Manhattan Center Hammerstein Ballroom", false],
    ["Williams Center - Black Box - Rutherford", false],
    ["Bohemian Hall & Beer Garden", false],
    ["Bowery Ballroom", false],
    ["The Rooftop at Pier 17", false],
    ["Brooklyn Steel", false],
    [null, false],
  ])("reads %s as an arena or stadium: %s", (name, big) => {
    expect(isBigVenue(name)).toBe(big);
  });
});

describe("the bare word battle is not a dance (taxonomy rule 5)", () => {
  it("does not read a battle of bands as a dance battle", () => {
    expect(matchStyles("Hell Gate Battle of Journalist Bands").styles).toEqual([]);
    expect(
      matchStyles("American Lindy Hop Championships – Battle of the Swing Bands").styles.map(
        familyOf,
      ),
    ).toEqual(["swing"]);
  });
  it.each([
    ["Street dance battle", ["battle"]],
    ["Street dance battles", ["battle"]],
    ["Streetdance battle", ["battle"]],
    ["House Battle", ["battle"]],
    ["Toprock Battle", ["battle"]],
    ["All Styles Battle", ["battle"]],
    ["Dance Battle", ["battle"]],
    ["Bboy Battle", ["breaking"]],
    ["House Dance Battle", ["house_dance"]],
  ])("still reads %s", (title, styles) => {
    expect(matchStyles(title).styles).toEqual(styles);
  });
});

describe("a line of a price table is not an event", () => {
  it.each([
    "Students & Young Adults 16–18 ( Must Show ID) – $10",
    "General – $20-25",
    "$25 General",
    "Admission $15 ($10 Students)",
    "$35 Tickets",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "price_line" });
  });
  it.each([
    "Student Night – $5",
    "$5 Salsa Tuesdays",
    "Members' Dance $10",
    "Adult Beginner Salsa – $15",
    "General Admission Dance Party $20",
    "Adult Hip Hop – $12", // a kids' class is screened as a children's program (D-571)
    "Seniors Tea Dance $8",
    "Free Salsa Class",
    "Ladies Free Before 11",
    // A known miss, kept as the rule's cost: one word outside the tables keeps a line.
    "CDNY/CDSS/FMSNY members – $15-20",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });

  it("leaves CDNY's parts as they were: the screened price line never bounded one", () => {
    // Ingest drops a screened title from the read's titles before cutting a stored row's part of
    // the page. On CDNY's page of run 33 that changes no part.
    const text = readFileSync(`${__dirname}/fixtures/cdny-org.txt`, "utf8");
    const line = "Students & Young Adults 16–18 ( Must Show ID) – $10";
    const others = ["CONTRA - SATURDAYS", "English - Tuesdays", "Special Double Contra Dance"];
    for (const title of others) {
      const without = titleBlocks(text, title, others, "en");
      expect(without.length).toBeGreaterThan(0);
      expect(titleBlocks(text, title, [...others, line], "en")).toEqual(without);
    }
  });
});
