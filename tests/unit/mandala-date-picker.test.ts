import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

// D-809: Grupo Mandala's club pages end with a booking picker that prints today's date beside the club's name
// ("RAKATA - PLAYA DEL CARMEN / November 09, 2026 / Select your date"). On the 11-09 Tulum read the model dated
// Rakata and Santito Tun Tun on that Monday with "Friday and Saturday"; the picker's date counted as the page's,
// so the Open line's weekly rule was never tried and both were rejected ("dated 2026-11-09, a Monday, but the page
// says ...") and never listed.

const NOW = new Date("2026-11-09T15:00:00Z");
const TODAY = "2026-11-09";

const RAKATA = `RAKATA · playa, México
A high-energy nightlife destination designed for those seeking exclusivity, luxury and
unforgettable nights.
BOOK YOUR TICKETS AND VIP
RAKATA: Where PLAYA DEL CARMEN Night Comes Alive
Open: Friday and Saturday nights starting at 8:00 PM to 3:00 AM
Music: Reggaeton.
Dress code: Dress to impress!
How to get to RAKATA PLAYA DEL CARMEN?
Tickets & Packages
RAKATA - PLAYA DEL CARMEN
November 09, 2026
Select your date
November 09, 2026`;

const SANTITO = `SANTITO TUN TUN · playa, México
Open: Friday and Saturday from 8:30 p.m. to 3:00 a.m.
Music: Cumbia, salsa and reggaeton.
Tickets & Packages
SANTITO TUN TUN - PLAYA DEL CARMEN
November 09, 2026
Select your date
November 09, 2026`;

const startOf = (
  row: { listing: { doors_time?: string | null; dancing_time?: string | null } } | undefined,
) => row?.listing.doors_time ?? row?.listing.dancing_time ?? null;

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

describe("a club page's booking-picker date does not override its Open line (D-809)", () => {
  it("Rakata dated on the picker's Monday with 'Friday and Saturday' is listed weekly Fri-Sat at 20:00", () => {
    const result = read(
      RAKATA,
      "https://mandalatickets.com/en/playa/disco/rakata",
      "Rakata Playa del Carmen",
      {
        title: "RAKATA",
        local_date: "2026-11-09",
        recurrence_text: "Friday and Saturday",
        doors_time: "20:00",
        end_time: "03:00",
      },
    );
    const row = result.listings[0];
    expect(row).toBeDefined();
    expect(row?.recurrence?.rrule ?? "").toContain("BYDAY=FR,SA");
    expect(row?.listing.local_date ?? null).toBeNull();
    expect(startOf(row)).toBe("20:00");
    expect(result.rejected.map((r) => r.title)).not.toContain("RAKATA");
  });

  it("Santito Tun Tun: the same, with 'p.m.' hours", () => {
    const result = read(
      SANTITO,
      "https://mandalatickets.com/en/playa/disco/santito-tun-tun",
      "Santito Tun Tun",
      {
        title: "Santito Tun Tun",
        local_date: "2026-11-09",
        recurrence_text: "Friday and Saturday",
        doors_time: "20:30",
      },
    );
    const row = result.listings[0];
    expect(row?.recurrence?.rrule ?? "").toContain("BYDAY=FR,SA");
    expect(startOf(row)).toBe("20:30");
  });

  it("a dated night with no phrase stays a dated night", () => {
    const result = read(
      RAKATA,
      "https://mandalatickets.com/en/playa/disco/rakata",
      "Rakata Playa del Carmen",
      {
        title: "Halloween at Rakata",
        local_date: "2026-11-09",
        doors_time: "20:00",
      },
    );
    const row = result.listings[0];
    expect(row?.recurrence ?? null).toBeNull();
  });

  it("a phrase naming other nights than the Open line is not turned into the Open line's rule", () => {
    const result = read(
      RAKATA,
      "https://mandalatickets.com/en/playa/disco/rakata",
      "Rakata Playa del Carmen",
      {
        title: "RAKATA",
        local_date: "2026-11-09",
        recurrence_text: "Saturday",
        doors_time: "20:00",
      },
    );
    expect(
      result.listings.every((row) => !(row.recurrence?.rrule ?? "").includes("BYDAY=FR,SA")),
    ).toBe(true);
  });

  it("is off for a page that is not the club's own", () => {
    const raw = rawExtractionSchema.parse({
      page_kind: "single",
      language: "en",
      listings: [
        {
          listing_type: "club_night",
          styles: ["dj_night"],
          venue: {},
          organizer: {},
          title: "RAKATA",
          local_date: "2026-11-09",
          recurrence_text: "Friday and Saturday",
        },
      ],
    });
    const result = extractionToHarvested(raw, {
      pageUrl: "https://mandalatickets.com/en/playa/disco/rakata",
      fetchedAt: NOW,
      today: TODAY,
      pageText: RAKATA,
      countryCode: "MX",
      weeklyGrid: true,
    });
    expect(
      result.listings.every((row) => !(row.recurrence?.rrule ?? "").includes("BYDAY=FR,SA")),
    ).toBe(true);
  });
});
