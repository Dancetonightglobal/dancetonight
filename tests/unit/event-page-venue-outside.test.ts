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
import { titleNamesOutsideTown } from "@/config/metro-regions";

const NOW = new Date("2026-09-29T16:00:00Z");
const ADDRESS_WITH_POSTCODE = "77a Charterhouse St, London, EC1M 6HJ, GB";
const BUILDING = { lat: 51.5208, lng: -0.096 };
let db: Db;
let metro: Metro;
let source: Source;
let asked: string[] = [];
const geocode = async (address: string) => {
  asked.push(address);
  return address === ADDRESS_WITH_POSTCODE ? BUILDING : null;
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

describeDb("place from event pages (outside metro)", () => {
  beforeAll(async () => {
    db = await testDb("event_page_venue_outside");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    asked = [];
    await db.insert(metros).values({
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5074, lng: -0.1278 },
      radiusKm: 35,
      tz: "Europe/London",
      languages: ["en"],
      status: "active",
    });
    metro = (await loadMetro(db, "london"))!;
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

  const leicestershireHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Leicester Party",
          "startDate": "2026-10-01T22:00:00",
          "location": {
            "@type": "Place",
            "name": "Sandacre Hall",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "Sandacre St.",
              "addressLocality": "Leicestershire",
              "addressCountry": "GB"
            }
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const leicesterPostcodeHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Leicester Postcode Party",
          "startDate": "2026-10-01T22:00:00",
          "location": {
            "@type": "Place",
            "name": "Leicester Venue",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "123 Main St",
              "addressLocality": "Leicester",
              "postalCode": "LE1 3AG",
              "addressCountry": "GB"
            }
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;

  const londonNoPostcodeHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "London No Postcode",
          "startDate": "2026-10-01T22:00:00",
          "location": {
            "@type": "Place",
            "address": "Charterhouse St, London"
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;

  it("removes listing when event page address names an outside town (Leicestershire)", async () => {
    const event = normalized({
      title: "Leicester Party",
      local_date: "2026-10-01",
      doors_time: "22:00",
      venue: { name: "Some Place" },
      ticket_url: "https://www.example.com/leicester",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://www.example.com/leicester": leicestershireHtml });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.removed).toBe(1);
    expect(result.notes.some((n) => n.includes("taken off the site"))).toBe(true);
    const [stored] = await db.select().from(events);
    expect(stored?.status).toBe("removed");
  });

  it("removes listing when elsewhere returns a place outside metro", async () => {
    const event = normalized({
      title: "Leicester Postcode Party",
      local_date: "2026-10-01",
      doors_time: "22:00",
      venue: { name: "Some Place" },
      ticket_url: "https://www.example.com/leicester-postcode",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://www.example.com/leicester-postcode": leicesterPostcodeHtml });
    const elsewhere = async (address: string) => "LE13AG";
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
      elsewhere,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.removed).toBe(1);
    const [stored] = await db.select().from(events);
    expect(stored?.status).toBe("removed");
  });

  it("leaves listing unplaced when address has no postcode but is inside metro", async () => {
    const event = normalized({
      title: "London No Postcode",
      local_date: "2026-10-01",
      doors_time: "22:00",
      venue: { name: "Venue" },
      ticket_url: "https://example.com/no-postcode",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://example.com/no-postcode": londonNoPostcodeHtml });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.notes.some((n) => n.includes("with no postcode"))).toBe(true);
    const [stored] = await db.select().from(events);
    expect(stored?.status).toBe("active");
  });

  it("titleNamesOutsideTown returns correct town for address", () => {
    expect(titleNamesOutsideTown("london", "Sandacre St., Leicestershire, United Kingdom")).toBe(
      "Leicestershire",
    );
    expect(titleNamesOutsideTown("london", "Leicester Square")).toBeNull();
  });
});
