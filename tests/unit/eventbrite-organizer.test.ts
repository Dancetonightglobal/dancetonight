// Eventbrite's organiser website (lane 1, D-090): an organiser's own site is its URL, so its
// nights pair with its own site's; the mapping version makes an unchanged response re-written.

import { describe, expect, it } from "vitest";

import {
  EVENTBRITE_MAPPING_VERSION,
  eventbriteAdapter,
  eventbriteToListings,
} from "@/src/adapters/apis/eventbrite";
import { sha256 } from "@/src/adapters/shared";
import type { RunCtx, Source } from "@/src/adapters/types";

const FETCHED = new Date("2026-09-28T16:00:00Z");

const event = (organizer: Record<string, unknown>) => ({
  id: "2001091347087",
  name: { text: "English Country Dancing @ The Church of The Village" },
  url: "https://www.eventbrite.com/e/english-country-dancing-tickets-2001091347087",
  start: { timezone: "America/New_York", local: "2026-09-29T19:00:00" },
  end: { timezone: "America/New_York", local: "2026-09-29T22:00:00" },
  status: "live",
  venue: {
    name: "The Church of the Village",
    address: {
      address_1: "201 West 13th Street",
      city: "New York",
      region: "NY",
      latitude: "40.7381373",
      longitude: "-74.0003114",
    },
  },
  organizer: { name: "CDNY", url: "https://www.eventbrite.com/o/cdny-115478120751", ...organizer },
});

const organizerUrl = (organizer: Record<string, unknown>) =>
  eventbriteToListings([event(organizer)], {
    fetchedAt: FETCHED,
    metroTz: "America/New_York",
    fromNight: "2026-09-28",
  }).listings[0]?.listing.organizer.url;

describe("Eventbrite's organiser URL", () => {
  it("is the organiser's own website when Eventbrite has one", () => {
    expect(organizerUrl({ website: "https://cdny.org/" })).toBe("https://cdny.org/");
  });

  it("stays the Eventbrite page when the website is a platform or missing", () => {
    expect(organizerUrl({ website: "https://www.facebook.com/cdny" })).toBe(
      "https://www.eventbrite.com/o/cdny-115478120751",
    );
    expect(organizerUrl({ website: "https://linktr.ee/cdny" })).toBe(
      "https://www.eventbrite.com/o/cdny-115478120751",
    );
    expect(organizerUrl({})).toBe("https://www.eventbrite.com/o/cdny-115478120751");
  });

  it("re-writes an unchanged response stored under the previous mapping version", async () => {
    expect(EVENTBRITE_MAPPING_VERSION).toBe(4);
    const events = [event({ website: "https://cdny.org/" })];
    const body = JSON.stringify({ events, pagination: { has_more_items: false } });
    const ctx = {
      env: { EVENTBRITE_PRIVATE_TOKEN: "test" },
      http: { request: () => Promise.resolve({ body, fetchedAt: FETCHED, status: 200 }) },
      now: () => FETCHED,
      metro: { tz: "America/New_York" },
    } as unknown as RunCtx;
    const source = (contentHash: string) =>
      ({
        url: "https://www.eventbrite.com/o/cdny-115478120751",
        feedUrl: null,
        contentHash,
      }) as unknown as Source;

    const old = await eventbriteAdapter.harvest!(source(sha256(JSON.stringify([3, events]))), ctx);
    expect(old.unchanged).toBeUndefined();
    expect(old.listings[0]?.listing.organizer.url).toBe("https://cdny.org/");

    const same = await eventbriteAdapter.harvest!(source(old.doc!.contentHash!), ctx);
    expect(same.unchanged).toBe(true);
  });
});
