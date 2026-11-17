import { describe, expect, it } from "vitest";

import { parseRecurrenceText } from "@/src/domain/recurrence";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";
import { weeklyGridOpenRule } from "@/src/pipeline/weekly-grid";

// Grupo Mandala's club pages (MandalaTickets, D-1082) as the page cleaner reads them (2026-11-07): the "Open:"
// label on its own line and the nights and hours on the next. On run 42492351731 (2026-11-08) the model's "From
// Thursday to Sunday" was dropped as a phrase the page does not write, the Open line's hours were dropped as times
// the listing's part of the page does not write, and Bonbonniere's dated Sunday was rejected against "From Thursday
// to Saturday", so it never wrote a row.

const NOW = new Date("2026-11-08T15:00:00Z");
const TODAY = "2026-11-08";

const VAQUITA = `BOOK TICKETS
LA VAQUITA · playa, México
A high-energy nightlife destination designed for those seeking exclusivity, luxury and
unforgettable nights.
BOOK YOUR TICKETS AND VIP
LA VAQUITA: Where PLAYA DEL CARMEN Night Comes Alive
La Vaquita Playa del Carmen is the soul of wild parties in the Caribbean. With its irreverent style, music of all genres, and an energy-filled atmosphere, it offers the most authentic and fun experience on Fifth Avenue. It is the ideal place to leave the rules behind and dance until dawn.
Open:
From Thursday to Sunday starting at 8:30 PM to 3:00 AM
Music:
Reggaeton, hip hop and R&B
Dress code:
Dress to impress!`;

const BONBONNIERE = `BOOK TICKETS
BONBONNIERE · tulum, México
A high-energy nightlife destination designed for those seeking exclusivity, luxury and
unforgettable nights.
BOOK YOUR TICKETS AND VIP
BONBONNIERE: Where TULUM Night Comes Alive
Tulum’s nightlife is unmatched, and Bonbonniere Tulum is at the forefront of it all. Experience unparalleled party nights at Bonbonniere Tulum.
Open:
From Thursday to Saturday starting at 10:00 PM
Music:
A curated soundscape of Tech House, Melodic Techno, Afro House, and Indie Dance.
Dress Code:
Elegant attire is required.`;

// "starting at 8:30 PM" is the night's start: kept as doors or as the dancing start (D-081 relabels it).
const startOf = (
  row: { listing: { doors_time?: string | null; dancing_time?: string | null } } | undefined,
) => row?.listing.doors_time ?? row?.listing.dancing_time ?? null;

// Vagalume's line as the page cleaner writes it (weekly-grid-open-line, #1293): two time ranges, beach club by day.
const VAGALUME = `Vagalume
Open: from Thursday to Sunday Beach club 11:00 am - 6:00 pm | Night Club 7:00 pm - 1:00 am
Music: Electronic`;

function read(pageText: string, url: string, label: string, listing: Record<string, unknown>) {
  const raw = rawExtractionSchema.parse({
    page_kind: "single",
    language: "en",
    listings: [
      { listing_type: "club_night", styles: ["dj_night"], venue: {}, organizer: {}, ...listing },
    ],
  });
  return extractionToHarvested(raw, {
    pageUrl: url,
    fetchedAt: NOW,
    today: TODAY,
    pageText,
    countryCode: "MX",
    weeklyGrid: true,
    venueLabel: label,
  });
}

describe("a leading 'From' before a weekday range (Grupo Mandala)", () => {
  it("parses like the range without it", () => {
    expect(parseRecurrenceText("From Thursday to Sunday", "en")).toBe(
      "FREQ=WEEKLY;BYDAY=TH,FR,SA,SU",
    );
    expect(parseRecurrenceText("from Thursday to Saturday", "en")).toBe(
      "FREQ=WEEKLY;BYDAY=TH,FR,SA",
    );
    expect(parseRecurrenceText("From Thursday to Sunday")).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
  });

  it("does not make a bare 'From' or a dated phrase a rule", () => {
    expect(parseRecurrenceText("From", "en")).toBeNull();
    expect(parseRecurrenceText("From November 12", "en")).toBeNull();
  });
});

