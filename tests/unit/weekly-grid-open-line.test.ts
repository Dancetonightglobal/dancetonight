import { describe, expect, it } from "vitest";
import { weeklyGridRule, weeklyGridOpenRule } from "@/src/pipeline/weekly-grid";
import { foldPage } from "@/src/domain/text-facts";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const LA_VAQUITA = `LA VAQUITA · playa, México

BOOK YOUR TICKETS AND VIP [https://mandalatickets.com/en/playa/disco/la-vaquita#]

LA VAQUITA: Where PLAYA DEL CARMEN Night Comes Alive

Open: From Thursday to Sunday starting at 8:30 PM to 3:00 AM

How to get to LA VAQUITA PLAYA DEL CARMEN?`;

const RAKATA = `RAKATA

Open: Friday and Saturday nights starting at 8:00 PM to 3:00 AM

Some other text`;

const SANTITO = `Santito Tun Tun

Open: Friday and Saturday from 8:30 p.m. to 3:00 a.m.`;

const MANDALA = `MANDALA

Open: Daily from 8:30 PM to 3:00 AM`;

const VAGALUME = `Vagalume

Open: from Thursday to Sunday
Beach club 11:00 am - 6:00 pm | Night Club 7:00 pm - 1:00 am`;

const BONBONNIERE = `Bonbonniere

Open: From Thursday to Saturday starting at 10:00 PM`;

