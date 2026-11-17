// The recall eval's pure half (D-112): the owner's CSV, the dedupe scorer with a list row as one
// side, and PLAN 12's four miss classes.

import { describe, expect, it } from "vitest";

import {
  bestMatch,
  buildRecallReport,
  classifyMiss,
  clockGap,
  parseClock,
  parseRecallCsv,
  type RecallListing,
  type RecallRow,
  type RelatedSource,
  rowFamily,
  textNamesTitle,
} from "@/src/domain/recall";

const row = (over: Partial<RecallRow> = {}): RecallRow => ({
  line: 2,
  title: "Frim Fram Jam",
  venue: "You Should Be Dancing",
  start: "20:30",
  style: "lindy hop",
  url: "https://frimframjam.com/calendar/20261008",
  ...over,
});

const listing = (over: Partial<RecallListing> = {}): RecallListing => ({
  id: "a",
  title: "Frim Fram Jam",
  start: "20:30",
  canonicalUrl: null,
  ticketUrl: null,
  eventUrls: [],
  sites: [],
  titleSimilarity: 1,
  venueSimilarity: null,
  ...over,
});

const source = (over: Partial<RelatedSource> = {}): RelatedSource => ({
  url: "https://frimframjam.com/calendar",
  enabled: true,
  robotsDisallowed: false,
  failing: null,
  fetchedAt: "2026-10-07 22:00",
  textNamesTitle: false,
  ...over,
});

describe("parseClock", () => {
  it("reads the ways people write a start", () => {
    expect(parseClock("21:00")).toBe("21:00");
    expect(parseClock("9pm")).toBe("21:00");
    expect(parseClock("9:30 PM")).toBe("21:30");
    expect(parseClock("12am")).toBe("00:00");
    expect(parseClock("12pm")).toBe("12:00");
    expect(parseClock("noon")).toBe("12:00");
    expect(parseClock("1.15am")).toBe("01:15");
  });
  it("refuses what is not a time", () => {
    for (const s of ["", "9", "25:00", "13pm", "9:75pm", "late", "TBA"])
      expect(parseClock(s)).toBeNull();
  });
});

describe("parseRecallCsv", () => {
  it("reads the columns by header, quoted fields and comments", () => {
    const { rows, problems } = parseRecallCsv(
      [
        "# night of 2026-10-08",
        "Title,Venue,Start_Time,Style,Source_URL",
        '"Swing, Remix",Ukrainian National Home,8pm,lindy,https://swingremixnyc.com/',
        '"A ""quoted"" night",,,,',
        "",
      ].join("\r\n"),
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        line: 3,
        title: "Swing, Remix",
        venue: "Ukrainian National Home",
        start: "20:00",
        style: "lindy",
        url: "https://swingremixnyc.com/",
      },
      { line: 4, title: 'A "quoted" night', venue: null, start: null, style: null, url: null },
    ]);
  });
  it("reports what it could not read rather than dropping it", () => {
    const { rows, problems } = parseRecallCsv(
      "title,start_time,source_url,notes\n,9pm,,\nSalsa,late,javascript:alert(1),x\n",
    );
    expect(rows).toEqual([
      { line: 3, title: "Salsa", venue: null, start: null, style: null, url: null },
    ]);
    expect(problems).toEqual([
      'header: column "notes" is not read',
      "line 2: no title, so not read",
      'line 3: start time "late" not read',
      'line 3: source URL "javascript:alert(1)" is not http(s)',
    ]);
  });
  it("needs a title column", () => {
    expect(parseRecallCsv("name,venue\nx,y\n").problems).toEqual([
      'the header has no "title" column',
    ]);
  });
});

describe("matching a row to a listing with the dedupe scorer", () => {
  it("measures starts across midnight", () => {
    expect(clockGap("23:30", "00:30")).toBe(60);
    expect(clockGap("21:00", "22:31")).toBe(91);
  });
  it("finds the same title at the same time", () => {
    expect(bestMatch(row(), [listing()])?.score).toBe(0.5);
  });
  it("never matches starts more than 90 minutes apart", () => {
    expect(bestMatch(row({ start: "18:00" }), [listing()])).toBeNull();
    // A side with no time does not disagree.
    expect(bestMatch(row({ start: null }), [listing()])).not.toBeNull();
    expect(bestMatch(row(), [listing({ start: null })])).not.toBeNull();
  });
  it("finds a differently titled night by its organiser's site, venue and link", () => {
    const remix = row({
      title: "Swing Remix",
      venue: "Ukrainian National Home",
      start: "20:00",
      url: "https://swingremixnyc.com/events",
    });
    const brooks = listing({
      title: "The Brooks Prumo Orchestra",
      start: "20:00",
      titleSimilarity: 0.05,
      venueSimilarity: 1,
      sites: ["swingremixnyc.com"],
      canonicalUrl: "https://swingremixnyc.com/events",
    });
    expect(bestMatch(remix, [brooks])?.listing.id).toBe("a");
    // Without the site and link, a title this far off is another night.
    expect(bestMatch(remix, [{ ...brooks, sites: [], canonicalUrl: null }])).toBeNull();
  });
  it("matches an Eventbrite link only exactly, never by the platform's domain", () => {
    const eb = row({ title: "Contra", url: "https://www.eventbrite.com/e/contra-1" });
    const other = listing({ title: "Ceilidh", titleSimilarity: 0.1 });
    expect(
      bestMatch(eb, [{ ...other, ticketUrl: "https://www.eventbrite.com/e/ceilidh-2" }]),
    ).toBeNull();
    expect(
      bestMatch(eb, [
        { ...other, venueSimilarity: 1, eventUrls: ["https://www.eventbrite.com/e/contra-1"] },
      ])?.score,
    ).toBe(0.35);
  });
  it("takes the best score, then the lower id", () => {
    const best = bestMatch(row(), [
      listing({ id: "b" }),
      listing({ id: "c", venueSimilarity: 0.9 }),
      listing({ id: "a" }),
    ]);
    expect(best?.listing.id).toBe("c");
    expect(bestMatch(row(), [listing({ id: "b" }), listing({ id: "a" })])?.listing.id).toBe("a");
  });

  it("finds same venue and close title (D-227)", () => {
    // same venue (venueSimilarity: 1), titleSimilarity: 0.65, no URLs, starts equal -> found
    const l1 = listing({ venueSimilarity: 1, titleSimilarity: 0.65 });
    expect(bestMatch(row(), [l1])).not.toBeNull();
    // same venue, titleSimilarity: 0.55 -> null
    const l2 = listing({ venueSimilarity: 1, titleSimilarity: 0.55 });
    expect(bestMatch(row(), [l2])).toBeNull();
    // venueSimilarity: 0.5, titleSimilarity: 0.65 -> null
    const l3 = listing({ venueSimilarity: 0.5, titleSimilarity: 0.65 });
    expect(bestMatch(row(), [l3])).toBeNull();
    // same venue, titleSimilarity: 0.9, starts 3 hours apart -> null
    const l4 = listing({
      venueSimilarity: 1,
      titleSimilarity: 0.9,
      start: "23:30",
    });
    expect(bestMatch(row({ start: "20:30" }), [l4])).toBeNull();
  });
});

