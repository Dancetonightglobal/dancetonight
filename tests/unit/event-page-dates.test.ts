import { describe, it, expect, vi } from "vitest";
import type { HarvestedListing } from "@/src/adapters/types";
import type { HttpClient } from "@/src/pipeline/http";
import { localDateAndTime, datesFromEventPages } from "@/src/pipeline/event-page-dates";

describe("localDateAndTime", () => {
  it("returns date only for YYYY-MM-DD", () => {
    const result = localDateAndTime("2026-11-03", "Europe/London");
    expect(result).toEqual({ date: "2026-11-03", time: null });
  });

  it("returns date only for midnight T00:00 no zone", () => {
    const result = localDateAndTime("2026-11-03T00:00:00", "Europe/London");
    expect(result).toEqual({ date: "2026-11-03", time: null });
  });

  it("returns date and literal time for T19:30 no zone", () => {
    const result = localDateAndTime("2026-11-03T19:30:00", "Europe/London");
    expect(result).toEqual({ date: "2026-11-03", time: "19:30" });
  });

  it("converts Z to local time", () => {
    // 2026-11-03T19:30:00Z in Europe/London (no DST) is 19:30 same date
    const result = localDateAndTime("2026-11-03T19:30:00Z", "Europe/London");
    expect(result).toEqual({ date: "2026-11-03", time: "19:30" });
  });

  it("returns null for unparsable", () => {
    expect(localDateAndTime("soon", "Europe/London")).toBeNull();
  });
});

