import { describe, it, expect, vi } from "vitest";
import type { HarvestedListing } from "@/src/adapters/types";
import type { HttpClient } from "@/src/pipeline/http";
import {
  localStart,
  eventStartDates,
  timesFromEventPages,
  EVENT_PAGE_TIMES_PER_SOURCE,
} from "@/src/pipeline/event-page-times";

describe("localStart", () => {
  it("converts UTC to local date/time", () => {
    const result = localStart("2026-12-13T02:30:00Z", "America/New_York");
    expect(result).toEqual({ date: "2026-12-12", time: "21:30" });
  });

  it("handles offset date-time", () => {
    const result = localStart("2026-12-12T21:30:00-05:00", "America/New_York");
    expect(result).toEqual({ date: "2026-12-12", time: "21:30" });
  });

  it("handles date-time without zone", () => {
    const result = localStart("2026-11-06T22:00", "America/New_York");
    expect(result).toEqual({ date: "2026-11-06", time: "22:00" });
  });

  it("returns null for date only", () => {
    expect(localStart("2026-11-06", "America/New_York")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(localStart("soon", "America/New_York")).toBeNull();
  });

  it("returns null for midnight time", () => {
    // This test depends on timezone conversion
    // We'll test with a known case that would produce 00:00
    const result = localStart("2026-01-01T00:00:00Z", "UTC");
    expect(result).toBeNull();
  });
});

describe("eventStartDates", () => {
  const BELTRAN = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","url":"https://theavelive.com/events/beltran","name":"BELTRAN","startDate":"2026-12-13T02:30:00Z","endDate":"2026-12-13T07:00:00Z","location":{"@type":"MusicVenue","name":"The Ave Live"}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script>
</head><body></body></html>`;

  it("extracts startDate from Event JSON-LD", () => {
    const dates = eventStartDates(BELTRAN);
    expect(dates).toEqual(["2026-12-13T02:30:00Z"]);
  });

  it("handles empty HTML", () => {
    expect(eventStartDates("")).toEqual([]);
  });

  it("ignores invalid JSON", () => {
    const html = `<script type="application/ld+json">invalid</script>`;
    expect(eventStartDates(html)).toEqual([]);
  });
});

describe("timesFromEventPages", () => {
  const BELTRAN_HTML = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MusicEvent","startDate":"2026-12-13T02:30:00Z"}</script>
</head></html>`;

  const createListing = (overrides: Partial<HarvestedListing> = {}): HarvestedListing => {
    const base = {
      listing: {
        title: "BELTRAN",
        local_date: "2026-12-12",
        doors_time: null,
        lesson_time: null,
        dancing_time: null,
        end_time: null,
        evidence: {},
        confidence: {},
      },
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: "https://theavelive.com/events",
        fetchedAt: new Date(),
        method: "llm",
      },
      eventUrl: "https://theavelive.com/events/beltran",
      timesWithdrawn: { pageStarts: [], pageEnds: [] },
    };
    return { ...base, ...overrides } as unknown as HarvestedListing;
  };

  it("adds dancing_time from event page", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: BELTRAN_HTML,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing();
    const result = await timesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
    });

    expect(result.listings[0]!.listing.dancing_time).toBe("21:30");
    expect(result.listings[0]!.listing.evidence.dancing_time).toBe(
      "startDate 2026-12-13T02:30:00Z",
    );
    expect(result.listings[0]?.timesWithdrawn).toBeUndefined();
    expect(result.notes).toContain("1 listing(s) timed from their own event page");
  });

  it("leaves listing unchanged when date doesn't match", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: BELTRAN_HTML,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing({
      listing: { ...createListing().listing, local_date: "2026-12-13" },
    });
    const result = await timesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
    });

    expect(result.listings[0]!.listing.dancing_time).toBeNull();
    expect(result.notes).toHaveLength(0);
  });

  it("skips listing with existing dancing_time", async () => {
    const mockHttp = {
      request: vi.fn(),
      robots: vi.fn(),
    };

    const listing = createListing({
      listing: { ...createListing().listing, dancing_time: "22:00" },
    });
    const result = await timesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
    });

    expect(result.listings[0]!.listing.dancing_time).toBe("22:00");
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it("skips eventUrl on another site", async () => {
    const mockHttp = {
      request: vi.fn(),
      robots: vi.fn(),
    };

    const listing = createListing({ eventUrl: "https://dice.fm/event/x" });
    const result = await timesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
    });

    expect(result.listings[0]!.listing.dancing_time).toBeNull();
    expect(mockHttp.request).not.toHaveBeenCalled();
  });

  it("handles request error", async () => {
    const mockHttp = {
      request: vi.fn(async () => {
        throw new Error("403");
      }),
      robots: vi.fn(),
    };

    const listing = createListing();
    const result = await timesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
    });

    expect(result.listings[0]!.listing.dancing_time).toBeNull();
    expect(result.notes).toContain(
      "https://theavelive.com/events/beltran: event page not read (403)",
    );
  });

  it("respects limit", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: BELTRAN_HTML,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listings = [
      createListing({ eventUrl: "https://theavelive.com/events/1" }),
      createListing({ eventUrl: "https://theavelive.com/events/2" }),
    ];

    const result = await timesFromEventPages(listings, {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
      limit: 1,
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(1);
    expect(result.notes).toContain("1 event page(s) not read (limit 1 a source)");
  });

  it("uses default limit", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: BELTRAN_HTML,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    // Create more listings than the default limit
    const listings = Array.from({ length: EVENT_PAGE_TIMES_PER_SOURCE + 2 }, (_, i) =>
      createListing({ eventUrl: `https://theavelive.com/events/${i}` }),
    );

    const result = await timesFromEventPages(listings, {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(EVENT_PAGE_TIMES_PER_SOURCE);
    expect(result.notes).toContain(
      `${listings.length - EVENT_PAGE_TIMES_PER_SOURCE} event page(s) not read (limit ${EVENT_PAGE_TIMES_PER_SOURCE} a source)`,
    );
  });

  it("respects custom limit when provided", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: BELTRAN_HTML,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    // Create 10 candidate listings with a date that won't match the HTML startDate
    const baseListing = createListing().listing;
    const listings = Array.from({ length: 10 }, (_, i) =>
      createListing({
        eventUrl: `https://theavelive.com/events/${i}`,
        listing: { ...baseListing, local_date: "2026-12-13" },
      }),
    );

    const result = await timesFromEventPages(listings, {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
      limit: 10,
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(10);
    expect(result.notes).toHaveLength(0); // all pages read, no note about exceeding limit or timed listings
  });

  it("falls back to default limit when limit is undefined", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: BELTRAN_HTML,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    // Create more listings than the default limit
    const listings = Array.from({ length: EVENT_PAGE_TIMES_PER_SOURCE + 2 }, (_, i) =>
      createListing({ eventUrl: `https://theavelive.com/events/${i}` }),
    );

    const result = await timesFromEventPages(listings, {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
      limit: undefined,
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(EVENT_PAGE_TIMES_PER_SOURCE);
    expect(result.notes).toContain(
      `${listings.length - EVENT_PAGE_TIMES_PER_SOURCE} event page(s) not read (limit ${EVENT_PAGE_TIMES_PER_SOURCE} a source)`,
    );
  });

  it("shares eventUrl across multiple listings", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: BELTRAN_HTML,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing1 = createListing({ eventUrl: "https://theavelive.com/events/beltran" });
    const listing2 = createListing({ eventUrl: "https://theavelive.com/events/beltran" });

    const result = await timesFromEventPages([listing1, listing2], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://theavelive.com/events",
      tz: "America/New_York",
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(1);
    expect(result.listings[0]!.listing.dancing_time).toBe("21:30");
    expect(result.listings[1]!.listing.dancing_time).toBe("21:30");
    expect(result.notes).toContain("2 listing(s) timed from their own event page");
  });
});
