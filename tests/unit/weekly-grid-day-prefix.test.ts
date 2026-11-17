import { describe, expect, it } from "vitest";
import { weeklyGridDayPrefixRule, weeklyGridRule } from "@/src/pipeline/weekly-grid";
import { foldPage } from "@/src/domain/text-facts";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const FIXTURE = `English nights

Back Home [https://dubaiavenueclub.com/]

Monday: Urban Project

BOOK NOW [https://wa.me/971527812222]

A high-energy mix of Afro, EDM, and Urban Hip-Hop, delivering bold sounds and late-night vibes.

Wednesday: Bad Habits

BOOK NOW [https://wa.me/971527812222]

A crowd-favourite night featuring English chart-toppers and open-format hits, blending today's biggest songs with classic party anthems.

Friday: Ballerz

BOOK NOW [https://wa.me/971527812222]

Turn up your Friday night with BALLERZ! Expect high-energy beats, the hottest hip-hop and R&B tracks, and non-stop party anthems that keep the dance floor moving all night long.

VISIT US

Location

Shangri-La Hotel, Sheikh Zayed Road, 42nd Floor – Dubai

Opening Hours

Everyday 11:00 PM – 04:00 AM`;

describe("weeklyGridDayPrefixRule", () => {
  it("Urban Project -> MO", () => {
    const result = weeklyGridDayPrefixRule(FIXTURE, "Urban Project", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(result!.written).toBe("Monday");
  });

  it("Bad Habits -> WE", () => {
    const result = weeklyGridDayPrefixRule(FIXTURE, "Bad Habits", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(result!.written).toBe("Wednesday");
  });

  it("Ballerz -> FR", () => {
    const result = weeklyGridDayPrefixRule(FIXTURE, "Ballerz", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(result!.written).toBe("Friday");
  });

  it("title not on page -> null", () => {
    const result = weeklyGridDayPrefixRule(FIXTURE, "Salsa Night", "en");
    expect(result).toBeNull();
  });

  it("Monday & Thursday: Salsa Social -> MO,TH", () => {
    const text = `Monday & Thursday: Salsa Social`;
    const result = weeklyGridDayPrefixRule(text, "Salsa Social", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TH");
    expect(result!.written).toBe("Monday & Thursday");
  });

  it("Two lines for same title -> combined days", () => {
    const text = `Tuesday: Kizomba\nSaturday: Kizomba`;
    const result = weeklyGridDayPrefixRule(text, "Kizomba", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,SA");
    expect(result!.written).toBe("Tuesday, Saturday");
  });

  it("Markdown heading with en dash -> TH", () => {
    const text = `## Thursday – Latin Night`;
    const result = weeklyGridDayPrefixRule(text, "Latin Night", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(result!.written).toBe("Thursday");
  });

  it("Nightly: Live Band -> DAILY", () => {
    const text = `Nightly: Live Band`;
    const result = weeklyGridDayPrefixRule(text, "Live Band", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=DAILY");
    expect(result!.written).toBe("Nightly");
  });

  it("Every night: DJ Set -> DAILY", () => {
    const text = `Every night: DJ Set`;
    const result = weeklyGridDayPrefixRule(text, "DJ Set", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=DAILY");
    expect(result!.written).toBe("Every night");
  });

  it.each([
    ["Nightly: Live Band\n\nThursday: Live Band"],
    ["Thursday: Live Band\n\nNightly: Live Band"],
  ])("weekday prefix wins over a daily one for the same title (%#)", (text) => {
    const result = weeklyGridDayPrefixRule(text, "Live Band", "en");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(result!.written).toBe("Thursday");
  });

  it("matches the title as whole words only", () => {
    const text = `Thursday: Pajama Party\n\nSunday: Jam Session`;
    expect(weeklyGridDayPrefixRule("Thursday: Pajama Party", "Jam", "en")).toBeNull();
    expect(weeklyGridDayPrefixRule(text, "Jam", "en")!.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(weeklyGridDayPrefixRule(text, "Jam Session", "en")!.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(weeklyGridDayPrefixRule(text, "Pajama Party", "en")!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("Join us Saturday: Ballerz returns -> null", () => {
    const text = `Join us Saturday: Ballerz returns`;
    const result = weeklyGridDayPrefixRule(text, "Ballerz returns", "en");
    expect(result).toBeNull();
  });

  it("Friday Ladies Night: Ballerz -> null", () => {
    const text = `Friday Ladies Night: Ballerz`;
    const result = weeklyGridDayPrefixRule(text, "Ballerz", "en");
    expect(result).toBeNull();
  });

  it("Friday 7 November: Ballerz -> null", () => {
    const text = `Friday 7 November: Ballerz`;
    const result = weeklyGridDayPrefixRule(text, "Ballerz", "en");
    expect(result).toBeNull();
  });
});

describe("weeklyGridRule with day prefix", () => {
  it("Urban Project via weeklyGridRule", () => {
    const page = foldPage(FIXTURE);
    const result = weeklyGridRule(page, FIXTURE, "Urban Project", null, "en", null);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(result!.written).toBe("Monday");
  });

  it("Bad Habits via weeklyGridRule", () => {
    const page = foldPage(FIXTURE);
    const result = weeklyGridRule(page, FIXTURE, "Bad Habits", null, "en", null);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(result!.written).toBe("Wednesday");
  });

  it("Ballerz via weeklyGridRule", () => {
    const page = foldPage(FIXTURE);
    const result = weeklyGridRule(page, FIXTURE, "Ballerz", null, "en", null);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(result!.written).toBe("Friday");
  });

  it("Nightly Salsa Party fallback -> DAILY", () => {
    const text = `Some page text`;
    const page = foldPage(text);
    const result = weeklyGridRule(page, text, "Nightly Salsa Party", null, "en", null);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=DAILY");
    expect(result!.written).toBe("Nightly Salsa Party");
  });

  it("Fortnightly Salsa -> null", () => {
    const text = `Some page text`;
    const page = foldPage(text);
    const result = weeklyGridRule(page, text, "Fortnightly Salsa", null, "en", null);
    expect(result).toBeNull();
  });
});

describe("extractionToHarvested with weeklyGrid", () => {
  const NOW = new Date("2026-11-07T10:00:00Z");
  const TODAY = "2026-11-07";

  function read(listings: Array<Record<string, unknown>>, weeklyGrid: boolean) {
    const raw = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: listings.map((l) => ({
        listing_type: "social",
        styles: ["hip_hop_club"],
        venue: { name: "Avenue Club" },
        organizer: {},
        ...l,
      })),
    });
    return extractionToHarvested(raw, {
      pageUrl: "https://dubaiavenueclub.com/nights",
      fetchedAt: NOW,
      today: TODAY,
      pageText: FIXTURE,
      countryCode: "AE",
      weeklyGrid,
    });
  }

  it("with weeklyGrid: true -> three listings with weekly rules", () => {
    const h = read(
      [{ title: "Urban Project" }, { title: "Bad Habits" }, { title: "Ballerz" }],
      true,
    );
    expect(h.listings).toHaveLength(3);
    const rules = h.listings.map((l) => l.recurrence?.rrule);
    expect(rules).toContain("FREQ=WEEKLY;BYDAY=MO");
    expect(rules).toContain("FREQ=WEEKLY;BYDAY=WE");
    expect(rules).toContain("FREQ=WEEKLY;BYDAY=FR");
  });

  it("without weeklyGrid -> no recurrence", () => {
    const h = read(
      [{ title: "Urban Project" }, { title: "Bad Habits" }, { title: "Ballerz" }],
      false,
    );
    expect(h.listings).toHaveLength(3);
    for (const l of h.listings) {
      expect(l.recurrence?.rrule).toBeUndefined();
    }
  });
});
