import { rawListingSchema } from "@/src/domain/listing";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { listedItems, squarespaceAdapter } from "@/src/adapters/feeds/squarespace";
import { withSourceVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing, Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "../../src/adapters/feeds/__fixtures__/event-pages");
const fixture = (name: string) => readFileSync(path.join(DIR, name), "utf8");

const page = (url: string, body: string, status = 200): Fixture => ({
  request: { method: "GET", url },
  response: { url, status, headers: { "content-type": "text/html" }, body },
});
const robots = (origin: string): Fixture =>
  page(
    `${origin}/robots.txt`,
    "User-agent: *\nDisallow: /*?format=json\nDisallow: /*?format=ical\n",
  );

const NEW_ORLEANS: Metro = {
  id: "nola",
  slug: "new-orleans",
  name: "New Orleans",
  countryCode: "US",
  center: { lat: 29.9511, lng: -90.0715 },
  radiusKm: 50,
  tz: "America/Chicago",
  languages: ["en"],
};

const source = (url: string): Source => ({
  id: "blue-nile",
  url,
  kind: "squarespace",
  trustTier: "first_party",
  platform: "squarespace",
  feedUrl: url,
  metroId: "nola",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
});

function ctx(fixtures: Fixture[]): RunCtx & { requests: string[] } {
  const transport = fixtureTransport(fixtures);
  const NOW = new Date("2026-10-29T16:00:00Z");
  let t = NOW.getTime();
  return {
    metro: NEW_ORLEANS,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "t",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
    requests: transport.requests,
  };
}

describe("Squarespace wall clock and venue placement (D-250)", () => {
  it("reads printed wall clock from bluenile-calendar.html", () => {
    const html = fixture("bluenile-calendar.html");
    const items = listedItems(html, "https://www.bluenilelive.com/calendar");
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first).toBeDefined();
    expect(first!.night).toBe("2026-10-29");
    expect(first!.startTime).toBe("21:00");
    expect(first!.endTime).toBe("23:30");
  });

  it("harvests with New Orleans metro and adjusts times", async () => {
    const BLUE_NILE = "https://www.bluenilelive.com";
    const run = ctx([
      robots(BLUE_NILE),
      page(`${BLUE_NILE}/calendar`, fixture("bluenile-calendar.html")),
      page(
        `${BLUE_NILE}/calendar-tickets-/8y62nc5hhea2r32-9zzfc-lmbwg-k857h-ht54p-ahkj2-wnwhf-dhgey-rrysy-kcycb`,
        fixture("bluenile-irvin-mayfield.html"),
      ),
      // second item page not needed for this test
    ]);
    const result = await squarespaceAdapter.harvest!(source(`${BLUE_NILE}/calendar`), run);
    expect(result.listings).toHaveLength(2);
    // First listing: Irvin Mayfield
    const first = result.listings.find((l) => l.listing.title.includes("Irvin Mayfield"));
    expect(first).toBeDefined();
    expect(first!.listing.local_date).toBe("2026-10-29");
    expect(first!.listing.doors_time).toBe("21:00");
    expect(first!.listing.end_time).toBe("23:30");
    expect(first!.tz).toBe("America/Chicago");
    // Evidence start should reflect listed time
    expect(first!.listing.evidence.start).toBe("listed 2026-10-29 21:00");
    // Second listing: Reggae Night (fallback from list)
    const second = result.listings.find((l) => l.listing.title.includes("Reggae Night"));
    expect(second).toBeDefined();
    expect(second!.listing.local_date).toBe("2026-10-29");
    // Squarespace writes 11:01pm; the title writes "@11PM" (D-268).
    expect(second!.listing.doors_time).toBe("23:00");
    expect(second!.listing.end_time).toBe("02:01");
  });

  describe("withSourceVenue with venuePage seed", () => {
    const seed = {
      label: "Blue Nile",
      venueAddress: "532 Frenchmen St, New Orleans, LA 70116",
      venuePage: true,
    };

    it("replaces street-named venue with seed address", () => {
      const listing: HarvestedListing = {
        listing: rawListingSchema.parse({
          title: "Event",
          listing_type: "social",
          styles: [],
          local_date: "2026-10-29",
          doors_time: "21:00",
          dancing_time: null,
          lesson_time: null,
          end_time: "23:30",
          venue: {
            name: "532 FRENCHMEN STREET",
            address: "NEW ORLEANS, LA 70116 UNITED STATES",
            url: null,
          },
          organizer: { name: null, url: null },
          evidence: {},
        }),
        externalId: "test",
        tz: null,
        venueLocation: null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://example.com",
          fetchedAt: new Date(),
          method: "jsonld",
        },
      };
      const result = withSourceVenue(listing, seed);
      expect(result.listing.venue.name).toBe("Blue Nile");
      expect(result.listing.venue.address).toBe(seed.venueAddress);
    });

    it("keeps listing with venuePage false unchanged", () => {
      const listing: HarvestedListing = {
        listing: rawListingSchema.parse({
          title: "Event",
          listing_type: "social",
          styles: [],
          local_date: "2026-10-29",
          doors_time: "21:00",
          dancing_time: null,
          lesson_time: null,
          end_time: "23:30",
          venue: {
            name: "532 FRENCHMEN STREET",
            address: "NEW ORLEANS, LA 70116 UNITED STATES",
            url: null,
          },
          organizer: { name: null, url: null },
          evidence: {},
        }),
        externalId: "test",
        tz: null,
        venueLocation: null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://example.com",
          fetchedAt: new Date(),
          method: "jsonld",
        },
      };
      const result = withSourceVenue(listing, { ...seed, venuePage: false });
      expect(result.listing.venue.name).toBe("532 FRENCHMEN STREET");
      expect(result.listing.venue.address).toBe("NEW ORLEANS, LA 70116 UNITED STATES");
    });

    it("keeps listing named 'Spotted Cat' with town-only address unchanged", () => {
      const listing: HarvestedListing = {
        listing: rawListingSchema.parse({
          title: "Event",
          listing_type: "social",
          styles: [],
          local_date: "2026-10-29",
          doors_time: "21:00",
          dancing_time: null,
          lesson_time: null,
          end_time: "23:30",
          venue: {
            name: "Spotted Cat",
            address: "New Orleans, LA",
            url: null,
          },
          organizer: { name: null, url: null },
          evidence: {},
        }),
        externalId: "test",
        tz: null,
        venueLocation: null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://example.com",
          fetchedAt: new Date(),
          method: "jsonld",
        },
      };
      const result = withSourceVenue(listing, seed);
      expect(result.listing.venue.name).toBe("Spotted Cat");
      expect(result.listing.venue.address).toBe("New Orleans, LA");
    });

    it("gives seed address to listing named 'Blue Nile' with town-only address", () => {
      const listing: HarvestedListing = {
        listing: rawListingSchema.parse({
          title: "Event",
          listing_type: "social",
          styles: [],
          local_date: "2026-10-29",
          doors_time: "21:00",
          dancing_time: null,
          lesson_time: null,
          end_time: "23:30",
          venue: {
            name: "Blue Nile",
            address: "New Orleans, LA",
            url: null,
          },
          organizer: { name: null, url: null },
          evidence: {},
        }),
        externalId: "test",
        tz: null,
        venueLocation: null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://example.com",
          fetchedAt: new Date(),
          method: "jsonld",
        },
      };
      const result = withSourceVenue(listing, seed);
      expect(result.listing.venue.name).toBe("Blue Nile");
      expect(result.listing.venue.address).toBe(seed.venueAddress);
    });
  });
});
