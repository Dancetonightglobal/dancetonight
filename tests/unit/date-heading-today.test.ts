// D-285: "Today · October 30" and "Tomorrow · October 31" are date headings (Our Philly).
import { describe, expect, it } from "vitest";

import { contradictingDate, foldPage, isDateHeading } from "@/src/domain/text-facts";

const PAGE = [
  "Today · October 30",
  "",
  "Supernatural Dance Party [https://www.ourphilly.org/events/supernatural-dance-party-2026-10-30]",
  "",
  "5pm · University City · Penn Live Arts West Philly Swingers [https://www.ourphilly.org/events/pennlivearts-west-philly-swingers-2026-10-30-170000]",
  "",
  "Heads up at Penn Live Arts — Arts of India Festival Community Day Sun Nov 1 at 1pm — dance, Penn Sargam, a percussion demo. Free, registration requested. Community Day [https://pennlivearts.org/event/ArtsIndiaCommunity]",
  "",
  "6:30pm · Torresdale Glen Foerd Masquerade Ball: Carnival of Curiosities [https://www.ourphilly.org/events/glen-foerd-masquerade-ball-carnival-of-curiosities-2026-10-30]",
  "",
  "8pm · Rittenhouse Realm & Revel Fantasy Ball: Starfall [https://www.ourphilly.org/events/realm-revel-fantasy-ball-starfall-2026-10-30]",
  "",
  "Heads up in #markets — 50th Philadelphia Museum of Art Contemporary Craft Show, Nov 6–8 at the Convention Center — 195 artists in 13 categories, tickets required. Visit Philly [https://www.visitphilly.com/articles/philadelphia/craft-show]",
  "",
  "8:30pm · Old City · Brasil's Nightclub Finally Fridays [https://www.ourphilly.org/events/brasilsnightclub-finally-fridays-2026-10-30] 9pm · Point Breeze · The Dolphin Tavern MISCHIEF NIGHT w/ LAUREN FLAX B2B MIKE SERVITO [https://www.ourphilly.org/events/mischief-night-2026-10-30]",
  "",
  "Tomorrow · October 31",
  "",
  "80’s & 90’s Halloween Dance Party [https://www.ourphilly.org/events/80-s-and-90-s-halloween-dance-party-2026-10-31] 1pm · Point Breeze Broad Street Boogie: Halloween Edition [https://www.ourphilly.org/events/broad-street-boogie-halloween-edition-2026-10-31]",
].join("\n");

const TITLES = [
  "Supernatural Dance Party",
  "West Philly Swingers",
  "Finally Fridays",
  "MISCHIEF NIGHT w/ LAUREN FLAX B2B MIKE SERVITO",
  "Broad Street Boogie: Halloween Edition",
];

describe("isDateHeading with today and tomorrow (D-285)", () => {
  it.each(["Today · October 30", "Tomorrow · October 31", "Tonight · October 30"])(
    "reads %s as a date heading",
    (line) => {
      expect(isDateHeading(line, "en")).toBe(true);
    },
  );
  it("still refuses a line with other words", () => {
    expect(isDateHeading("Today: Swing Night · October 30", "en")).toBe(false);
  });
});

describe("Our Philly: a day heading, not a neighbour's blurb, dates its rows (D-285)", () => {
  const page = foldPage(PAGE);
  const against = (title: string, date: string) =>
    contradictingDate(page, PAGE, title, date, "en", TITLES);

  it.each([
    ["Finally Fridays", "2026-10-30"],
    ["West Philly Swingers", "2026-10-30"],
    ["Supernatural Dance Party", "2026-10-30"],
  ])("does not contradict %s on %s", (title, date) => {
    expect(against(title, date)).toBeNull();
  });

  it("still contradicts a wrong date", () => {
    expect(against("Finally Fridays", "2026-10-31")).not.toBeNull();
  });
});
