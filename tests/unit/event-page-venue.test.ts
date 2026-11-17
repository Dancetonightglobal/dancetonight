import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, fieldProvenance, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  resolveVenue,
  upsertSource,
  writeEvents,
  type VenueInput,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";
import type { HttpClient, HttpResponse } from "@/src/pipeline/http";
import { HttpError } from "@/src/pipeline/http";
import { placeFromEventPages } from "@/src/pipeline/event-page-venue";

const NOW = new Date("2026-09-29T16:00:00Z");
const ADDRESS_WITH_ZIP = "1016 Beverley Rd, Brooklyn, NY, 11218, US";
const BUILDING = { lat: 40.6386, lng: -73.9636 };
let db: Db;
let metro: Metro;
let source: Source;
let asked: string[] = [];
const geocode = async (address: string) => {
  asked.push(address);
  return address === ADDRESS_WITH_ZIP ? BUILDING : null;
};
const place = (input: VenueInput, apiPoint = false) =>
  resolveVenue(db, metro, input, geocode, { checkPoint: apiPoint });

function normalized(
  fields: Record<string, unknown>,
  extra: Partial<HarvestedListing> = {},
  from: Source = source,
): NormalizedEvent {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: [],
        venue: {},
        organizer: {},
        ...fields,
      }),
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: { sourceUrl: "https://directory.example/", fetchedAt: NOW, method: "llm" },
      ...extra,
    },
    { metro, source: from, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

describeDb("place from event pages", () => {
  beforeAll(async () => {
    db = await testDb("event_page_venue");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    asked = [];
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "nyc"))!;
    source = await upsertSource(db, metro.id, {
      url: "https://directory.example/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  function fakeHttp(pages: Record<string, string>): HttpClient & { requests: string[] } {
    const requests: string[] = [];
    return {
      requests,
      request: async (req) => {
        requests.push(req.url);
        if (!(req.url in pages)) {
          throw new HttpError("robots_disallowed", req.url, "disallowed");
        }
        const body = pages[req.url] ?? "";
        return {
          url: req.url,
          status: 200,
          headers: {},
          body,
          notModified: false,
          etag: null,
          lastModified: null,
          fetchedAt: NOW,
        } satisfies HttpResponse;
      },
      robots: async () => {
        throw new Error("unused");
      },
    };
  }

  const eventbriteHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Jazz & Gin",
          "startDate": "2026-10-01T20:00:00",
          "location": {
            "@type": "Place",
            "name": "Urbane Arts Club",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "1016 Beverley Rd",
              "addressLocality": "Brooklyn",
              "addressRegion": "NY",
              "postalCode": "11218",
              "addressCountry": "US"
            }
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;

  it("places a row with ticket_url", async () => {
    const event = normalized({
      title: "Jazz & Gin",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Main Space" },
      ticket_url: "https://www.eventbrite.com/e/1",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://www.eventbrite.com/e/1": eventbriteHtml });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(1);
    expect(http.requests).toEqual(["https://www.eventbrite.com/e/1"]);
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).not.toBeNull();
    expect(stored?.geo).toEqual(BUILDING);
    const provenance = await db
      .select()
      .from(fieldProvenance)
      .where(eq(fieldProvenance.entityId, stored!.id));
    const addressProv = provenance.find((p) => p.field === "venue_address" && p.isCurrent);
    expect(addressProv?.value).toBe(ADDRESS_WITH_ZIP);
    expect(addressProv?.sourceUrl).toBe("https://www.eventbrite.com/e/1");
    expect(addressProv?.method).toBe("jsonld");
    const nameProv = provenance.find((p) => p.field === "venue_name" && p.isCurrent);
    expect(nameProv?.value).toBe("Urbane Arts Club");
    // The directory's own venue name is kept, no longer current.
    const oldName = provenance.find((p) => p.field === "venue_name" && p.value === "Main Space");
    expect(oldName?.isCurrent).toBe(false);
    // Title provenance should remain current
    const titleProv = provenance.find((p) => p.field === "title");
    expect(titleProv?.isCurrent).toBe(true);
  });

  it("skips row with venue_address containing ZIP", async () => {
    const event = normalized({
      title: "Event with ZIP",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue", address: "10 Main St, Brooklyn, NY 11201" },
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({});
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(0);
    expect(result.placed).toBe(0);
    expect(http.requests).toEqual([]);
  });

  it("skips link equal to source URL", async () => {
    const event = normalized({
      title: "Same as source",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://directory.example",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({});
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(0);
    expect(result.placed).toBe(0);
    expect(http.requests).toEqual([]);
  });

  it("handles page with no JSON-LD", async () => {
    const event = normalized({
      title: "No JSON",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/no-json",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://example.com/no-json": "<html></html>" });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.notes.some((n) => n.includes("gave no venue"))).toBe(true);
  });

  it("rejects address with no ZIP", async () => {
    const htmlNoZip = `
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "No ZIP",
        "location": {
          "@type": "Place",
          "address": "123 Street, City, State"
        }
      }
      </script>
    `;
    const event = normalized({
      title: "No ZIP Event",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/no-zip",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://example.com/no-zip": htmlNoZip });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.notes.some((n) => n.includes("with no ZIP"))).toBe(true);
  });

  it("respects limit", async () => {
    const event1 = normalized({
      title: "First",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/1",
    });
    const event2 = normalized({
      title: "Second",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/2",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event1, event2],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({
      "https://example.com/1": eventbriteHtml,
      "https://example.com/2": eventbriteHtml,
    });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
      limit: 1,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(1);
    expect(result.notes.some((n) => n.includes("left for a later run"))).toBe(true);
  });

  it("reads at most 25 Meetup event pages a run, other pages still (D-561)", async () => {
    const meetup = Array.from({ length: 26 }, (_, i) =>
      normalized({
        title: `Meetup ${String(i + 1).padStart(2, "0")}`,
        local_date: "2026-10-01",
        doors_time: "20:00",
        venue: { name: "Venue" },
        ticket_url: `https://www.meetup.com/salsa-group/events/${1000 + i}/`,
      }),
    );
    const other = normalized({
      title: "Zz other",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/other",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [...meetup, other],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const pages: Record<string, string> = { "https://example.com/other": eventbriteHtml };
    for (let i = 0; i < 26; i++) {
      pages[`https://www.meetup.com/salsa-group/events/${1000 + i}/`] = eventbriteHtml;
    }
    const http = fakeHttp(pages);
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(http.requests.filter((u) => u.includes("meetup.com")).length).toBe(25);
    expect(http.requests).not.toContain("https://www.meetup.com/salsa-group/events/1025/");
    expect(http.requests).toContain("https://example.com/other");
    expect(result.asked).toBe(26);
    expect(result.notes.some((n) => n.includes("left for a later run"))).toBe(true);
  });

  it("deduplicates same link", async () => {
    const event1 = normalized({
      title: "First",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/same",
    });
    const event2 = normalized({
      title: "Second",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/same",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event1, event2],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://example.com/same": eventbriteHtml });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(2);
    expect(http.requests).toEqual(["https://example.com/same"]);
  });

  it("never requests a Resident Advisor page", async () => {
    const event = normalized({
      title: "RA Event",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://ra.co/events/2545920",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({});
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(0);
    expect(result.placed).toBe(0);
    expect(result.notes.some((n) => n.includes("ra.co"))).toBe(false);
  });

  it("never requests a Facebook page, mobile host included", async () => {
    const event = normalized({
      title: "Facebook Event",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://m.facebook.com/events/1",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({});
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(0);
    expect(result.placed).toBe(0);
    expect(http.requests).toEqual([]);
  });

  it("handles robots_disallowed error", async () => {
    const event = normalized({
      title: "Blocked",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/blocked",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({}); // no entry -> throws robots_disallowed
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.notes.some((n) => n.includes("robots_disallowed"))).toBe(true);
  });

  it("calls elsewhere and leaves unplaced", async () => {
    const event = normalized({
      title: "Elsewhere",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/elsewhere",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://example.com/elsewhere": eventbriteHtml });
    const elsewhere = async (address: string) =>
      address === ADDRESS_WITH_ZIP ? "Newark, NJ" : null;
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
      elsewhere,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.notes.some((n) => n.includes("puts it in Newark, NJ"))).toBe(true);
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).toBeNull();
  });
});
