// The grounding review's findings (2026-09-29), each held by a case that fails without its fix: a
// URL printed as text grounds no title (#5); a title in a script written without spaces is found
// (#4); a title found only by its respacing places its recurrence too (#3); a reworded recurrence
// is read as the page's, and one the page does not write near the title costs the listing its
// rule, never its rows (#1); on a directory the matcher's checked link wins over the model's (#9).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import {
  findPhrase,
  foldPage,
  phraseSpans,
  recurrenceNearTitle,
  weekdaysNearTitle,
} from "@/src/domain/text-facts";
import { cleanPageText } from "@/src/pipeline/clean";
import { extractionToHarvested } from "@/src/pipeline/extract";

const NOW = new Date("2026-09-28T14:00:00Z");
const TONIGHT = "2026-09-28";

function reply(listings: Array<Record<string, unknown>>, language = "en") {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language,
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "A studio" },
      organizer: {},
      ...l,
    })),
  });
}

const read = (
  pageUrl: string,
  text: string,
  listings: Array<Record<string, unknown>>,
  extra: { directory?: boolean; language?: string } = {},
) =>
  extractionToHarvested(reply(listings, extra.language), {
    pageUrl,
    fetchedAt: NOW,
    today: TONIGHT,
    pageText: text,
    countryCode: "US",
    directory: extra.directory,
  });

describe("a URL printed as text (#5)", () => {
  const slug = "https://www.eventbrite.com/e/salsa-night-tickets-123456";

  it("grounds no title, bare or as cleanPageText writes a link labelled with its address", () => {
    const bare = `Upcoming\n${slug}\nCome dance every Thursday`;
    expect(findPhrase(foldPage(bare), "Salsa Night")).toBeNull();
    expect(findPhrase(foldPage(bare), "Salsa Night Tickets")).toBeNull();
    const cleaned = cleanPageText(
      `<p>Upcoming</p><p><a href="${slug}">${slug}</a></p><p>Come dance every Thursday</p>`,
      "https://salsa.example/",
    );
    expect(cleaned).toContain(slug);
    const result = read("https://salsa.example/", cleaned, [
      { title: "Salsa Night Tickets", recurrence_text: "every Thursday" },
    ]);
    expect(result.listings).toEqual([]);
    expect(result.notOnPage).toEqual(["Salsa Night Tickets"]);
  });

  it("still finds the words printed around the URL", () => {
    const page = foldPage(`Tickets: ${slug} Salsa Night, Friday`);
    expect(findPhrase(page, "Salsa Night")).toBe("exact");
    expect(findPhrase(page, "Tickets")).toBe("exact");
  });
});

describe("a title in a script written without spaces (#4)", () => {
  // The review's three pages: the title sits inside a run of characters no space breaks.
  const CASES = [
    {
      lang: "zh",
      page: "每周六晚上萨尔萨舞会，地点：舞蹈室",
      title: "萨尔萨舞会",
      phrase: "每周六",
    },
    {
      lang: "ja",
      page: "毎週土曜日のタンゴミロンガ 渋谷スタジオ",
      title: "タンゴミロンガ",
      phrase: "毎週土曜日",
    },
    { lang: "th", page: "ปาร์ตี้ซัลซ่าทุกวันศุกร์", title: "ปาร์ตี้ซัลซ่า", phrase: "ทุกวันศุกร์" },
  ];

  it.each(CASES)("finds $title, and its recurrence, inside the run ($lang)", (c) => {
    const page = foldPage(c.page);
    expect(findPhrase(page, c.title)).not.toBeNull();
    expect(findPhrase(page, c.phrase)).not.toBeNull();
    const result = read(
      "https://dance.example/",
      c.page,
      [{ title: c.title, recurrence_text: c.phrase }],
      { language: c.lang },
    );
    expect(result.rejected).toEqual([]);
    expect(result.notOnPage).toEqual([]);
    expect(result.listings.map((h) => h.listing.title)).toEqual([c.title]);
    expect(result.notes.join(" ")).not.toMatch(/recurrence the page does not write/);
  });

  it("finds no title the run does not write, and leaves words of other scripts whole", () => {
    expect(findPhrase(foldPage(CASES[0]!.page), "萨尔萨派对")).toBeNull();
    expect(findPhrase(foldPage(CASES[1]!.page), "タンゴパーティー")).toBeNull();
    // Latin, spaced scripts and digits are words as before: nothing inside a word is found.
    const latin = foldPage("Salsa Nights at the studio 2026");
    expect(findPhrase(latin, "Salsa Night")).toBeNull();
    expect(findPhrase(latin, "alsa Nights")).toBeNull();
    expect(findPhrase(latin, "202")).toBeNull();
    expect(findPhrase(foldPage("Милонга Звезда"), "Милонга Звезд")).toBeNull();
  });
});

