// Date headings, the window's nights a text writes, and the date-above check (D-074), calibrated
// on the saved pages: every hand-checked dated case of the link matcher's 14 tuned pages and its
// held-out layouts keeps its date, and This Week in Swing's Gotham Jazz, which run 21 dated
// October 1, does not.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HELD_OUT } from "@/evals/links/heldout";
import {
  headingDateKey,
  isDateHeading,
  listedOnlyUnderOtherDates,
  windowNightsWritten,
} from "@/src/domain/text-facts";
import { cleanPageText } from "@/src/pipeline/clean";

const LINKS = join(__dirname, "../../evals/links");
const pageText = (name: string) => readFileSync(join(LINKS, "pages", `${name}.txt`), "utf8");
const WINDOW = Array.from({ length: 14 }, (_, i) =>
  new Date(Date.UTC(2026, 8, 29 + i)).toISOString().slice(0, 10),
);

describe("a date heading", () => {
  it("is a line that writes a date and nothing else", () => {
    for (const line of [
      "Wednesday, September 30",
      "Thursday, October 1, 2026",
      "Friday, October 9 – Sunday, October 11",
      "Oct 11 [https://www.rscdsnewyork.org/all-events/brooklynsocial2026october]",
      "October 3rd",
      "10/1",
    ]) {
      expect(isDateHeading(line, "en"), line).toBe(true);
    }
    for (const line of [
      "Saturday, October 24, 2026 | 7:00 PM–12:30 AM",
      "September 28, 2026 [https://x.example/] Eileen O'Donnell [https://x.example/author/eileen/]",
      "Gotham Jazz",
      "September",
      "Every Thursday",
      "DJ Dance & SUNDAY AUG 30th may include some LIVE MUSIC",
    ]) {
      expect(isDateHeading(line, "en"), line).toBe(false);
    }
  });

  it("is keyed by the date it writes, however it writes it", () => {
    expect(headingDateKey("Oct 11 [https://x.example/e]")).toBe("10-11");
    expect(headingDateKey("October 11, 2026")).toBe("10-11");
    expect(headingDateKey("Sunday, 11 October")).toBe("10-11");
  });
});

describe("the window's nights a text writes", () => {
  it("counts This Week in Swing's 14, and none on a page of weekly nights", () => {
    expect(windowNightsWritten(pageText("thisweekinswingnyc-com"), WINDOW, "en")).toBe(14);
    expect(
      windowNightsWritten(pageText("steppingoutstudios-com-social-events1"), WINDOW, "en"),
    ).toBe(0);
    expect(windowNightsWritten("Every Thursday, 8pm", WINDOW, "en")).toBe(0);
  });

  it("does not count a night written in another year", () => {
    expect(windowNightsWritten("October 1, 2020; October 2, 2020; October 3, 2020", WINDOW)).toBe(
      0,
    );
    expect(windowNightsWritten("October 1, 2026; October 2; 10/3/26", WINDOW)).toBe(3);
  });
});

describe("a title listed only under other nights", () => {
  it("is This Week in Swing's Gotham Jazz dated October 1", () => {
    const twis = pageText("thisweekinswingnyc-com");
    expect(listedOnlyUnderOtherDates(twis, "Gotham Jazz", "2026-10-01", "en")).toBe(
      "Wednesday, September 30",
    );
    expect(listedOnlyUnderOtherDates(twis, "Gotham Jazz", "2026-09-30", "en")).toBeNull();
    expect(listedOnlyUnderOtherDates(twis, "Gotham Jazz", "2026-10-07", "en")).toBeNull();
    // A title the page does not write is left to the title check.
    expect(listedOnlyUnderOtherDates(twis, "Nylon Lindy Hop", "2026-10-01", "en")).toBeNull();
  });

  it("is never a hand-checked listing on the tuned pages (96 dated cases)", () => {
    const tuned = JSON.parse(readFileSync(join(LINKS, "tuned.json"), "utf8")) as {
      cases: Array<{ page: string; title: string; date: string | null }>;
    };
    const dated = tuned.cases.filter((c) => c.date);
    expect(dated).toHaveLength(96);
    const wrong = dated.filter(
      (c) => listedOnlyUnderOtherDates(pageText(c.page), c.title, c.date!, "en") !== null,
    );
    expect(wrong).toEqual([]);
  });

  it("is never a listing in the held-out layouts, dates printed below titles included", () => {
    let dated = 0;
    const wrong: string[] = [];
    for (const page of HELD_OUT) {
      const text = cleanPageText(page.html, page.url);
      for (const c of page.cases) {
        if (!c.date) continue;
        dated += 1;
        if (listedOnlyUnderOtherDates(text, c.title, c.date, "en") !== null) {
          wrong.push(`${page.name}: ${c.title}`);
        }
      }
    }
    expect(dated).toBe(28);
    expect(wrong).toEqual([]);
  });

  it("is a title under a heading of the same day in another year", () => {
    const page = "Thursday, October 1, 2020\n\nFrim Fram Jam\n\nOur first night back.";
    expect(listedOnlyUnderOtherDates(page, "Frim Fram Jam", "2026-10-01", "en")).toBe(
      "Thursday, October 1, 2020",
    );
  });

  it("is not a title found under no heading, or with its own date on its line", () => {
    expect(
      listedOnlyUnderOtherDates(
        "Gotham Jazz\n\nWednesday, September 30",
        "Gotham Jazz",
        "2026-10-01",
      ),
    ).toBeNull();
    expect(
      listedOnlyUnderOtherDates(
        "Wednesday, September 30\n\nGotham Jazz, also Thursday, October 1",
        "Gotham Jazz",
        "2026-10-01",
      ),
    ).toBeNull();
    // A heading that runs across the night covers it.
    expect(
      listedOnlyUnderOtherDates(
        "Friday, October 9 – Sunday, October 11\n\nNew York Lindy Exchange",
        "New York Lindy Exchange",
        "2026-10-10",
      ),
    ).toBeNull();
  });
});
