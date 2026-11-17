import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { knownVenuePlace } from "@/src/pipeline/source-venue";

const NOW = new Date("2026-09-29T16:00:00Z");
let db: Db;
let metro: Metro;
let source: Source;
let asked: string[] = [];
const geocode = async (address: string) => {
  asked.push(address);
  return null;
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

describeDb("place from event pages (known venues)", () => {
  beforeAll(async () => {
    db = await testDb("event_page_venue_known");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    asked = [];
    await db.insert(metros).values({
      slug: "lisbon",
      name: "Lisbon",
      countryCode: "PT",
      center: { lat: 38.7223, lng: -9.1393 },
      radiusKm: 35,
      tz: "Europe/Lisbon",
      languages: ["pt", "en"],
      status: "active",
    });
    metro = (await loadMetro(db, "lisbon"))!;
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

  const KNOWN = [
    {
      names: ["Largo José Saramago"],
      address: "Largo José Saramago, 1100-016 Lisboa",
      streets: ["Largo José Saramago"],
      areas: ["Lisbon"],
      point: { lat: 38.7084462, lng: -9.1328372 },
    },
  ];

  const eventPageHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Milonga no Largo",
          "startDate": "2026-10-01T20:00:00",
          "location": {
            "@type": "Place",
            "address": {
              "@type": "PostalAddress",
              "streetAddress": "Largo José Saramago",
              "addressLocality": "Lisbon",
              "addressRegion": "Lisbon",
              "addressCountry": "PT"
            }
          }
        }
        </script>
      </head>
      <body></body>
    </html>
  `;

  it("places a row with ticket_url via known venue (no postcode)", async () => {
    const event = normalized({
      title: "Milonga no Largo",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Largo" },
      ticket_url: "https://www.meetup.com/e/1",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://www.meetup.com/e/1": eventPageHtml });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
      known: KNOWN,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(1);
    expect(http.requests).toEqual(["https://www.meetup.com/e/1"]);
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).not.toBeNull();
    expect(stored?.geo).toEqual({ lat: 38.7084462, lng: -9.1328372 });
    const provenance = await db
      .select()
      .from(fieldProvenance)
      .where(eq(fieldProvenance.entityId, stored!.id));
    const addressProv = provenance.find((p) => p.field === "venue_address" && p.isCurrent);
    expect(addressProv?.value).toBe("Largo José Saramago, 1100-016 Lisboa");
    const nameProv = provenance.find((p) => p.field === "venue_name" && p.isCurrent);
    // The name the known venue keeps is the row's own ("Largo"), so its read's provenance stands.
    expect(nameProv?.value).toBe("Largo");
    expect(nameProv?.method).toBe("llm");
  });

  it("without known venues, row stays unplaced", async () => {
    const event = normalized({
      title: "Milonga no Largo",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Largo" },
      ticket_url: "https://www.meetup.com/e/1",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://www.meetup.com/e/1": eventPageHtml });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
      // known omitted
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    expect(result.notes.some((n) => n.includes("left unplaced"))).toBe(true);
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).toBeNull();
  });

  it("known venue does not match different address", async () => {
    const differentHtml = `
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "Event Elsewhere",
        "location": {
          "@type": "Place",
          "address": "Rua Augusta 10, Lisbon, PT"
        }
      }
      </script>
    `;
    const event = normalized({
      title: "Event Elsewhere",
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "Somewhere Else" },
      ticket_url: "https://example.com/different",
    });
    await writeEvents(db, {
      metro,
      source,
      events: [event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });
    const http = fakeHttp({ "https://example.com/different": differentHtml });
    const result = await placeFromEventPages(db, {
      metro,
      nights: ["2026-10-01"],
      http,
      placeVenue: place,
      known: KNOWN,
    });
    expect(result.asked).toBe(1);
    expect(result.placed).toBe(0);
    const [stored] = await db.select().from(events);
    expect(stored?.venueId).toBeNull();
  });
});

describe("knownVenuePlace", () => {
  const KNOWN = [
    {
      names: ["Largo José Saramago"],
      address: "Largo José Saramago, 1100-016 Lisboa",
      streets: ["Largo José Saramago"],
      areas: ["Lisbon"],
      point: { lat: 38.7084462, lng: -9.1328372 },
    },
  ];

  it("returns known venue address and point when address matches", () => {
    const result = knownVenuePlace(
      { name: null, address: "Largo José Saramago, Lisbon, Lisbon, PT" },
      KNOWN,
      "PT",
    );
    expect(result).not.toBeNull();
    expect(result!.address).toBe("Largo José Saramago, 1100-016 Lisboa");
    expect(result!.point).toEqual({ lat: 38.7084462, lng: -9.1328372 });
    expect(result!.name).toBe("Largo José Saramago");
  });

  it("returns null when address does not match", () => {
    const result = knownVenuePlace(
      { name: "Somewhere Else", address: "Rua Augusta 10, Lisbon, PT" },
      KNOWN,
      "PT",
    );
    expect(result).toBeNull();
  });

  it("returns null when known is undefined", () => {
    const result = knownVenuePlace(
      { name: null, address: "Largo José Saramago, Lisbon, Lisbon, PT" },
      undefined,
      "PT",
    );
    expect(result).toBeNull();
  });

  it("returns null when known is empty array", () => {
    const result = knownVenuePlace(
      { name: null, address: "Largo José Saramago, Lisbon, Lisbon, PT" },
      [],
      "PT",
    );
    expect(result).toBeNull();
  });
});