describe("a title found only respaced, and its recurrence (#3)", () => {
  it("places the title where findPhrase finds it, in the page's words", () => {
    const page = foldPage("Socials\nN oche Latina\nThursdays 9pm");
    expect(page.words).toEqual(["socials", "n", "oche", "latina", "thursdays", "9pm"]);
    expect(phraseSpans(page, "Noche Latina")).toEqual([[1, 4]]);
    expect(phraseSpans(page, "Socials")).toEqual([[0, 1]]);
    expect(phraseSpans(page, "oche Latina")).toEqual([[2, 4]]);
    expect(phraseSpans(page, "ocials")).toEqual([]);
  });

  it.each([
    ["Socials\nN oche Latina\nThursdays 9pm", "Noche Latina"],
    ["Victoria's Social\nThursdays 9pm", "Victorias Social"],
  ])("reads the page's weekday beside %j", (text, title) => {
    const result = read("https://salsa.example/", text, [
      { title, recurrence_text: "every Thursday", dancing_time: "21:00" },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.recurrence?.rrule)).toEqual(["FREQ=WEEKLY;BYDAY=TH"]);
  });
});

describe("a reworded recurrence (#1b)", () => {
  const STEPPING_OUT = readFileSync(
    join(__dirname, "../../evals/links/pages/steppingoutstudios-com-social-events1.txt"),
    "utf8",
  );
  const phraseKept = (text: string, title: string, phrase: string) => {
    const result = read("https://dance.example/", text, [{ title, recurrence_text: phrase }]);
    expect(result.rejected, `${title}: ${phrase}`).toEqual([]);
    expect(result.notes.join(" ")).not.toMatch(/recurrence the page does not write/);
    return result.listings.map((h) => h.listing.recurrence_text);
  };

  it.each([
    // Stepping Out's saved page: "Every 2nd & last SaturdayTime: 9pm class", "Every 1st, 3rd
    // Friday of the month", "Every 2nd & 4th Sunday of the month".
    ["All Night Milonga", "Every 2nd & last Saturday"],
    ["All Night Milonga", "every second and last Saturday"],
    ["Friday Night Fever", "Every 1st and 3rd Friday of the month"],
    ["Friday Night Fever", "Every first, third Friday"],
    ["La Vieja Guardia Salsa", "Every 2nd and 4th Sunday"],
  ])("reads %s, %j, on Stepping Out's page", (title, phrase) => {
    expect(phraseKept(STEPPING_OUT, title, phrase)).toEqual([phrase]);
  });

  it.each([
    [
      "Dances\nFirst Fridays Contra\nCallers and bands",
      "First Fridays Contra",
      "first Friday of the month",
    ],
    [
      "Tango Brunch\n3rd Saturdays of the month, noon",
      "Tango Brunch",
      "every 3rd Saturday of the month",
    ],
    ["Salsa Sundays\n1st & 3rd Sundays", "Salsa Sundays", "every 1st and 3rd Sunday"],
    ["Swing Out\nFridays, every other week", "Swing Out", "every other Friday"],
    ["Blues Night\nTuesdays 8-11pm", "Blues Night", "Every Tuesday, 8pm"],
    ["West Coast Practice\nMon & Wed, 7pm", "West Coast Practice", "every Monday and Wednesday"],
    ["Lindy Lab\nThurs 8pm", "Lindy Lab", "Every Thursday"],
  ])("reads the page's %j as the model's phrase", (text, title, phrase) => {
    expect(phraseKept(text, title, phrase)).toEqual([phrase]);
  });

  it("still drops a weekday or an ordinal the page does not write near the title", () => {
    for (const [text, title, phrase] of [
      ["Blues Night\nTuesdays 8-11pm", "Blues Night", "every Thursday"],
      ["Salsa Sundays\n1st & 3rd Sundays", "Salsa Sundays", "every 2nd Sunday"],
      ["West Coast Practice\nMon & Wed, 7pm", "West Coast Practice", "every Monday and Friday"],
      [`Salsa Night\n${"word ".repeat(60)}\nJazz on Thursdays`, "Salsa Night", "every Thursday"],
    ] as const) {
      const result = read("https://dance.example/", text, [{ title, recurrence_text: phrase }]);
      expect(result.listings, phrase).toEqual([]);
      expect(result.notes.join(" ")).toMatch(/recurrence the page does not write/);
    }
  });

  it("reads a weekday the page runs on into the next word, and not one inside another word", () => {
    const page = foldPage("All Night Milonga\nDate: Every 2nd & last SaturdayTime: 9pm");
    expect(recurrenceNearTitle(page, "All Night Milonga", "every last Saturday")).toBe(true);
    expect(weekdaysNearTitle(page, "All Night Milonga")).toEqual(new Set(["SA"]));
    // "Monument" is not a Monday, and "sunset" not a Sunday: only full names start a word.
    const other = foldPage("Salsa Night\nMonument Park at sunset");
    expect(weekdaysNearTitle(other, "Salsa Night")).toEqual(new Set());
    expect(recurrenceNearTitle(other, "Salsa Night", "every Monday")).toBe(false);
  });
});

