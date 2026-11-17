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

describeDb("place from event pages (GB)", () => {
  beforeAll(async () => {
    db = await testDb("event_page_venue_gb");
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

  const eventbriteHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Fabric Night",
          "startDate": "2026-10-01T22:00:00",
          "location": {
            "@type": "Place",
            "name": "Fabric",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "77a Charterhouse St",
              "addressLocality": "London",
              "postalCode": "EC1M 6HJ",
              "addressCountry": "GB"
            }
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;

  it("places a row with ticket_url (GB postcode)", async () => {
    const event = normalized({
      title: "Fabric Night",
      local_date: "2026-10-01",
      doors_time: "22:00",
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
    expect(addressProv?.value).toBe(ADDRESS_WITH_POSTCODE);
    expect(addressProv?.sourceUrl).toBe("https://www.eventbrite.com/e/1");
    expect(addressProv?.method).toBe("jsonld");
    const nameProv = provenance.find((p) => p.field === "venue_name" && p.isCurrent);
    expect(nameProv?.value).toBe("Fabric");
    const oldName = provenance.find((p) => p.field === "venue_name" && p.value === "Main Space");
    expect(oldName?.isCurrent).toBe(false);
  });

  it("skips row with venue_address containing postcode", async () => {
    const event = normalized({
      title: "Event with postcode",
      local_date: "2026-10-01",
      doors_time: "22:00",
      venue: { name: "Venue", address: "77a Charterhouse St, London EC1M 6HJ" },
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

  it("rejects address with no postcode", async () => {
    const htmlNoPostcode = `
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "No Postcode",
        "location": {
          "@type": "Place",
          "address": "Charterhouse St, London"
        }
      }
      </script>
    `;
    const event = normalized({
      title: "No Postcode Event",
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
    const http = fakeHttp({ "https://example.com/no-postcode": htmlNoPostcode });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.notes.some((n) => n.includes("with no postcode"))).toBe(true);
  });
});
