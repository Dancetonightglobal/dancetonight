import { describe, expect, it } from "vitest";

import {
  eventbriteAdapter,
  eventbriteEventsUrl,
  eventbriteTarget,
  eventbriteToListings,
  soldOutToCheck,
  pageSaysCancelled,
} from "@/src/adapters/apis/eventbrite";
import { sha256 } from "@/src/adapters/shared";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";

// Built in the API v3 response shape (SOURCES 2.3); re-recorded on the first live run.
const NOW = new Date("2026-09-23T16:00:00Z");
const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};
const SOURCE: Source = {
  id: "s",
  url: "https://www.eventbrite.com/o/bachata-nyc-12345678901",
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  feedUrl: null,
  metroId: "m",
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
  start: { timezone: "America/New_York", local, utc: "ignored" },
  end: { timezone: "America/New_York", local: local.replace(/T\d{2}/, "T23") },
  status: "live",
  online_event: false,
  venue: {
    name: "Stepping Out Studios",
    address: {
      address_1: "37 W 26th St",
      city: "New York",
      region: "NY",
      postal_code: "10010",
      latitude: "40.7441",
      longitude: "-73.9899",
      localized_address_display: "37 W 26th St, New York, NY 10010",
    },
  },
  organizer: { name: "Bachata NYC", url: "https://www.eventbrite.com/o/bachata-nyc-12345678901" },
  ticket_availability: {
    is_free: false,
    minimum_ticket_price: { currency: "USD", major_value: "20.00", value: 2000 },
    maximum_ticket_price: { currency: "USD", major_value: "20.00", value: 2000 },
  },
  ...extra,
});

const PAGE_1 = {
  events: [
    ebEvent("1001", "Bachata Thursdays", "2026-09-24T20:00:00"),
    ebEvent("1002", "Online Bachata Styling", "2026-09-24T19:00:00", { online_event: true }),
  ],
  pagination: { has_more_items: true, continuation: "abc" },
};
const PAGE_2 = {
  events: [
    ebEvent("1003", "Bachata Saturday Social", "2026-09-26T21:00:00", { status: "canceled" }),
  ],
  pagination: { has_more_items: false },
};