describe("classifyMiss: PLAN 12's four classes", () => {
  const none = { mergedInto: null, misplaced: null, sources: [] };
  it("deduped_away when a matching listing was merged into another", () => {
    expect(
      classifyMiss({
        ...none,
        mergedInto: { mergedTitle: "Frim Fram Jam", survivorTitle: "Gotham Jazz" },
        sources: [source({ textNamesTitle: true })],
      }).cause,
    ).toBe("deduped_away");
  });
  it("extracted_wrong when a listing has the wrong night or start, or a read page names it", () => {
    expect(
      classifyMiss({ ...none, misplaced: { title: "Frim Fram Jam", night: "x", why: "y" } }).cause,
    ).toBe("extracted_wrong");
    expect(classifyMiss({ ...none, sources: [source({ textNamesTitle: true })] })).toEqual({
      cause: "extracted_wrong",
      detail:
        "https://frimframjam.com/calendar (fetched 2026-10-07 22:00) names it, and no listing was written",
    });
  });
  it("no_source_known when no source shares its site", () => {
    expect(classifyMiss(none).cause).toBe("no_source_known");
  });
  it("source_not_harvested names why for each source", () => {
    const miss = classifyMiss({
      ...none,
      sources: [
        source({ url: "https://a.example/", enabled: false }),
        source({ url: "https://b.example/", robotsDisallowed: true }),
        source({ url: "https://c.example/", failing: "HTTP 503" }),
        source({ url: "https://d.example/", fetchedAt: null }),
        source({ url: "https://e.example/" }),
      ],
    });
    expect(miss.cause).toBe("source_not_harvested");
    expect(miss.detail).toBe(
      [
        "https://a.example/ (switched off)",
        "https://b.example/ (robots.txt disallows it)",
        "https://c.example/ (failing: HTTP 503)",
        "https://d.example/ (not fetched before the night)",
        "https://e.example/ (fetched 2026-10-07 22:00; the page does not name it)",
      ].join("; "),
    );
  });
});

describe("the report", () => {
  it("counts found and missed, by cause and by family, with one line per miss", () => {
    const r1 = row();
    const r2 = row({ line: 3, title: "Salsa Social", style: "salsa" });
    const r3 = row({ line: 4, title: "Mystery", style: null });
    const report = buildRecallReport(
      "nyc",
      "2026-10-08",
      [
        {
          row: r1,
          family: rowFamily(r1),
          found: { title: "Frim Fram Jam", score: 0.5 },
          miss: null,
        },
        {
          row: r2,
          family: rowFamily(r2),
          found: null,
          miss: { cause: "no_source_known", detail: "no source shares its site" },
        },
        {
          row: r3,
          family: rowFamily(r3),
          found: null,
          miss: { cause: "source_not_harvested", detail: "x" },
        },
      ],
      ["line 9: no title, so not read"],
    );
    expect(report).toMatchObject({
      found: 1,
      missed: 2,
      missesByCause: {
        no_source_known: 1,
        source_not_harvested: 1,
        extracted_wrong: 0,
        deduped_away: 0,
      },
    });
    expect(report.byFamily["no style given"]).toEqual({ found: 0, missed: 1 });
    expect(report.lines[0]).toBe("Recall, nyc, night of 2026-10-08: 1 of 3 found (33%), 2 missed");
    expect(report.lines).toContain(
      '  line 3 "Salsa Social": no_source_known: no source shares its site',
    );
    expect(report.lines).toContain("  line 9: no title, so not read");
  });
  it("reads the family from the owner's style words", () => {
    expect(rowFamily(row({ style: "lindy hop" }))).not.toBeNull();
    expect(rowFamily(row({ style: null }))).toBeNull();
  });
});

describe("textNamesTitle", () => {
  it("finds the title as whole words, ignoring case and accents", () => {
    expect(textNamesTitle("Thu Oct 8 — FRIM FRAM JAM, 8:30pm", "Frim Fram Jam")).toBe(true);
    expect(textNamesTitle("Milonga Peña tonight", "milonga pena")).toBe(true);
    expect(textNamesTitle("Frim Frammy Jam", "Frim Fram Jam")).toBe(false);
    expect(textNamesTitle("anything", "!!!")).toBe(false);
  });
});