describe("weeklyGridOpenRule", () => {
  it("La Vaquita -> weekly rule TH,FR,SA,SU", () => {
    const rule = weeklyGridOpenRule(LA_VAQUITA, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
    expect(rule!.written).toBe("From Thursday to Sunday starting at 8:30 PM to 3:00 AM");
  });

  it("Rakata -> FR,SA", () => {
    const rule = weeklyGridOpenRule(RAKATA, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(rule!.written).toBe("Friday and Saturday nights starting at 8:00 PM to 3:00 AM");
  });

  it("Santito Tun Tun -> FR,SA", () => {
    const rule = weeklyGridOpenRule(SANTITO, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(rule!.written).toBe("Friday and Saturday from 8:30 p.m. to 3:00 a.m.");
  });

  it("Mandala -> DAILY", () => {
    const rule = weeklyGridOpenRule(MANDALA, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=DAILY");
    expect(rule!.written).toBe("Daily from 8:30 PM to 3:00 AM");
  });

  it("Vagalume -> TH..SU", () => {
    const rule = weeklyGridOpenRule(VAGALUME, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
    expect(rule!.written).toBe("from Thursday to Sunday");
  });

  it("Bonbonniere -> TH,FR,SA", () => {
    const rule = weeklyGridOpenRule(BONBONNIERE, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
    expect(rule!.written).toBe("From Thursday to Saturday starting at 10:00 PM");
  });

  it("Open: Monday to Friday -> MO..FR", () => {
    const text = `Open: Monday to Friday`;
    const rule = weeklyGridOpenRule(text, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  it("Open: Thursday, Friday and Saturday -> TH,FR,SA", () => {
    const text = `Open: Thursday, Friday and Saturday`;
    const rule = weeklyGridOpenRule(text, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
  });

  it("Open: 24 hours -> null", () => {
    const text = `Open: 24 hours`;
    const rule = weeklyGridOpenRule(text, "en");
    expect(rule).toBeNull();
  });

  it("Open: by reservation -> null", () => {
    const text = `Open: by reservation`;
    const rule = weeklyGridOpenRule(text, "en");
    expect(rule).toBeNull();
  });

  it("Two conflicting open lines -> null", () => {
    const text = `Open: Daily from 8 PM
Open: Friday and Saturday`;
    const rule = weeklyGridOpenRule(text, "en");
    expect(rule).toBeNull();
  });

  it("Two identical open lines -> rule", () => {
    const text = `Open: Friday and Saturday
Some other
Open: Friday and Saturday`;
    const rule = weeklyGridOpenRule(text, "en");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
  });
});

describe("weeklyGridRule with open line", () => {
  it("La Vaquita via weeklyGridRule", () => {
    const page = foldPage(LA_VAQUITA);
    const result = weeklyGridRule(page, LA_VAQUITA, "La Vaquita", null, "en", null, true);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
    expect(result!.written).toBe("From Thursday to Sunday starting at 8:30 PM to 3:00 AM");
  });

  it("Rakata via weeklyGridRule", () => {
    const page = foldPage(RAKATA);
    const result = weeklyGridRule(page, RAKATA, "Rakata", null, "en", null, true);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
  });

  it("Santito Tun Tun via weeklyGridRule", () => {
    const page = foldPage(SANTITO);
    const result = weeklyGridRule(page, SANTITO, "Santito Tun Tun", null, "en", null, true);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
  });

  it("Mandala via weeklyGridRule -> DAILY", () => {
    const page = foldPage(MANDALA);
    const result = weeklyGridRule(page, MANDALA, "Mandala", null, "en", null, true);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=DAILY");
  });

  it("Vagalume via weeklyGridRule", () => {
    const page = foldPage(VAGALUME);
    const result = weeklyGridRule(page, VAGALUME, "Vagalume", null, "en", null, true);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
  });

  it("Bonbonniere via weeklyGridRule", () => {
    const page = foldPage(BONBONNIERE);
    const result = weeklyGridRule(page, BONBONNIERE, "Bonbonniere", null, "en", null, true);
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
  });

  it("givenPhrase 'From Thursday to Sunday' still works", () => {
    const page = foldPage(LA_VAQUITA);
    const result = weeklyGridRule(
      page,
      LA_VAQUITA,
      "La Vaquita",
      "From Thursday to Sunday",
      "en",
      null,
      true,
    );
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
  });

  it("heading strategy wins over open line when both present", () => {
    const text = `Friday: Ladies Night
Open: Daily from 8:30 PM to 3:00 AM`;
    const page = foldPage(text);
    const result = weeklyGridRule(page, text, "Ladies Night", null, "en", null, true);
    // Should get weekly rule from day prefix (strategy 1), not daily
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
  });
});

describe("extractionToHarvested with weeklyGrid and open line", () => {
  const NOW = new Date("2026-11-07T10:00:00Z");
  const TODAY = "2026-11-07";

  function read(listings: Array<Record<string, unknown>>, weeklyGrid: boolean) {
    const raw = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: listings.map((l) => ({
        listing_type: "social",
        styles: ["hip_hop_club"],
        venue: { name: "La Vaquita" },
        organizer: {},
        ...l,
      })),
    });
    return extractionToHarvested(raw, {
      pageUrl: "https://mandalatickets.com/en/playa/disco/la-vaquita",
      fetchedAt: NOW,
      today: TODAY,
      pageText: LA_VAQUITA,
      countryCode: "MX",
      weeklyGrid,
      venueLabel: "La Vaquita Playa del Carmen",
    });
  }

  it("with weeklyGrid: true -> one listing with weekly rule", () => {
    const h = read([{ title: "La Vaquita", recurrence_text: "From Thursday to Sunday" }], true);
    expect(h.listings).toHaveLength(1);
    const rule = h.listings[0]!.recurrence?.rrule;
    expect(rule).toBeDefined();
    expect(rule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
  });

  it("without weeklyGrid, the model's phrase the page writes is still the rule (a leading From reads as the range)", () => {
    const h = read([{ title: "La Vaquita", recurrence_text: "From Thursday to Sunday" }], false);
    expect(h.listings).toHaveLength(1);
    expect(h.listings[0]!.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
  });

  it("without weeklyGrid, no rule is read from the Open line when the model gives none", () => {
    const h = read([{ title: "La Vaquita" }], false);
    expect(h.listings[0]?.recurrence?.rrule).toBeUndefined();
  });
});

describe("weeklyGridOpenRule labels", () => {
  it("weeklyGridRule reads no open line on a page that is not the venue's own", () => {
    expect(
      weeklyGridRule(foldPage(LA_VAQUITA), LA_VAQUITA, "La Vaquita", null, "en", null),
    ).toBeNull();
    expect(
      weeklyGridRule(foldPage(LA_VAQUITA), LA_VAQUITA, "La Vaquita", null, "en", null, false),
    ).toBeNull();
  });

  it('"Opening hours:" is read, not taken for "open"', () => {
    expect(weeklyGridOpenRule("Opening hours: Friday and Saturday from 10 PM", "en")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=FR,SA",
    );
  });

  it("a line without the colon is no open line", () => {
    expect(weeklyGridOpenRule("Open bar all night on Friday", "en")).toBeNull();
  });
});
