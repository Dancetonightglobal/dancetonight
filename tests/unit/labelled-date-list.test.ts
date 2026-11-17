import { describe, expect, it } from "vitest";
import { rawExtractionSchema } from "@/src/domain/listing";
import { contradictingDate, dateBesideTitle, foldPage } from "@/src/domain/text-facts";
import { titleBlocks } from "@/src/domain/title-blocks";
import { extractionToHarvested } from "@/src/pipeline/extract";

// El Fenn's Sol Sundays page as the 2026-11-10 Marrakesh read cleaned it (run 42782847783): a
// paragraph says "every other Sunday", then a "DATES" label over the list of dates, then "TIME".
const EL_FENN = `SUNDAY NIGHTS ON THE EL FENN ROOFTOP

SOL SUNDAYS

A rooftop music residency at El Fenn

This autumn, the El Fenn rooftop has a new resident DJ. From 11th October, Shems takes over the decks every other Sunday, playing from late afternoon into the evening. With rooftop views over the medina and Atlas Mountains beyond, arrive for sunset and stay as stars fill the sky and night falls.

DATES

Sunday 25th October

Sunday 8th November

Sunday 22nd November

Sunday 6th December

TIME

5pm – 10pm

FREE ENTRY

Just come in through the boutique and our host team will show you up to the rooftop. We recommend arriving before sunset. While we try to make room for everyone, capacity is limited.

MEET SHEMS

Shems grew up between London and Marrakech in a house full of turntables and crates of records.`;

const DATES = ["2026-10-25", "2026-11-08", "2026-11-22", "2026-12-06"];

function reply() {
  return rawExtractionSchema.parse({
    page_kind: "single_event",
    language: "en",
    listings: DATES.map((local_date) => ({
      title: "SOL SUNDAYS",
      listing_type: "dj_night",
      styles: [],
      venue: { name: "El Fenn" },
      organizer: {},
      local_date,
      recurrence_text: "every other Sunday",
      dancing_time: "17:00",
      end_time: "22:00",
      is_free: true,
    })),
  });
}

describe("a labelled list of dates under a title (D-821)", () => {
  it("states every date in the list, past the 60-word block", () => {
    const page = foldPage(EL_FENN);
    for (const date of DATES) {
      expect(dateBesideTitle(page, "SOL SUNDAYS", date, "en", ["SOL SUNDAYS"]).stated).toBe(true);
    }
    // An off-week Sunday is not stated, and the page's list contradicts it: a row stored for it
    // (read 3 kept one on 2026-11-15) is retired by the stored-night check.
    expect(dateBesideTitle(page, "SOL SUNDAYS", "2026-11-15", "en", ["SOL SUNDAYS"]).stated).toBe(
      false,
    );
    expect(
      contradictingDate(page, EL_FENN, "SOL SUNDAYS", "2026-11-15", "en", ["SOL SUNDAYS"]),
    ).not.toBeNull();
  });

  it("does not end the title's block at the listed dates, so the time under them is its own", () => {
    for (const facts of [false, true]) {
      const blocks = titleBlocks(EL_FENN, "SOL SUNDAYS", ["SOL SUNDAYS"], "en", undefined, {
        facts,
      });
      expect(blocks.some((b) => b.text.includes("5pm – 10pm"))).toBe(true);
      expect(blocks.some((b) => b.text.includes("FREE ENTRY"))).toBe(true);
    }
  });

  it("keeps the model's dated rows, with their time and free entry, over 'every other Sunday'", () => {
    const harvested = extractionToHarvested(reply(), {
      pageUrl: "https://el-fenn.com/sol-sundays-at-el-fenn/",
      fetchedAt: new Date("2026-11-10T09:00:00Z"),
      today: "2026-11-10",
      pageText: EL_FENN,
      countryCode: "MA",
    });
    const dates = harvested.listings.map((h) => h.listing.local_date).sort();
    expect(dates).toEqual(DATES);
    // The dated list wins: no "every other Sunday" rule runs on past 6 December.
    expect(harvested.listings.every((h) => h.recurrence === null)).toBe(true);
    expect(harvested.listings.every((h) => h.listing.recurrence_text === null)).toBe(true);
    const nov22 = harvested.listings.find((h) => h.listing.local_date === "2026-11-22")!;
    expect(nov22.listing.dancing_time).toBe("17:00");
    expect(nov22.listing.end_time).toBe("22:00");
    expect(nov22.listing.is_free).toBe(true);
    const notes = harvested.notes ?? [];
    expect(notes.join("\n")).not.toContain("beside a recurrence it does");
    expect(notes.join("\n")).not.toContain("time their part of the page does not write");
  });

  it("a short line that is not a date word is no dates label ('Featured', Frim Fram Jam)", () => {
    const text = `Thursday Jam\n\nSwing dancing every Thursday.\n\nFeatured\n\nOct 1\n\nOctober 1, 2026`;
    const page = foldPage(text);
    expect(dateBesideTitle(page, "Thursday Jam", "2026-10-08", "en").otherDate).toBeNull();
  });

  it("a date heading under a sentence, with no label, still ends the block (unchanged)", () => {
    const text = `Salsa Social\n\nA friendly night of salsa at the hall.\n\nSunday 8th November\n\nBachata Brunch 9pm – 11pm`;
    const blocks = titleBlocks(text, "Salsa Social", ["Salsa Social"], "en");
    expect(blocks[0]!.text).not.toContain("9pm");
  });
});
