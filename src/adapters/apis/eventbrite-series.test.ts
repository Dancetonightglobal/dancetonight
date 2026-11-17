import { describe, expect, it } from "vitest";

import {
  eventbriteAdapter,
  eventbriteSeriesUrl,
  EVENTBRITE_MAX_SERIES,
} from "@/src/adapters/apis/eventbrite";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp } from "@/src/pipeline/http";

const NOW = new Date("2026-10-29T15:00:00Z");
const METRO: Metro = {
  id: "pr",
  slug: "san-juan",
  name: "San Juan",
  countryCode: "PR",
  center: { lat: 18.45, lng: -66.07 },
  radiusKm: 50,
  tz: "America/Puerto_Rico",
  languages: ["en"],
};
const SOURCE: Source = {
  id: "s",
  url: "https://www.eventbrite.com/o/veronica-cint-ajay-omowale-63004394003",
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  feedUrl: null,
  metroId: "pr",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

const ebEvent = (id: string, name: string, local: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: { text: name, html: name },
  description: { text: "Bachata workshop at 8pm then social dancing from 9pm." },
  url: `https://www.eventbrite.com/e/${id}`,
  start: { timezone: "America/Puerto_Rico", local },
  end: { timezone: "America/Puerto_Rico", local: local.replace(/T\d{2}/, "T23") },
  status: "live",
  online_event: false,
  venue: {
    name: "La Placita",
    address: {
      address_1: "Calle Dos Hermanos",
      city: "San Juan",
      region: "PR",
      postal_code: "00907",
      latitude: "18.45",
      longitude: "-66.07",
      localized_address_display: "Calle Dos Hermanos, San Juan, PR 00907",
    },
  },
  organizer: { id: "63004394003", name: "Veronica Cint & Ajay Omowale" },
  ticket_availability: {
    is_free: false,
    minimum_ticket_price: { currency: "USD", major_value: "20.00", value: 2000 },
    maximum_ticket_price: { currency: "USD", major_value: "20.00", value: 2000 },
  },
  ...extra,
});

describe("Eventbrite series", () => {
  it("reads children of a series parent and lists the child in window", async () => {
    const parent = {
      ...ebEvent("700000000001", "Da Sunday Cookout", "2023-05-07T13:00:00"),
      is_series: true,
      is_series_parent: true,
    };
    const child = {
      ...ebEvent("700000000002", "Da Sunday Cookout", "2026-11-01T13:00:00"),
      is_series_parent: false,
    };
    const childPast = {
      ...ebEvent("700000000003", "Da Sunday Cookout", "2023-05-14T13:00:00"),
      is_series_parent: false,
    };
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: METRO,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          // Organizer endpoint returns parent.
          if (req.url.includes("/organizers/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [parent],
                pagination: { has_more_items: false },
              }),
            };
          }
          // Series endpoint returns children.
          if (req.url.includes("/series/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [child, childPast],
                pagination: { has_more_items: false },
              }),
            };
          }
          throw new Error(`unexpected request: ${req.url}`);
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    expect(result.notes).toContain("series 700000000001: 2 dated event(s) read");
    // Parent is out of window, childPast is past, only child in window.
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.externalId).toBe("eb:700000000002");
    expect(result.listings[0]?.listing.title).toBe("Da Sunday Cookout");
  });

  it("retries series endpoint with plain URL on 400", async () => {
    const parent = {
      ...ebEvent("700000000004", "Test Series", "2023-01-01T12:00:00"),
      is_series: true,
      is_series_parent: true,
    };
    // Child date within the window (14 days from 2026-10-29)
    const child = {
      ...ebEvent("700000000005", "Test Series", "2026-11-05T12:00:00"),
      is_series_parent: false,
    };
    let callCount = 0;
    let t = NOW.getTime();
    const { HttpError } = await import("@/src/pipeline/http");
    const ctx: RunCtx = {
      metro: METRO,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          if (req.url.includes("/organizers/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [parent],
                pagination: { has_more_items: false },
              }),
            };
          }
          if (req.url.includes("/series/")) {
            callCount++;
            if (callCount === 1) {
              // First call returns 400.
              throw new HttpError("http_status", req.url, "400", 400);
            }
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [child],
                pagination: { has_more_items: false },
              }),
            };
          }
          throw new Error(`unexpected request: ${req.url}`);
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    expect(result.notes).toContain("series 700000000004: 1 dated event(s) read");
    expect(result.listings).toHaveLength(1);
  });

  it("keeps parent when series endpoint fails", async () => {
    const parent = {
      ...ebEvent("700000000006", "Failing Series", "2023-01-01T12:00:00"),
      is_series: true,
      is_series_parent: true,
    };
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: METRO,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          if (req.url.includes("/organizers/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [parent],
                pagination: { has_more_items: false },
              }),
            };
          }
          if (req.url.includes("/series/")) {
            throw new Error("Internal Server Error");
          }
          throw new Error(`unexpected request: ${req.url}`);
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    expect(result.notes).toContain(
      "series 700000000006: children not read (Internal Server Error)",
    );
    // Parent is out of window, so no listings.
    expect(result.listings).toHaveLength(0);
  });

  it("respects limit of series read per run", async () => {
    const parents = Array.from({ length: EVENTBRITE_MAX_SERIES + 2 }, (_, i) => ({
      ...ebEvent(`7000000${1000 + i}`, `Series ${i}`, "2023-01-01T12:00:00"),
      is_series: true,
      is_series_parent: true,
    }));
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: METRO,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          if (req.url.includes("/organizers/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: parents,
                pagination: { has_more_items: false },
              }),
            };
          }
          if (req.url.includes("/series/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [],
                pagination: { has_more_items: false },
              }),
            };
          }
          throw new Error(`unexpected request: ${req.url}`);
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    expect(result.notes).toContain(`2 series not read (limit ${EVENTBRITE_MAX_SERIES} a run)`);
  });

  it("series URL helper builds correct query parameters", () => {
    // URLSearchParams encodes commas as %2C, so we need to compare normalized strings.
    const url1 = new URL(eventbriteSeriesUrl("12345"));
    url1.searchParams.sort();
    expect(url1.toString()).toBe(
      "https://www.eventbriteapi.com/v3/series/12345/events/?expand=venue%2Cticket_availability%2Corganizer&order_by=start_asc&time_filter=current_future",
    );
    const url2 = new URL(eventbriteSeriesUrl("12345", "cont"));
    url2.searchParams.sort();
    expect(url2.toString()).toBe(
      "https://www.eventbriteapi.com/v3/series/12345/events/?continuation=cont&expand=venue%2Cticket_availability%2Corganizer&order_by=start_asc&time_filter=current_future",
    );
    const url3 = new URL(eventbriteSeriesUrl("12345", undefined, true));
    url3.searchParams.sort();
    expect(url3.toString()).toBe(
      "https://www.eventbriteapi.com/v3/series/12345/events/?expand=venue%2Cticket_availability%2Corganizer",
    );
  });
});
