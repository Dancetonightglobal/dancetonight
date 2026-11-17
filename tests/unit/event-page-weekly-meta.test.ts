import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { weeklyFromDescription } from "@/src/adapters/feeds/event-pages";
import type { HarvestedListing } from "@/src/adapters/types";

describe("weeklyFromDescription", () => {
  const baseHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="description" content="Salsa en Vivo at San Luis Club is an old-school, late-night live-music salsa dance... Every Monday, Tuesday, Wednesday, Thursday, Friday &amp; Saturday. Venue: San Luis Club" />
      <meta property="og:description" content="Salsa en Vivo at San Luis Club is an old-school, late-night live-music salsa dance... Every Monday, Tuesday, Wednesday, Thursday, Friday &amp; Saturday. Venue: San Luis Club" />
    </head>
    <body></body>
    </html>
  `;

  const makeListing = (localDate: string, dancingTime?: string): HarvestedListing => {
    const raw = rawListingSchema.parse({
      title: "Salsa en Vivo at San Luis Club",
      listing_type: "social",
      styles: ["salsa"],
      local_date: localDate,
      doors_time: null,
      dancing_time: dancingTime ?? null,
      lesson_time: null,
      venue: { name: "San Luis Club", address: "Roma Norte, CDMX 06700", url: null },
      organizer: { name: null, url: null },
    });
    return {
      listing: raw,
      externalId: "t:1",
      tz: "America/Mexico_City",
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: "https://www.salsavida.com/x",
        fetchedAt: new Date(),
        method: "jsonld" as const,
      },
    };
  };

  it("creates weekly recurrence for Thursday with time", () => {
    const listing = makeListing("2026-10-29", "20:00");
    const result = weeklyFromDescription(baseHtml, listing);
    expect(result.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA",
      dtstartLocal: "2026-10-29T20:00",
      exdates: [],
    });
    expect(result.listing.recurrence_text).toBe(
      "Every Monday, Tuesday, Wednesday, Thursday, Friday & Saturday",
    );
  });

  it("creates weekly recurrence with untimed anchor when no times", () => {
    const listing = makeListing("2026-10-29");
    const result = weeklyFromDescription(baseHtml, listing);
    expect(result.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA",
      dtstartLocal: "2026-10-29T12:00",
      exdates: [],
      timeListed: false,
    });
  });

  it("returns unchanged when date weekday not in description", () => {
    const listing = makeListing("2026-11-01", "20:00"); // Sunday
    const result = weeklyFromDescription(baseHtml, listing);
    expect(result.recurrence).toBeNull();
    expect(result).toBe(listing);
  });

  it("returns unchanged for 'Every 2nd Friday'", () => {
    const html = `<meta name="description" content="A night out. Every 2nd Friday. Venue: X" />`;
    const listing = makeListing("2026-10-29", "20:00");
    const result = weeklyFromDescription(html, listing);
    expect(result.recurrence).toBeNull();
  });

  it("works with only og:description", () => {
    const html = `<meta property="og:description" content="Every Thursday. Venue: Y" />`;
    const listing = makeListing("2026-10-29", "20:00");
    const result = weeklyFromDescription(html, listing);
    expect(result.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=TH",
      dtstartLocal: "2026-10-29T20:00",
      exdates: [],
    });
  });

  it("returns unchanged when recurrence already exists", () => {
    const listing = makeListing("2026-10-29", "20:00");
    listing.recurrence = {
      rrule: "FREQ=WEEKLY;BYDAY=TH",
      dtstartLocal: "2026-10-29T20:00",
      exdates: [],
    };
    const result = weeklyFromDescription(baseHtml, listing);
    expect(result.recurrence).toBe(listing.recurrence);
    expect(result).toBe(listing);
  });
});