describe("Eventbrite", () => {
  it("recognises organizer and venue addresses only", () => {
    expect(eventbriteTarget("https://www.eventbrite.com/o/bachata-nyc-12345678901")).toEqual({
      kind: "organizers",
      id: "12345678901",
    });
    expect(eventbriteTarget("https://www.eventbrite.co.uk/o/12345678901")).toEqual({
      kind: "organizers",
      id: "12345678901",
    });
    expect(eventbriteTarget("https://www.eventbrite.com/v/stepping-out-45678901")).toEqual({
      kind: "venues",
      id: "45678901",
    });
    expect(eventbriteTarget("https://www.eventbrite.com/e/some-event-1001")).toBeNull();
    expect(eventbriteTarget("https://example.org/o/123456")).toBeNull();
  });

  it("reads an organizer's events with the token in a header, following continuation", async () => {
    const seen: TransportRequest[] = [];
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: NYC,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          seen.push(req);
          const body = req.url.includes("continuation=abc") ? PAGE_2 : PAGE_1;
          return { url: req.url, status: 200, headers: {}, body: JSON.stringify(body) };
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    // The organizer endpoint rejects time_filter with a 400 (ingest run 9).
    expect(seen.every((r) => !r.url.includes("time_filter"))).toBe(true);
    expect(seen.map((r) => r.url)).toEqual([
      eventbriteEventsUrl({ kind: "organizers", id: "12345678901" }),
      eventbriteEventsUrl({ kind: "organizers", id: "12345678901" }, "abc"),
    ]);
    expect(
      seen.every(
        (r) => r.headers.authorization === "Bearer secret-token" && !r.url.includes("secret"),
      ),
    ).toBe(true);
    expect(result.notes).toEqual(["online only, skipped: Online Bachata Styling"]);

    const events = result.listings.map((l) => {
      const o = normalizeListing(l, { metro: NYC, source: SOURCE, now: NOW });
      if (!o.ok) throw new Error(o.reason);
      return o.event;
    });
    expect(events.map((e) => [e.title, e.nightDate, e.cancelled])).toEqual([
      ["Bachata Thursdays", "2026-09-24", false],
      ["Bachata Saturday Social", "2026-09-26", true],
    ]);
    expect(events[0]).toMatchObject({
      key: "eb:1001",
      styles: ["bachata"],
      listingType: "social",
      prices: [{ label: "Tickets", amount: 20, currency: "USD", includes: null }],
      organizer: { name: "Bachata NYC" },
      venue: {
        name: "Stepping Out Studios",
        address: "37 W 26th St, New York, NY 10010",
        location: { lat: 40.7441, lng: -73.9899 },
      },
    });
    expect(events[0]?.lessonAt?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(events[0]?.dancingAt?.toISOString()).toBe("2026-09-25T01:00:00.000Z");
  });

  it("labels a price range with its currency on both ends (D-071)", () => {
    const { listings } = eventbriteToListings(
      [
        ebEvent("3001", "Bachata Gala", "2026-09-25T20:00:00", {
          ticket_availability: {
            is_free: false,
            minimum_ticket_price: { currency: "USD", major_value: "15.00", value: 1500 },
            maximum_ticket_price: { currency: "USD", major_value: "27.50", value: 2750 },
          },
        }),
      ],
      { fetchedAt: NOW, metroTz: NYC.tz, fromNight: "2026-09-23", days: 14 },
    );
    expect(listings[0]?.listing.prices).toEqual([
      { label: "Tickets, $15 to $27.50", amount: null, currency: "USD", includes: null },
    ]);
    // The event's Eventbrite page sells it and is its own page (D-073).
    expect(listings[0]).toMatchObject({
      eventUrl: "https://www.eventbrite.com/e/3001",
      listing: { ticket_url: "https://www.eventbrite.com/e/3001" },
    });
  });

  it("writes an organizer again after the mapping changed, though its events did not (D-071)", async () => {
    const events = [ebEvent("1001", "Bachata Thursdays", "2026-09-24T20:00:00")];
    const harvestWith = (contentHash: string) => {
      let t = NOW.getTime();
      return eventbriteAdapter.harvest!(
        { ...SOURCE, contentHash },
        {
          metro: NYC,
          now: () => new Date(t),
          env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
          log: () => {},
          http: createPoliteHttp({
            userAgent: "t",
            now: () => t,
            sleep: async (ms) => void (t += ms),
            transport: async (req) => ({
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({ events, pagination: { has_more_items: false } }),
            }),
          }),
        },
      );
    };
    // The hash stored before D-071 covered the events alone: that source is read again, so its
    // price labels and venue points are written the new way on the first run.
    const before = await harvestWith(sha256(JSON.stringify(events)));
    expect(before.unchanged).toBeUndefined();
    expect(before.listings).toHaveLength(1);
    // After that, unchanged events are unchanged.
    const after = await harvestWith(before.doc!.contentHash);
    expect(after).toMatchObject({ unchanged: true, listings: [] });
  });

  describe("soldOutToCheck", () => {
    it("picks sold-out in-window live events", () => {
      const events = [
        {
          id: "1",
          url: "https://www.eventbrite.com/e/1",
          status: "live",
          ticket_availability: { is_sold_out: true },
          start: { timezone: "America/New_York", local: "2026-09-24T20:00:00" },
        },
        {
          id: "2",
          url: "https://www.eventbrite.com/e/2",
          status: "live",
          ticket_availability: { is_sold_out: false },
          start: { timezone: "America/New_York", local: "2026-09-24T20:00:00" },
        },
        {
          id: "3",
          url: "https://www.eventbrite.com/e/3",
          status: "canceled",
          ticket_availability: { is_sold_out: true },
          start: { timezone: "America/New_York", local: "2026-09-24T20:00:00" },
        },
        {
          id: "4",
          url: "https://www.eventbrite.com/e/4",
          status: "live",
          ticket_availability: { is_sold_out: true },
          start: { timezone: "America/New_York", local: "2026-12-24T20:00:00" },
        },
        { id: "5", url: null, status: "live", ticket_availability: { is_sold_out: true } },
      ];
      const ids = soldOutToCheck(events, {
        metroTz: "America/New_York",
        fromNight: "2026-09-23",
        days: 14,
      });
      expect(ids).toEqual(["1"]);
    });
  });

  describe("pageSaysCancelled", () => {
    it("returns true for HTML with EventCancelled JSON-LD", () => {
      const html = `
        <script type="application/ld+json">
          {"@type":"Event","name":"x","startDate":"2026-10-29T19:30:00-04:00","eventStatus":"https://schema.org/EventCancelled"}
        </script>
      `;
      expect(pageSaysCancelled(html)).toBe(true);
    });
    it("returns false when the page's own event object is live (D-795, Pune sales ended)", () => {
      const html = `
        <script type="application/ld+json">
          {"@type":"Event","name":"Ecstatic Dance Workshop","eventStatus":"https://schema.org/EventCancelled"}
        </script>
        <script>window.__SERVER_DATA__ = {"isParentEvent":false,"ticketsBy":"Eventbrite","url":"https://www.eventbrite.com/e/ecstatic-dance-workshop-tickets-2002629957111","status":"live","organizer":{"id":"114096315351"}};</script>
      `;
      expect(pageSaysCancelled(html)).toBe(false);
    });
    it("still returns true when the page's own event object is not live", () => {
      const html = `
        <script type="application/ld+json">
          {"@type":"Event","name":"x","eventStatus":"https://schema.org/EventCancelled"}
        </script>
        <script>window.__SERVER_DATA__ = {"url":"https://www.eventbrite.com/e/x-tickets-1","status":"canceled"};</script>
      `;
      expect(pageSaysCancelled(html)).toBe(true);
    });
    it("returns false for EventScheduled", () => {
      const html = `
        <script type="application/ld+json">
          {"@type":"Event","name":"x","eventStatus":"https://schema.org/EventScheduled"}
        </script>
      `;
      expect(pageSaysCancelled(html)).toBe(false);
    });
    it("returns false for EventPostponed", () => {
      const html = `
        <script type="application/ld+json">
          {"@type":"Event","name":"x","eventStatus":"https://schema.org/EventPostponed"}
        </script>
      `;
      expect(pageSaysCancelled(html)).toBe(false);
    });
    it("returns false for no JSON-LD", () => {
      expect(pageSaysCancelled("<html></html>")).toBe(false);
    });
  });

  it("harvest: reads page for sold-out event, marks cancelled", async () => {
    const soldOutEvent = {
      ...ebEvent("5001", "Sold-Out Party", "2026-09-25T20:00:00"),
      ticket_availability: { is_sold_out: true },
    };
    const pageHtml = `
      <script type="application/ld+json">
        {"@type":"Event","name":"Sold-Out Party","startDate":"2026-09-25T20:00:00-04:00","eventStatus":"https://schema.org/EventCancelled"}
      </script>
    `;
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: NYC,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          if (req.url.includes("/events/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [soldOutEvent],
                pagination: { has_more_items: false },
              }),
            };
          }
          // page request
          return {
            url: req.url,
            status: 200,
            headers: {},
            body: pageHtml,
          };
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    expect(result.notes).toContain("event 5001 cancelled on its page (API said live)");
    const listing = result.listings[0];
    expect(listing?.listing.cancelled).toBe(true);
  });

  it("harvest: page request fails, event unchanged, note added", async () => {
    const soldOutEvent = {
      ...ebEvent("5002", "Another Sold-Out", "2026-09-25T20:00:00"),
      ticket_availability: { is_sold_out: true },
    };
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: NYC,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          if (req.url.includes("/events/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events: [soldOutEvent],
                pagination: { has_more_items: false },
              }),
            };
          }
          // page request throws
          throw new Error("Network error");
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    expect((result.notes ?? []).some((n) => n.startsWith("event 5002: page not read ("))).toBe(
      true,
    );
    const listing = result.listings[0];
    expect(listing?.listing.cancelled).not.toBe(true);
  });

  it("harvest: respects cap of 6 page checks", async () => {
    const events = Array.from({ length: 7 }, (_, i) => ({
      ...ebEvent(`600${i}`, `Event ${i}`, "2026-09-25T20:00:00"),
      ticket_availability: { is_sold_out: true },
    }));
    let pageCount = 0;
    let t = NOW.getTime();
    const ctx: RunCtx = {
      metro: NYC,
      now: () => new Date(t),
      env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => {
          if (req.url.includes("/events/")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: JSON.stringify({
                events,
                pagination: { has_more_items: false },
              }),
            };
          }
          // page request (robots.txt is fetched once first and not counted)
          if (req.url.includes("/e/")) pageCount++;
          return {
            url: req.url,
            status: 200,
            headers: {},
            body: '<script type="application/ld+json">{"@type":"Event","eventStatus":"https://schema.org/EventScheduled"}</script>',
          };
        },
      }),
    };
    const result = await eventbriteAdapter.harvest!(SOURCE, ctx);
    expect(pageCount).toBe(6);
    expect(result.notes).toContain("1 sold-out events not checked (limit 6 a run)");
  });

  it("lists an event with a date and no time as untimed, and says when a start cannot be read", () => {
    const { listings, notes } = eventbriteToListings(
      [
        ebEvent("2001", "Bachata Picnic", "2026-09-26", {
          description: { text: "Bring a blanket." },
          end: { timezone: "America/New_York", local: "2026-09-26" },
        }),
        ebEvent("2002", "Bachata Mystery", "", { start: { timezone: "America/New_York" } }),
        // Outside the window: silently another run's.
        ebEvent("2003", "Bachata Later", "2026-12-26", { description: { text: "" } }),
      ],
      { fetchedAt: NOW, metroTz: NYC.tz, fromNight: "2026-09-23", days: 14 },
    );
    expect(notes).toEqual(["no readable start: Bachata Mystery"]);
    expect(listings.map((l) => l.externalId)).toEqual(["eb:2001"]);
    const o = normalizeListing(listings[0]!, { metro: NYC, source: SOURCE, now: NOW });
    expect(o).toMatchObject({
      ok: true,
      untimed: true,
      event: {
        key: "eb:2001",
        nightDate: "2026-09-26",
        startsAt: null,
        endsAt: null,
        evidence: expect.objectContaining({ start: "start.local 2026-09-26 America/New_York" }),
      },
    });
  });
});