describe("a directory's links, the model's and the matcher's (#9)", () => {
  const SALSA = "https://dir.example/e/salsa-social-2026-10-02";
  const BACHATA = "https://dir.example/e/bachata-night-out-2026-10-03";
  const page = [
    "Friday, October 2",
    `Salsa Social [${SALSA}]`,
    "Saturday, October 3",
    `Bachata Night Out [${BACHATA}]`,
  ].join("\n");

  it("keeps the matcher's checked link when the model gave a neighbour's", () => {
    const result = read(
      "https://dir.example/",
      page,
      [
        { title: "Salsa Social", local_date: "2026-10-02", ticket_url: BACHATA },
        { title: "Bachata Night Out", local_date: "2026-10-03" },
      ],
      { directory: true },
    );
    expect(result.rejected).toEqual([]);
    expect(
      result.listings.map((h) => [h.listing.title, h.eventUrl ?? null, h.listing.ticket_url]),
    ).toEqual([
      ["Salsa Social", SALSA, null],
      ["Bachata Night Out", BACHATA, null],
    ]);
    expect(result.notes).toContain(
      `1 listing(s) linked a page on this site other than the one the page's own links give them: that one kept, the model's dropped: Salsa Social (${BACHATA})`,
    );
  });

  it("keeps the model's same-site link when the matcher finds none", () => {
    // The title's line carries no link; the model's is still one of the page's own.
    const bare = `Friday, October 2\nSalsa Social\nMore: ${SALSA}`;
    const result = read(
      "https://dir.example/",
      bare,
      [{ title: "Salsa Social", local_date: "2026-10-02", ticket_url: SALSA }],
      { directory: true },
    );
    expect(result.listings.map((h) => h.eventUrl ?? null)).toEqual([SALSA]);
    expect(result.notes.join(" ")).not.toMatch(/the model's dropped/);
  });
});
