import { describe, expect, it } from "vitest";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

// D-676: a title the model ends with the class level the page writes on its own line in that class's cell
// ("Salsa Partner Work Level 2", where agozar.com writes "Salsa Partner Work / Drop-in / Alexandre / Level 2")
// stands under the page's title; a level the page does not write there is not dropped, and the title is still
// not the page's (coverage-89, 2026-11-02).

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "class",
      styles: ["salsa"],
      venue: { name: "Agozar" },
      organizer: {},
      ...l,
    })),
  });
}

// agozar.com's drop-in grid, 2026-11-01 (read on a runner; the Mac cannot fetch it), one cell per line.
const AGOZAR_GRID = `Class Schedule -
OCTOBER 2026
No sign up needed for drop-in classes, just walk in
Tuesday
7pm-8pm
Body Isolation & Application
Drop-in
Sasha
All Levels
8pm-9pm
Salsa Partner Work
Drop-in
Alexandre
Level 2
Salsa Open Work
Drop-in
Sasha
Level 3
9pm-10pm
Salsa Partner Work
Drop-in
Alessio
Level 3
Thursday
7pm-8pm
Salsa Partner Work
Drop-in
Alexandre
Level 2
8pm-9pm
Body Movement & Isolation
Drop-in
Sasha
All Levels
9pm-10pm
Salsa Partner Work
Drop-in
Sasha
Level 1
Salsa Partner Work
Drop-in
Alexandre
Level 4`;

function read(listings: Array<Record<string, unknown>>) {
  return extractionToHarvested(reply(listings), {
    pageUrl: "https://www.agozar.com/",
    fetchedAt: new Date("2026-11-02T03:30:00Z"),
    today: "2026-11-02",
    pageText: AGOZAR_GRID,
    countryCode: "HK",
    weeklyGrid: true,
  });
}

describe("a class title the model ends with its level (D-676)", () => {
  it("lists 'Salsa Partner Work Level 2' and 'Level 3' under the page's title, one row each", () => {
    const harvested = read([
      {
        title: "Salsa Partner Work Level 2",
        recurrence: "Tuesday",
        lesson_time: "20:00",
        end_time: "21:00",
      },
      {
        title: "Salsa Partner Work Level 3",
        recurrence: "Tuesday",
        lesson_time: "21:00",
        end_time: "22:00",
      },
    ]);
    expect(
      harvested.rejected.filter((r) => r.reason.includes("does not write this title")),
    ).toEqual([]);
    const titles = harvested.listings.map((l) => l.listing.title);
    expect(titles).toEqual(["Salsa Partner Work", "Salsa Partner Work"]);
    const starts = harvested.listings.map((l) => l.listing.lesson_time ?? l.listing.dancing_time);
    expect(starts).toEqual(["20:00", "21:00"]);
  });

  it("gives two levels that share a slot (Thu 9pm Level 1 and Level 4) the page's title and the same start", () => {
    const harvested = read([
      {
        title: "Salsa Partner Work Level 1",
        recurrence: "Thursday",
        lesson_time: "21:00",
        end_time: "22:00",
      },
      {
        title: "Salsa Partner Work Level 4",
        recurrence: "Thursday",
        lesson_time: "21:00",
        end_time: "22:00",
      },
    ]);
    expect(
      harvested.rejected.filter((r) => r.reason.includes("does not write this title")),
    ).toEqual([]);
    expect(harvested.listings.map((l) => l.listing.title)).toEqual([
      "Salsa Partner Work",
      "Salsa Partner Work",
    ]);
    const starts = new Set(
      harvested.listings.map((l) => l.listing.lesson_time ?? l.listing.dancing_time),
    );
    expect([...starts]).toEqual(["21:00"]);
  });

  it("still rejects a level the page does not write ('Level 5')", () => {
    const harvested = read([
      {
        title: "Salsa Partner Work Level 5",
        recurrence: "Tuesday",
        lesson_time: "20:00",
        end_time: "21:00",
      },
    ]);
    expect(harvested.listings).toHaveLength(0);
    expect(harvested.rejected.map((r) => r.title)).toEqual(["Salsa Partner Work Level 5"]);
  });

  it("still rejects a level the page writes only in another class's cell ('Body Isolation & Application Level 2')", () => {
    // The page writes "Level 2" under Salsa Partner Work, never under Body Isolation & Application ("All Levels").
    const harvested = read([
      {
        title: "Body Isolation & Application Level 2",
        recurrence: "Tuesday",
        lesson_time: "19:00",
        end_time: "20:00",
      },
    ]);
    expect(harvested.listings).toHaveLength(0);
    expect(harvested.rejected.map((r) => r.title)).toEqual([
      "Body Isolation & Application Level 2",
    ]);
  });

  it("keeps a title the page writes whole, levels and all, unchanged", () => {
    const harvested = read([
      {
        title: "Body Isolation & Application",
        recurrence: "Tuesday",
        lesson_time: "19:00",
        end_time: "20:00",
      },
    ]);
    expect(harvested.listings.map((l) => l.listing.title)).toEqual([
      "Body Isolation & Application",
    ]);
  });
});