describe("datesFromEventPages", () => {
  const createListing = (overrides: Partial<HarvestedListing> = {}): HarvestedListing => {
    const base = {
      listing: {
        title: "Bachata Tuesdays",
        local_date: null,
        doors_time: null,
        lesson_time: null,
        dancing_time: null,
        end_time: null,
        recurrence_text: null,
        evidence: {},
        confidence: {},
      },
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: {
        sourceUrl: "https://www.tickettailor.com/events/ritmolatinodance",
        fetchedAt: new Date(),
        method: "llm",
      },
      eventUrl: null,
      timesWithdrawn: { pageStarts: [], pageEnds: [] },
    };
    return { ...base, ...overrides } as unknown as HarvestedListing;
  };

  const HTML_WITH_DATES = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","startDate":"2026-11-03T00:00:00"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","startDate":"2026-11-10T00:00:00"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","startDate":"2026-11-14T00:00:00"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","startDate":"2026-11-24T00:00:00"}</script>
</head></html>`;

  const nights = [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
  ];

  it("creates one night per JSON-LD date inside window", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: HTML_WITH_DATES,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing({
      eventUrl: "https://www.tickettailor.com/events/ritmolatinodance/123",
      listing: {
        ...createListing().listing,
        dancing_time: "20:00",
      },
    });

    const result = await datesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText: "",
      tz: "Europe/London",
      nights,
    });

    expect(result.listings).toHaveLength(3);
    expect(result.listings[0]!.listing.local_date).toBe("2026-11-03");
    expect(result.listings[0]!.listing.dancing_time).toBe("20:00");
    expect(result.listings[0]!.listing.recurrence_text).toBeNull();
    expect(result.listings[0]!.eventUrl).toBe(
      "https://www.tickettailor.com/events/ritmolatinodance/123",
    );
    expect(result.notes).toContain("3 night(s) taken from 1 event page(s)' list of dates");
  });

  it("handles T00:00 page with untimed model", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: HTML_WITH_DATES,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing({
      eventUrl: "https://www.tickettailor.com/events/ritmolatinodance/123",
      listing: {
        ...createListing().listing,
        dancing_time: null,
      },
    });

    const result = await datesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText: "",
      tz: "Europe/London",
      nights,
    });

    expect(result.listings).toHaveLength(3);
    expect(result.listings[0]!.listing.dancing_time).toBeNull();
  });

  it("uses title-matched card link when no eventUrl", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: HTML_WITH_DATES,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const pageText = `Bachata Tuesdays Multiple dates and times [https://www.tickettailor.com/events/ritmolatinodance/123]`;
    const listing = createListing({
      eventUrl: null,
      listing: { ...createListing().listing, dancing_time: "20:00" },
    });

    const result = await datesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText,
      tz: "Europe/London",
      nights,
    });

    expect(mockHttp.request).toHaveBeenCalledWith({
      url: "https://www.tickettailor.com/events/ritmolatinodance/123",
      purpose: "crawl",
      headers: { accept: "text/html" },
    });
    expect(result.listings).toHaveLength(3);
  });

  it("skips candidate if two matching links", async () => {
    const mockHttp = {
      request: vi.fn(),
      robots: vi.fn(),
    };

    const pageText = `Bachata Tuesdays [https://www.tickettailor.com/events/ritmolatinodance/123]
Bachata Tuesdays [https://www.tickettailor.com/events/ritmolatinodance/456]`;
    const listing = createListing({
      eventUrl: null,
      listing: { ...createListing().listing },
    });

    const result = await datesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText,
      tz: "Europe/London",
      nights,
    });

    expect(mockHttp.request).not.toHaveBeenCalled();
    expect(result.listings).toHaveLength(1); // unchanged
  });

  it("leaves listing unchanged when no dates in window", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: `<html><head><script type="application/ld+json">{"@type":"Event","startDate":"2026-12-01T00:00:00"}</script></head></html>`,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing({
      eventUrl: "https://www.tickettailor.com/events/ritmolatinodance/123",
      listing: { ...createListing().listing },
    });

    const result = await datesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText: "",
      tz: "Europe/London",
      nights,
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(1);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.listing.local_date).toBeNull();
  });

  it("respects limit", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: HTML_WITH_DATES,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listings = [
      createListing({ eventUrl: "https://www.tickettailor.com/events/1" }),
      createListing({ eventUrl: "https://www.tickettailor.com/events/2" }),
      createListing({ eventUrl: "https://www.tickettailor.com/events/3" }),
    ];

    const result = await datesFromEventPages(listings, {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText: "",
      tz: "Europe/London",
      nights,
      limit: 2,
    });

    expect(mockHttp.request).toHaveBeenCalledTimes(2);
    expect(result.notes).toContain("1 event page(s) not read for dates (limit 2 a source)");
  });

  it("keeps listing_type on copies", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: HTML_WITH_DATES,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing({
      eventUrl: "https://www.tickettailor.com/events/ritmolatinodance/123",
      listing: {
        ...createListing().listing,
        listing_type: "class",
      },
    });

    const result = await datesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText: "",
      tz: "Europe/London",
      nights,
    });

    expect(result.listings).toHaveLength(3);
    expect(result.listings[0]!.listing.listing_type).toBe("class");
  });

  // New tests for review round 1 fixes
  it("two undated candidates with a dated listing between them", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => {
        if (url.includes("ritmolatinodance/123")) {
          return {
            url,
            status: 200,
            headers: {},
            body: `<html><head>
<script type="application/ld+json">{"@type":"Event","startDate":"2026-11-03T00:00:00"}</script>
<script type="application/ld+json">{"@type":"Event","startDate":"2026-11-10T00:00:00"}</script>
</head></html>`,
            fetchedAt: new Date(),
          };
        }
        if (url.includes("ritmolatinodance/456")) {
          return {
            url,
            status: 200,
            headers: {},
            body: `<html><head>
<script type="application/ld+json">{"@type":"Event","startDate":"2026-11-05T00:00:00"}</script>
<script type="application/ld+json">{"@type":"Event","startDate":"2026-11-12T00:00:00"}</script>
</head></html>`,
            fetchedAt: new Date(),
          };
        }
        throw new Error("unexpected url");
      }),
      robots: vi.fn(),
    };

    const listing1 = createListing({
      eventUrl: "https://www.tickettailor.com/events/ritmolatinodance/123",
      listing: { ...createListing().listing, title: "Bachata Tuesdays" },
    });
    const listing2 = createListing({
      listing: { ...createListing().listing, title: "Halloween Social", local_date: "2026-11-07" },
    });
    const listing3 = createListing({
      eventUrl: "https://www.tickettailor.com/events/ritmolatinodance/456",
      listing: { ...createListing().listing, title: "Island Thursdays" },
    });

    const result = await datesFromEventPages([listing1, listing2, listing3], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText: "",
      tz: "Europe/London",
      nights,
    });

    expect(result.listings).toHaveLength(5);
    expect(result.listings.map((l) => l.listing.title)).toEqual([
      "Bachata Tuesdays",
      "Bachata Tuesdays",
      "Halloween Social",
      "Island Thursdays",
      "Island Thursdays",
    ]);
    expect(result.listings.map((l) => l.listing.local_date)).toEqual([
      "2026-11-03",
      "2026-11-10",
      "2026-11-07",
      "2026-11-05",
      "2026-11-12",
    ]);
    expect(result.notes).toContain("4 night(s) taken from 2 event page(s)' list of dates");
  });

  it("weekly-rule candidate with own date not skipped", async () => {
    const mockHttp = {
      request: vi.fn(async ({ url }: { url: string }) => ({
        url,
        status: 200,
        headers: {},
        body: `<html><head>
<script type="application/ld+json">{"@type":"Event","startDate":"2026-11-03T00:00:00"}</script>
<script type="application/ld+json">{"@type":"Event","startDate":"2026-11-10T00:00:00"}</script>
</head></html>`,
        fetchedAt: new Date(),
      })),
      robots: vi.fn(),
    };

    const listing = createListing({
      eventUrl: "https://www.tickettailor.com/events/ritmolatinodance/123",
      listing: {
        ...createListing().listing,
        local_date: "2026-11-03",
        recurrence_text: "every Tuesday",
      },
    });

    const result = await datesFromEventPages([listing], {
      http: mockHttp as unknown as HttpClient,
      pageUrl: "https://www.tickettailor.com/events/ritmolatinodance",
      pageText: "",
      tz: "Europe/London",
      nights,
    });

    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]!.listing.local_date).toBe("2026-11-03");
    expect(result.listings[1]!.listing.local_date).toBe("2026-11-10");
    expect(result.listings[0]!.listing.recurrence_text).toBeNull();
    expect(result.listings[1]!.listing.recurrence_text).toBeNull();
  });
});