describe("an Open: label with its nights on the next line", () => {
  it("reads the next line's nights and keeps the line as the rule's section", () => {
    const rule = weeklyGridOpenRule(VAQUITA, "en");
    expect(rule?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA,SU");
    expect(rule?.section).toContain("8:30 PM to 3:00 AM");
  });

  it("still reads the one-line form (Rakata)", () => {
    const rule = weeklyGridOpenRule(
      "Open: Friday and Saturday nights starting at 8:00 PM to 3:00 AM\nMusic: Reggaeton.",
      "en",
    );
    expect(rule?.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
  });

  it("reads nothing from an Open: label followed by a label line", () => {
    expect(weeklyGridOpenRule("Open:\nMusic:\nReggaeton", "en")).toBeNull();
  });
});

describe("a Mandala club's read keeps the Open line's nights and hours", () => {
  it("La Vaquita: the model's 'From Thursday to Sunday' and the Open line's 20:30-03:00 are kept", () => {
    const result = read(
      VAQUITA,
      "https://mandalatickets.com/en/playa/disco/la-vaquita",
      "La Vaquita Playa del Carmen",
      {
        title: "LA VAQUITA",
        local_date: "2026-11-08",
        recurrence_text: "From Thursday to Sunday",
        doors_time: "20:30",
        end_time: "03:00",
      },
    );
    const row = result.listings[0];
    expect(row).toBeDefined();
    expect(row?.recurrence?.rrule ?? "").toContain("BYDAY=TH,FR,SA,SU");
    expect(startOf(row)).toBe("20:30");
    expect(row?.listing.end_time).toBe("03:00");
  });

  it("Bonbonniere: a dated Sunday with 'From Thursday to Saturday' is listed weekly Thu-Sat at 22:00, not rejected", () => {
    const result = read(
      BONBONNIERE,
      "https://mandalatickets.com/en/tulum/disco/bonbonniere",
      "Bonbonniere Tulum",
      {
        title: "Bonbonniere Tulum",
        local_date: "2026-11-08",
        recurrence_text: "From Thursday to Saturday",
        doors_time: "22:00",
      },
    );
    const row = result.listings[0];
    expect(row).toBeDefined();
    expect(row?.recurrence?.rrule ?? "").toContain("BYDAY=TH,FR,SA");
    expect(startOf(row)).toBe("22:00");
  });

  it("La Vaquita read with no rule and no date takes the Open line's nights and hours", () => {
    const result = read(
      VAQUITA,
      "https://mandalatickets.com/en/playa/disco/la-vaquita",
      "La Vaquita Playa del Carmen",
      {
        title: "LA VAQUITA",
        doors_time: "20:30",
        end_time: "03:00",
      },
    );
    const row = result.listings[0];
    expect(row?.recurrence?.rrule ?? "").toContain("BYDAY=TH,FR,SA,SU");
    expect(startOf(row)).toBe("20:30");
  });

  it("an Open line whose nights differ from the model's rule does not vouch for the model's times", () => {
    const result = read(
      VAQUITA,
      "https://mandalatickets.com/en/playa/disco/la-vaquita",
      "La Vaquita Playa del Carmen",
      {
        title: "LA VAQUITA",
        recurrence_text: "every Monday",
        doors_time: "21:00",
      },
    );
    const row = result.listings[0];
    expect(startOf(row)).not.toBe("21:00");
  });

  it("Vagalume: an Open line with a day range and a night range never vouches for the beach club's hours", () => {
    for (const times of [
      { doors_time: "19:00", end_time: "01:00" },
      { doors_time: "11:00", end_time: "18:00" },
    ]) {
      const result = read(
        VAGALUME,
        "https://mandalatickets.com/en/tulum/disco/Vagalume",
        "Vagalume Tulum",
        {
          title: "Vagalume",
          recurrence_text: "from Thursday to Sunday",
          ...times,
        },
      );
      const row = result.listings[0];
      expect(row?.recurrence?.rrule ?? "").toContain("BYDAY=TH,FR,SA,SU");
      expect([null, "19:00"]).toContain(startOf(row));
      expect([null, "01:00"]).toContain(row?.listing.end_time ?? null);
    }
  });
});
