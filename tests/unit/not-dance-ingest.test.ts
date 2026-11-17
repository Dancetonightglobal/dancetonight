// PR 2 through a whole ingest run: Ticketmaster's concert stored before, now that a genre is no
// style, is retired (adapter -> HarvestResult.screened -> ingest -> retireScreened); and a listing
// whose own address is outside the metro is left out and named, never listed without a location.
import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { createPoliteHttp } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NOW = new Date("2026-09-29T21:00:00Z");
const REGGAETON = readFileSync(
  path.join(__dirname, "fixtures/ticketmaster/reggaeton-2026-09-29.json"),
  "utf8",
);
// Geoapify's answers of runs 21 to 34, by the address asked.
const GEOAPIFY = (
  JSON.parse(
    readFileSync(path.join(__dirname, "fixtures/geoapify/nyc-runs-21-34.json"), "utf8"),
  ) as { answers: Record<string, unknown> }
).answers;
let db: Db;
let metro: Metro;

describeDb("Ticketmaster's stored concerts (F15)", () => {
  beforeAll(async () => {
    db = await testDb("not_dance_ingest");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
  });

  it("retires the Don Omar row an earlier run stored, and keeps Reggaetón Y2K", async () => {
    const tm = await upsertSource(db, metro.id, {
      url: "https://www.ticketmaster.com/",
      kind: "ticketing_api",
      platform: "ticketmaster",
      trustTier: "ticketing",
      discoveredBy: "ticketmaster",
    });
    // As run 33 stored it: a hip-hop night from Ticketmaster's genre.
    const before = normalizeListing(
      {
        listing: rawListingSchema.parse({
          title: 'Don Omar "The Last King World Tour"',
          listing_type: "other",
          styles: ["hip_hop", "hip_hop_club", "reggaeton"],
          local_date: "2026-10-10",
          doors_time: "20:00",
          venue: { name: "Barclays Center" },
          organizer: {},
        }),
        externalId: "tm:17GZv0G61DlIaN2",
        tz: "America/New_York",
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: "https://www.ticketmaster.com/", fetchedAt: NOW, method: "api" },
      },
      { metro, source: { styles: [] }, now: NOW },
    );
    if (!before.ok) throw new Error(before.reason);
    await writeEvents(db, {
      metro,
      source: tm,
      events: [before.event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });

    let t = NOW.getTime();
    const http = createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
      transport: async (req) => ({
        url: req.url,
        status: 200,
        headers: {},
        body: !req.url.startsWith("https://app.ticketmaster.com/")
          ? ""
          : req.url.includes("keyword=reggaeton")
            ? REGGAETON
            : '{"page":{"totalPages":0}}',
      }),
    });
    const report = await runIngest({
      db,
      metro,
      http,
      now: () => new Date(t),
      env: { TICKETMASTER_API_KEY: "test-key" },
      only: ["https://nothing.example/"],
    });
    const line = report.sources.find((s) => s.url === "https://www.ticketmaster.com/");
    expect(line?.notes.join(" ")).toContain('Don Omar "The Last King World Tour" on 2026-10-10');
    const rows = await db
      .select({ title: events.title, status: events.status })
      .from(events)
      .where(eq(events.nightDate, "2026-10-10"))
      .orderBy(events.title);
    expect(rows).toEqual([
      { title: 'Don Omar "The Last King World Tour"', status: "removed" },
      { title: "Reggaetón Y2K (18+)", status: "active" },
    ]);
  });
  it("leaves out a listing whose address is in Warsaw or California, names it, and keeps New York's", async () => {
    const feed = "https://zouk.example/events";
    await upsertSource(db, metro.id, {
      url: feed,
      kind: "jsonld",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["brazilian_zouk"],
    });
    // The organiser's events page, its schema.org events each with its own address.
    const at = (title: string, day: number, addressLine1: string, addressLine2: string) => ({
      "@type": "Event",
      name: title,
      startDate: new Date(Date.UTC(2026, 9, day, 23)).toISOString(),
      endDate: new Date(Date.UTC(2026, 9, day + 1, 3)).toISOString(),
      url: `${feed}/${day}`,
      location: {
        "@type": "Place",
        name: `${title} hall`,
        address: `${addressLine1}, ${addressLine2}`,
      },
    });
    const body = {
      "@context": "https://schema.org",
      "@graph": [
        at("Warsaw Brasil Festival", 2, "Warsaw", "PL"),
        at("LA Hustle Congress", 5, "3050 Bristol St", "Costa Mesa, CA"),
        at("Zouk at Irving", 3, "17 Irving Place", "New York, NY, 10003"),
        // Written "N.Y.": New York however it is spelt. No saved answer; Geoapify's own parse.
        at("Zouk on 34th", 4, "311 West 34th St", "New York, N.Y. 10001"),
      ],
    };
    const html = `<html><head><script type="application/ld+json">${JSON.stringify(body)}</script></head></html>`;
    const seen: string[] = [];
    let t = NOW.getTime();
    const http = createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
      transport: async (req) => {
        const url = new URL(req.url);
        let answer: unknown = "";
        if (req.url === feed) return { url: req.url, status: 200, headers: {}, body: html };
        else if (url.hostname === "api.geoapify.com") {
          const text = url.searchParams.get("text") ?? "";
          seen.push(text);
          answer = GEOAPIFY[text] ?? {
            results: [],
            query: { text, parsed: { city: "new york", state: "n.y.", postcode: "10001" } },
          };
        }
        return { url: req.url, status: 200, headers: {}, body: JSON.stringify(answer) };
      },
    });
    const report = await runIngest({
      db,
      metro,
      http,
      now: () => new Date(t),
      env: { GEOAPIFY_API_KEY: "REDACTED" },
      only: [feed],
    });
    const line = report.sources.find((s) => s.url === feed);
    expect(line?.notes).toEqual(
      expect.arrayContaining([
        "Warsaw Brasil Festival: not in New York (the listing gives warsaw, pl)",
        "LA Hustle Congress: not in New York (the listing gives costa mesa, ca)",
      ]),
    );
    const rows = await db
      .select({ title: events.title, status: events.status })
      .from(events)
      .orderBy(events.title);
    expect(rows).toEqual([
      { title: "Zouk at Irving", status: "active" },
      { title: "Zouk on 34th", status: "active" },
    ]);
    // The check reads the answer to the request the venue lookup makes: one request an address.
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("leaves out a listing at a point outside the five boroughs, and takes one stored there off the site", async () => {
    const feed = "https://salsa-feed.example/events";
    const src = await upsertSource(db, metro.id, {
      url: feed,
      kind: "jsonld",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["salsa"],
    });
    // Stored while New York was a 40 km circle: a night at a Newark venue.
    const [newark] = await db
      .insert(venues)
      .values({
        name: "Newark Salsa Hall",
        nameNormalized: "newark salsa hall",
        location: { lat: 40.7357, lng: -74.1724 },
        address: { formatted: "1 Broad St, Newark, NJ" },
        tz: "America/New_York",
        seedProvider: "listing",
        metroId: metro.id,
      })
      .returning();
    const stored = normalizeListing(
      {
        listing: rawListingSchema.parse({
          title: "Newark salsa night",
          listing_type: "social",
          styles: ["salsa"],
          local_date: "2026-10-03",
          dancing_time: "21:00",
          venue: { name: "Newark Salsa Hall" },
          organizer: {},
        }),
        externalId: "old-newark",
        tz: "America/New_York",
        venueLocation: { lat: 40.7357, lng: -74.1724 },
        recurrence: null,
        provenance: { sourceUrl: feed, fetchedAt: NOW, method: "api" },
      },
      { metro, source: { styles: [] }, now: NOW },
    );
    if (!stored.ok) throw new Error(stored.reason);
    await writeEvents(db, {
      metro,
      source: src,
      events: [stored.event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => ({
        venueId: newark!.id,
        location: { lat: 40.7357, lng: -74.1724 },
        created: false,
        method: "same_id",
      }),
    });

    // The organiser's events page, its schema.org events each with its own point.
    const at = (title: string, day: number, lat: number, lng: number) => ({
      "@type": "Event",
      name: title,
      startDate: new Date(Date.UTC(2026, 9, day, 1)).toISOString(),
      endDate: new Date(Date.UTC(2026, 9, day, 4)).toISOString(),
      url: `${feed}/${day}`,
      location: {
        "@type": "Place",
        name: `${title} hall`,
        geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lng },
      },
    });
    const body = {
      "@context": "https://schema.org",
      "@graph": [
        at("Jersey City salsa", 2, 40.7178, -74.0431),
        at("Manhattan salsa", 3, 40.7505, -73.9934),
      ],
    };
    let t = NOW.getTime();
    const http = createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
      transport: async (req) => ({
        url: req.url,
        status: 200,
        headers: {},
        body:
          req.url === feed
            ? `<html><head><script type="application/ld+json">${JSON.stringify(body)}</script></head></html>`
            : "",
      }),
    });
    const report = await runIngest({
      db,
      metro,
      http,
      now: () => new Date(t),
      env: {},
      only: [feed],
    });
    expect(report.sources.find((s) => s.url === feed)?.notes).toContain(
      "Jersey City salsa: not in New York (the listing gives Jersey City salsa hall)",
    );
    expect(report.placing.notes.join(" ")).toContain(
      "1 stored listing(s) outside New York were taken off the site: Newark salsa night on 2026-10-03",
    );
    const rows = await db
      .select({ title: events.title, status: events.status })
      .from(events)
      .orderBy(events.title);
    expect(rows).toEqual([
      { title: "Manhattan salsa", status: "active" },
      { title: "Newark salsa night", status: "removed" },
    ]);
  });
});
