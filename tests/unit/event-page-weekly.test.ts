import { rawListingSchema } from "@/src/domain/listing";
import { describe, it, expect, vi } from "vitest";
import type { HarvestedListing } from "@/src/adapters/types";
import type { HttpClient } from "@/src/pipeline/http";
import {
  weeklyRuleFromEventPage,
  weeklyFromEventPages,
  weeklyRuleFromCalendarLink,
} from "@/src/pipeline/event-page-weekly";

describe("weeklyRuleFromEventPage", () => {
  it("returns FR for Taberna Los Vázquez example", () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Every Friday there's live salsa music and dancing at Taberna Los Vzquez.">
        </head>
        <body>
          <div>Party · Social Salsa Recurring</div>
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(
      html,
      "2026-10-30",
      "Salsa Dancing Fridays At Taberna Los VáZquez",
    );
    expect(result).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("returns FR for InterContinental example", () => {
    const html = `
      <html>
        <body>
          <div>Recurring</div>
          <script type="application/ld+json">
            {"description":"Salsa Nights are back! Join us every Friday, admission is free"}
          </script>
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(
      html,
      "2026-10-30",
      "Salsa Night Fridays @ Intercontinental San Juan",
    );
    expect(result).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("returns FR for Red Coral Lounge (weekday only in title)", () => {
    const html = `
      <html>
        <body>
          <div>Recurring</div>
          <meta name="description" content="Live dance music begins at 8:00pm.">
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(
      html,
      "2026-10-30",
      "Live Dance Music Fridays @ Red Coral Lounge",
    );
    expect(result).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("returns null on weekday mismatch", () => {
    const html = `
      <html>
        <body>
          <div>Recurring</div>
          <meta name="description" content="Every Friday there's live salsa.">
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(html, "2026-10-31", "Salsa Dancing Fridays");
    expect(result).toBeNull();
  });

  it("returns null when no 'Recurring' present", () => {
    const html = `
      <html>
        <body>
          <div>Not Recurring</div>
          <meta name="description" content="Every Friday there's live salsa.">
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(html, "2026-10-30", "Salsa Dancing Fridays");
    expect(result).toBeNull();
  });

  it("returns null when no weekday phrase found", () => {
    const html = `
      <html>
        <body>
          <div>Recurring</div>
          <meta name="description" content="Salsa music and dancing.">
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(html, "2026-10-30", "Salsa 1 @ Your Style Academy");
    expect(result).toBeNull();
  });

  it("returns TH for Spanish 'todos los jueves'", () => {
    const html = `
      <html>
        <body>
          <div>Recurring</div>
          <meta name="description" content="Te esperamos todos los jueves con la mejor salsa">
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(html, "2026-11-05", "Noche de Salsa");
    expect(result).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("returns WE for Spanish 'cada miércoles'", () => {
    const html = `
      <html>
        <body>
          <div>Recurring</div>
          <meta name="description" content="Ven cada miércoles">
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(html, "2026-11-04", "Noche de Salsa");
    expect(result).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("returns null for two weekdays", () => {
    const html = `
      <html>
        <body>
          <div>Recurring</div>
          <meta name="description" content="Thursdays and Fridays">
        </body>
      </html>
    `;
    const result = weeklyRuleFromEventPage(html, "2026-11-05", "Salsa Nights");
    expect(result).toBeNull();
  });
});

describe("weeklyRuleFromCalendarLink", () => {
  it("returns FR for plain WEEKLY on a Friday", () => {
    const html = `<a href="https://calendar.google.com/calendar/render?action=TEMPLATE&recur=RRULE%3AFREQ%3DWEEKLY">Add to Google Calendar</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-11-06")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("handles &amp;recur= form", () => {
    const html = `<a href="https://calendar.google.com/calendar/render?action=TEMPLATE&amp;recur=RRULE%3AFREQ%3DWEEKLY">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-11-06")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("returns TH,SA for BYDAY TH,SA on Thursday start", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BBYDAY%3DTH%2CSA">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBe("FREQ=WEEKLY;BYDAY=TH,SA");
  });

  it("returns null for BYDAY TH,SA on Friday start", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BBYDAY%3DTH%2CSA">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-30")).toBeNull();
  });

  it("returns null for DAILY", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DDAILY">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null for COUNT", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BCOUNT%3D4">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null for INTERVAL=2", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BINTERVAL%3D2">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null for BYDAY=1FR", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BBYDAY%3D1FR">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null for bad encoding", () => {
    const html = `<a href="?recur=%E0%A4%A">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null when no recur parameter", () => {
    const html = `<a href="?action=TEMPLATE">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null for BYSETPOS", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BBYSETPOS%3D1%3BBYDAY%3DFR">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null for BYMONTHDAY", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BBYMONTHDAY%3D6">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("returns null for BYDAY=-1SA", () => {
    const html = `<a href="?recur=RRULE%3AFREQ%3DWEEKLY%3BBYDAY%3D-1SA">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-10-29")).toBeNull();
  });

  it("handles &amp;recur= inside href", () => {
    const html = `<a href="https://calendar.google.com/calendar/render?action=TEMPLATE&amp;text=X&amp;recur=RRULE%3AFREQ%3DWEEKLY">Add</a>`;
    expect(weeklyRuleFromCalendarLink(html, "2026-11-06")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });
});

describe("weeklyFromEventPages", () => {
  const createListing = (overrides: Partial<HarvestedListing> = {}): HarvestedListing => {
    const base: HarvestedListing = {
      listing: rawListingSchema.parse({
        title: "Salsa Dancing Fridays",
        listing_type: "social",
        styles: ["salsa"],
        local_date: "2026-10-30",
        dancing_time: "23:00",
        venue: { name: "Taberna Los Vazquez", address: null },
      }),
      externalId: "https://www.danceus.org/event/1/x/#2026-10-30T23:00:00-04:00",
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: "https://www.danceus.org/event/1/x/",
        fetchedAt: new Date(),
        method: "llm",
      },
      eventUrl: "https://www.danceus.org/event/1/x/",
      timesWithdrawn: { pageStarts: [], pageEnds: [] },
    };
    return { ...base, ...overrides } as unknown as HarvestedListing;
  };

  it("makes a listing weekly, strips # from externalId, nulls local_date", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: `
          <html>
            <body>
              <div>Recurring</div>
              <meta name="description" content="Every Friday there's live salsa.">
            </body>
          </html>
        `,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing();
    const result = await weeklyFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      limit: 30,
    });

    expect(result.listings).toHaveLength(1);
    const updated = result.listings[0]!;
    expect(updated.listing.local_date).toBeNull();
    expect(updated.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      dtstartLocal: "2026-10-30T23:00",
      exdates: [],
      timeListed: true,
    });
    expect(updated.externalId).toBe("https://www.danceus.org/event/1/x/");
    expect(result.notes).toContain(
      '1 listing(s) made weekly from their own page\'s "Recurring" and weekday: Salsa Dancing Fridays',
    );
  });

  it("leaves listing unchanged when no time", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: `
          <html>
            <body>
              <div>Recurring</div>
              <meta name="description" content="Every Friday there's live salsa.">
            </body>
          </html>
        `,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing({
      listing: {
        ...createListing().listing,
        dancing_time: null,
        doors_time: null,
        lesson_time: null,
      },
    });
    const result = await weeklyFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
    });

    expect(result.listings[0]!.listing.local_date).toBe("2026-10-30"); // unchanged
    expect(result.listings[0]!.recurrence).toBeNull();
  });

  it("skips already recurring listing", async () => {
    const mockHttp = { request: vi.fn(), robots: vi.fn() };
    const listing = createListing({
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=FR", dtstartLocal: "2026-10-30T23:00", exdates: [] },
    });
    const result = await weeklyFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
    });

    expect(mockHttp.request).not.toHaveBeenCalled();
    expect(result.listings[0]!.recurrence).toBeTruthy();
  });

  it("handles fetch error", async () => {
    const mockHttp = {
      request: vi.fn(async () => {
        throw new Error("Network error");
      }),
      robots: vi.fn(),
    };

    const listing = createListing();
    const result = await weeklyFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
    });

    expect(result.listings[0]!.listing.local_date).toBe("2026-10-30"); // unchanged
    expect(result.notes).toHaveLength(0);
  });

  it("respects limit", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: `
          <html>
            <body>
              <div>Recurring</div>
              <meta name="description" content="Every Friday there's live salsa.">
            </body>
          </html>
        `,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing1 = createListing({ eventUrl: "https://example.com/1" });
    const listing2 = createListing({ eventUrl: "https://example.com/2" });
    const result = await weeklyFromEventPages([listing1, listing2], {
      http: mockHttp as unknown as HttpClient,
      limit: 1,
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(1);
    expect(result.notes).toContain("1 event page(s) not read: limit 1");
    // Only first listing could have been updated
    const updatedCount = result.listings.filter((l) => l.listing.local_date === null).length;
    expect(updatedCount).toBe(1);
  });
});
