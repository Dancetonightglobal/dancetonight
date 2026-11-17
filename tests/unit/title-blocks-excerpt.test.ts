import { describe, expect, it } from "vitest";
import { titleBlocks } from "@/src/domain/title-blocks";
import { checkListingTimes } from "@/src/domain/stated-times";

describe("title-blocks excerpt truncation handling", () => {
  const baseText = (
    excerptEnd: string,
  ) => `Negracha Kingston milonga [https://londonmilongas.co.uk/events/negracha-kingston-milonga/]

NEGRACHA TANGO Friday Nights in KINGSTON Negracha Tango Kingston provides a truly Argentinian experience featuring professional teachers, performers, TDJs and live music as well as friendly local teachers & regulars, excellent ronda culture and an economical bar. The club also has a large dance floor, a guaranteed seat at a table for every attendee and ${excerptEnd}

30 Oct

20:00 - 23:00

Kingston Work Men's Club, Kingston KT2 6ND`;

  it("includes time after excerpt ending with '[…]'", () => {
    const pageText = baseText("[…]");
    const blocks = titleBlocks(pageText, "Negracha Kingston milonga", [], "en");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).toContain("20:00 - 23:00");
    // Simulate checkListingTimes to verify time is not withdrawn
    const listing = {
      title: "Negracha Kingston milonga",
      dancing_time: "20:00",
      end_time: "23:00",
      evidence: {},
      confidence: {},
    } as unknown as Parameters<typeof checkListingTimes>[0];
    const result = checkListingTimes(listing, {
      blocks,
      pageText,
      title: listing.title,
      date: "2026-10-30",
      lang: "en",
    });
    expect(result.withdrawn).toBe(false);
    expect(listing.dancing_time).toBe("20:00");
  });

  it("includes time after excerpt ending with '[...]'", () => {
    const pageText = baseText("[...]");
    const blocks = titleBlocks(pageText, "Negracha Kingston milonga", [], "en");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).toContain("20:00 - 23:00");
  });

  it("includes time after excerpt ending with '…' (no brackets)", () => {
    const pageText = baseText("…");
    const blocks = titleBlocks(pageText, "Negracha Kingston milonga", [], "en");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).toContain("20:00 - 23:00");
  });

  it("does NOT include time when excerpt ends with '.' (no truncation marker)", () => {
    const pageText = baseText(".");
    const blocks = titleBlocks(pageText, "Negracha Kingston milonga", [], "en");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).not.toContain("20:00 - 23:00");
  });

  it("handles two cards with excerpts, each keeps its own time", () => {
    const pageText = `Negracha Kingston milonga [https://londonmilongas.co.uk/events/negracha-kingston-milonga/]

NEGRACHA TANGO Friday Nights in KINGSTON Negracha Tango Kingston provides a truly Argentinian experience featuring professional teachers, performers, TDJs and live music as well as friendly local teachers & regulars, excellent ronda culture and an economical bar. The club also has a large dance floor, a guaranteed seat at a table for every attendee and […]

30 Oct

20:00 - 23:00

Kingston Work Men's Club, Kingston KT2 6ND

- Facebook [https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Flondonmilongas.co.uk%2Fevents%2Fnegracha-kingston-milonga%2F]

View Detail [https://londonmilongas.co.uk/events/negracha-kingston-milonga/]

Tango Tuesdays [https://londonmilongas.co.uk/events/tango-tuesdays/]

A weekly social dance night for all levels, with a beginner lesson at the start and a friendly atmosphere throughout the evening. […]

3 Nov

19:30 - 22:30

Some Other Venue, London SW1A 1AA`;
    const blocks = titleBlocks(pageText, "Negracha Kingston milonga", ["Tango Tuesdays"], "en");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    const text = pageText.slice(block.start, block.end);
    expect(text).toContain("20:00 - 23:00");
    expect(text).not.toContain("19:30");

    const blocks2 = titleBlocks(pageText, "Tango Tuesdays", ["Negracha Kingston milonga"], "en");
    expect(blocks2).toHaveLength(1);
    const block2 = blocks2[0]!;
    const text2 = pageText.slice(block2.start, block2.end);
    expect(text2).toContain("19:30 - 22:30");
    expect(text2).not.toContain("20:00");
  });
});
