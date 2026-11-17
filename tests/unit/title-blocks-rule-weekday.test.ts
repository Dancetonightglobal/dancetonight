import { describe, expect, it } from "vitest";

import { titleBlocks } from "@/src/domain/title-blocks";

describe("title-blocks rule and weekday handling", () => {
  const FIXTURE = `ZMM Events Presents

Rafael [https://tipitinas.com/event/14287184/rafael]

------------------------------------------------------------------

Thu
Oct 29, 2026

Doors: 9:00 pm /

Show: 9:00 pm

Ages 18 and Up

Thu,
Oct 29, 2026

Doors: 9:00 pm /

Show: 9:00 pm

Ages 18 and Up

------------------------------------------------------------------

ZMM Events Presents

Rafael [https://tipitinas.com/event/14287184/rafael]

Buy Tickets [https://www.ticketweb.com/event/rafael-tipitinas-tickets/14287184?pl=tipitinas&REFID=website]

[https://tipitinas.com/event/14222724/all-hallows-eve-spooktacular-with-the-soul-rebels]

Tipitina's Presents

All Hallows Eve Spooktacular! with The Soul Rebels [https://tipitinas.com/event/14222724/all-hallows-eve-spooktacular-with-the-soul-rebels]

+ Kota Dosa

------------------------------------------------------------------

Fri
Oct 30, 2026

Doors: 8:00 pm /

Show: 9:00 pm

Ages 18 and Up

Fri,
Oct 30, 2026

Doors: 8:00 pm /

Show: 9:00 pm

Ages 18 and Up

------------------------------------------------------------------

Tipitina's Presents

All Hallows Eve Spooktacular! with The Soul Rebels [https://tipitinas.com/event/14222724/all-hallows-eve-spooktacular-with-the-soul-rebels]

+ Kota Dosa

Buy Tickets [https://www.ticketweb.com/event/all-hallows-eve-spooktacular-with-tipitinas-tickets/14222724?pl=tipitinas&REFID=website]

[https://tipitinas.com/event/15031663/dj-rq-away-presents-lagniappe-halloween-edition]

Tipitina's Presents


`;

  const titles = ["Rafael", "All Hallows Eve Spooktacular! with The Soul Rebels"];

  it("includes times after a rule line and bare weekday (Rafael)", () => {
    const blocks = titleBlocks(FIXTURE, "Rafael", titles, "en");
    const block = blocks[0]!;
    const text = FIXTURE.slice(block.start, block.end);
    expect(text).toContain("Doors: 9:00 pm");
    expect(text).toContain("Show: 9:00 pm");
    expect(text).not.toContain("All Hallows");
  });

  it("includes times after a rule line and bare weekday (All Hallows)", () => {
    const blocks = titleBlocks(
      FIXTURE,
      "All Hallows Eve Spooktacular! with The Soul Rebels",
      titles,
      "en",
    );
    const block = blocks[0]!;
    const text = FIXTURE.slice(block.start, block.end);
    expect(text).toContain("Doors: 8:00 pm");
    expect(text).toContain("Show: 9:00 pm");
  });

  it("still ends block at second real date line (plain case)", () => {
    const text = "Swing Night\n\nOct 29, 2026\n\nOct 30, 2026\n\n9:00 pm";
    const blocks = titleBlocks(text, "Swing Night", [], "en");
    const block = blocks[0]!;
    const slice = text.slice(block.start, block.end);
    expect(slice).not.toContain("9:00 pm");
  });

  it("includes time after rule line and bare weekday (custom)", () => {
    const text = "Swing Night\n\n-----\n\nFri\nOct 30, 2026\n\n8:00 pm";
    const blocks = titleBlocks(text, "Swing Night", [], "en");
    const block = blocks[0]!;
    const slice = text.slice(block.start, block.end);
    expect(slice).toContain("8:00 pm");
  });
});
