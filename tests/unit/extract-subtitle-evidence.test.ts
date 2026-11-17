import { describe, expect, it } from "vitest";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";
import { subtitleLine, titleBlocks } from "@/src/domain/title-blocks";
import { screenNoDance, screenEvidenceText } from "@/src/domain/listing-screen";

const NOW = new Date("2026-10-30T14:00:00Z");
const TONIGHT = "2026-10-30";

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "Tipitina's" },
      organizer: {},
      ...l,
    })),
  });
}

const read = (
  pageUrl: string,
  text: string | null,
  listings: Array<Record<string, unknown>>,
  extra: { directory?: boolean; countryCode?: string } = {},
) =>
  extractionToHarvested(reply(listings), {
    pageUrl,
    fetchedAt: NOW,
    today: TONIGHT,
    pageText: text,
    countryCode: "US",
    ...extra,
  });

describe("subtitleLine", () => {
  const pageText = `Tipitina's Presents

Love In The Club [https://tipitinas.com/event/15020903/love-in-the-club]

2000's Hip-Hop & R&B Dance Party Featuring DJ New Era

------------------------------------------------------------------

Fri
Nov 27, 2026

Doors: 8:00 pm /

Show: 9:00 pm

Tipitina's Presents

Body Rock Volume 2 - With Mannie Fresh & DJ Soul Sister [https://tipitinas.com/event/14394404/body-rock-volume-2-with-mannie-fresh-dj-soul-sister]

------------------------------------------------------------------

Sat
Dec 5, 2026

Doors: 8:00 pm /

Show: 9:00 pm

Tipitina's Presents

Gimme Gimme Disco [https://tipitinas.com/event/14296354/gimme-gimme-disco]

A Disco Dance Party Inspired by ABBA

------------------------------------------------------------------

Sat
Dec 26, 2026

Doors: 8:00 pm /

Show: 9:00 pm`;

  it("extracts subtitle for Love In The Club", () => {
    const blocks = titleBlocks(pageText, "Love In The Club", [], "en");
    expect(blocks).toHaveLength(1);
    const sub = subtitleLine(pageText, blocks[0]!, [], "en");
    expect(sub).toBe("2000's Hip-Hop & R&B Dance Party Featuring DJ New Era");
  });

  it("extracts subtitle for Gimme Gimme Disco", () => {
    const blocks = titleBlocks(pageText, "Gimme Gimme Disco", [], "en");
    expect(blocks).toHaveLength(1);
    const sub = subtitleLine(pageText, blocks[0]!, [], "en");
    expect(sub).toBe("A Disco Dance Party Inspired by ABBA");
  });

  it("returns null for Body Rock (no subtitle line)", () => {
    const blocks = titleBlocks(
      pageText,
      "Body Rock Volume 2 - With Mannie Fresh & DJ Soul Sister",
      [],
      "en",
    );
    expect(blocks).toHaveLength(1);
    const sub = subtitleLine(pageText, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });

  it("returns null when first non-blank line is a rule", () => {
    const text = `Title
-----
Next line`;
    const blocks = titleBlocks(text, "Title", [], "en");
    const sub = subtitleLine(text, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });

  it("returns null when first non-blank line contains a clock", () => {
    const text = `Title
Doors: 8:00 pm`;
    const blocks = titleBlocks(text, "Title", [], "en");
    const sub = subtitleLine(text, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });

  it("returns null when first non-blank line contains a link", () => {
    const text = `Title
Buy Tickets [https://example.com]`;
    const blocks = titleBlocks(text, "Title", [], "en");
    const sub = subtitleLine(text, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });

  it("returns null when first non-blank line is a date heading", () => {
    const text = `Title
Nov 27, 2026`;
    const blocks = titleBlocks(text, "Title", [], "en");
    const sub = subtitleLine(text, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });

  it("returns null when line too long (>120 chars)", () => {
    const long = "a".repeat(121);
    const text = `Title
${long}`;
    const blocks = titleBlocks(text, "Title", [], "en");
    const sub = subtitleLine(text, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });

  it("returns null when line has >15 words", () => {
    const words = Array.from({ length: 16 }, (_, i) => `word${i}`).join(" ");
    const text = `Title
${words}`;
    const blocks = titleBlocks(text, "Title", [], "en");
    const sub = subtitleLine(text, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });

  it("returns null when line equals another title", () => {
    const text = `Title1
Title2`;
    const blocks = titleBlocks(text, "Title1", ["Title2"], "en");
    const sub = subtitleLine(text, blocks[0]!, ["Title2"], "en");
    expect(sub).toBeNull();
  });

  it("returns null when title line has words after the title", () => {
    const text = `Love In The Club tonight only
subtitle`;
    const blocks = titleBlocks(text, "Love In The Club", [], "en");
    const sub = subtitleLine(text, blocks[0]!, [], "en");
    expect(sub).toBeNull();
  });
});

describe("extractionToHarvested adds subtitle evidence", () => {
  const pageText = `Tipitina's Presents

Love In The Club [https://tipitinas.com/event/15020903/love-in-the-club]

2000's Hip-Hop & R&B Dance Party Featuring DJ New Era

------------------------------------------------------------------

Fri
Nov 27, 2026

Doors: 8:00 pm /

Show: 9:00 pm

Tipitina's Presents

Body Rock Volume 2 - With Mannie Fresh & DJ Soul Sister [https://tipitinas.com/event/14394404/body-rock-volume-2-with-mannie-fresh-dj-soul-sister]

------------------------------------------------------------------

Sat
Dec 5, 2026

Doors: 8:00 pm /

Show: 9:00 pm

Tipitina's Presents

Gimme Gimme Disco [https://tipitinas.com/event/14296354/gimme-gimme-disco]

A Disco Dance Party Inspired by ABBA

------------------------------------------------------------------

Sat
Dec 26, 2026

Doors: 8:00 pm /

Show: 9:00 pm`;

  it("adds subtitle key for Love In The Club", () => {
    const result = read("https://tipitinas.com/calendar/", pageText, [
      {
        title: "Love In The Club",
        local_date: "2026-11-27",
        dancing_time: "21:00",
        evidence: {},
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!.listing;
    expect(listing.evidence?.subtitle).toBe(
      "2000's Hip-Hop & R&B Dance Party Featuring DJ New Era",
    );
  });

  it("adds subtitle key for Gimme Gimme Disco", () => {
    // Use a simpler page text to avoid date checking issues
    const simplePageText = `Tipitina's Presents

Gimme Gimme Disco [https://tipitinas.com/event/14296354/gimme-gimme-disco]

A Disco Dance Party Inspired by ABBA

------------------------------------------------------------------

Sat
Dec 26, 2026

Doors: 8:00 pm /

Show: 9:00 pm`;
    const result = read("https://tipitinas.com/calendar/", simplePageText, [
      {
        title: "Gimme Gimme Disco",
        local_date: "2026-12-26",
        dancing_time: "21:00",
        evidence: {},
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!.listing;
    expect(listing.evidence?.subtitle).toBe("A Disco Dance Party Inspired by ABBA");
  });

  it("does not add subtitle when model evidence already includes it", () => {
    const result = read("https://tipitinas.com/calendar/", pageText, [
      {
        title: "Love In The Club",
        local_date: "2026-11-27",
        dancing_time: "21:00",
        evidence: {
          title: "Love In The Club 2000's Hip-Hop & R&B Dance Party Featuring DJ New Era",
        },
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!.listing;
    expect(listing.evidence?.subtitle).toBeUndefined();
  });

  it("does not add subtitle for Body Rock", () => {
    // Use a simpler page text to avoid date checking issues
    const simplePageText = `Tipitina's Presents

Body Rock Volume 2 - With Mannie Fresh & DJ Soul Sister [https://tipitinas.com/event/14394404/body-rock-volume-2-with-mannie-fresh-dj-soul-sister]

------------------------------------------------------------------

Sat
Dec 5, 2026

Doors: 8:00 pm /

Show: 9:00 pm`;
    const result = read("https://tipitinas.com/calendar/", simplePageText, [
      {
        title: "Body Rock Volume 2 - With Mannie Fresh & DJ Soul Sister",
        local_date: "2026-12-05",
        dancing_time: "21:00",
        evidence: {},
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!.listing;
    expect(listing.evidence?.subtitle).toBeUndefined();
  });
});

describe("screenNoDance with subtitle evidence", () => {
  it("keeps listing when subtitle provides dance words", () => {
    const evidence = { subtitle: "2000's Hip-Hop & R&B Dance Party Featuring DJ New Era" };
    const evidenceText = screenEvidenceText(evidence);
    const result = screenNoDance(
      {
        title: "Love In The Club",
        styles: ["hiphop"],
        startsAt: new Date("2026-11-27T21:00:00-06:00"),
        nightDate: "2026-11-27",
        tz: "America/Chicago",
        evidenceText,
      },
      { mixedCalendar: true },
    );
    expect(result).toBeNull();
  });

  it("screens out when no evidence text", () => {
    const result = screenNoDance(
      {
        title: "Love In The Club",
        styles: ["hiphop"],
        startsAt: new Date("2026-11-27T21:00:00-06:00"),
        nightDate: "2026-11-27",
        tz: "America/Chicago",
        evidenceText: null,
      },
      { mixedCalendar: true },
    );
    expect(result).not.toBeNull();
    expect(result?.kind).toBe("not_a_dance");
  });
});
