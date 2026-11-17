import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { enmipatioAdapter } from "@/src/adapters/feeds/enmipatio";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const LIST_P1 = readFileSync(path.join(DIR, "enmipatio-list-p1-2026-10-30.html"), "utf8");
const LIST_P2 = readFileSync(path.join(DIR, "enmipatio-list-p2-2026-10-30.html"), "utf8");
const LIST_P3 = readFileSync(path.join(DIR, "enmipatio-list-p3-2026-10-30.html"), "utf8");
const EVENT_SALSA = readFileSync(path.join(DIR, "enmipatio-event-salsa-cupey.html"), "utf8");
const EVENT_PLENA = readFileSync(path.join(DIR, "enmipatio-event-plena-catano.html"), "utf8");
const EVENT_IMAN = readFileSync(path.join(DIR, "enmipatio-event-iman-bomba.html"), "utf8");

const BASE_URL = "https://enmipatiopr.com/event";

const SAN_JUAN: Metro = {
  id: "sj",
  slug: "san-juan",
  name: "San Juan",
  countryCode: "US",
  center: { lat: 18.4655, lng: -66.1057 },
  radiusKm: 50,
  tz: "America/Puerto_Rico",
  languages: ["en"],
};

const source = (): Source => ({
  id: "s",
  url: BASE_URL,
  kind: "jsonld",
  trustTier: "directory",
  platform: "enmipatio",
  feedUrl: null,
  metroId: "sj",
  styles: ["bomba", "salsa"],
  etag: null,
  lastModified: null,
  contentHash: null,
});

const html = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: { "content-type": "text/html" }, body },
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const transport = fixtureTransport([
    {
      request: { method: "GET", url: "https://enmipatiopr.com/robots.txt" },
      response: {
        url: "https://enmipatiopr.com/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
    metro: SAN_JUAN,
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

const NOW = new Date("2026-10-30T16:00:00Z"); // window nights 2026-10-30..2026-11-12

describe("enmipatio reader", () => {
  it("reads three list pages, keeps dance rows, fetches event pages, yields 6 listings", async () => {
    // Build page 4 with empty data
    const page4Json = {
      component: "Event/Index",
      props: {
        events: {
          current_page: 4,
          last_page: 4,
          next_page_url: null,
          total: 10,
          data: [],
        },
      },
      url: "/event?page=4",
      version: "",
    };
    const page4Html = `<!DOCTYPE html><html><head></head><body><script data-page="app" type="application/json">${JSON.stringify(
      page4Json,
    )}</script></body></html>`;

    const run = ctx(
      [
        html(`${BASE_URL}?page=1`, LIST_P1),
        html(`${BASE_URL}?page=2`, LIST_P2),
        html(`${BASE_URL}?page=3`, LIST_P3),
        html(`${BASE_URL}?page=4`, page4Html),
        html(
          "https://enmipatiopr.com/event/free-salsa-classes-dance-thursdays-in-san-juan",
          EVENT_SALSA,
        ),
        html(
          "https://enmipatiopr.com/event/puerto-ricos-plena-bomba-mondays-music-art-and-culture",
          EVENT_PLENA,
        ),
        html(
          "https://enmipatiopr.com/event/el-iman-bomba-nights-discover-loizas-cultural-heartbeat",
          EVENT_IMAN,
        ),
        // Other slugs should 404
        ...["via-artesanal-ponce-discover-puerto-ricos-handmade-heritage", "other-non-dance"].map(
          (slug) => ({
            request: { method: "GET" as const, url: `https://enmipatiopr.com/event/${slug}` },
            response: {
              url: `https://enmipatiopr.com/event/${slug}`,
              status: 404,
              headers: { "content-type": "text/html" },
              body: "<html>Not found</html>",
            },
          }),
        ),
      ],
      NOW,
    );
    const result = await enmipatioAdapter.harvest!(source(), run);

    // Expect 6 listings
    expect(result.listings).toHaveLength(6);

    // Sort by day and time for consistent checking
    const sorted = result.listings.sort((a, b) => {
      if (a.listing.local_date! !== b.listing.local_date!) {
        return a.listing.local_date!.localeCompare(b.listing.local_date!);
      }
      return (
        (a.listing.doors_time || "").localeCompare(b.listing.doors_time || "") ||
        a.listing.title.localeCompare(b.listing.title)
      );
    });

    // Check each listing
    const expected = [
      { day: "2026-11-01", time: "19:00", titleContains: "Noches de El Imán Bomba" },
      { day: "2026-11-02", time: "20:00", titleContains: "Lunes de Plena y Bomba" },
      { day: "2026-11-05", time: "19:00", titleContains: "Clases de Salsa Gratis" },
      { day: "2026-11-09", time: "20:00", titleContains: "Lunes de Plena y Bomba" },
      { day: "2026-11-12", time: "19:00", titleContains: "Clases de Salsa Gratis" },
      { day: "2026-11-12", time: "19:00", titleContains: "Noches de El Imán Bomba" },
    ];

    expected.forEach((exp, idx) => {
      expect(sorted[idx]!.listing.local_date).toBe(exp.day);
      expect(sorted[idx]!.listing.doors_time).toBe(exp.time);
      expect(sorted[idx]!.listing.title).toContain(exp.titleContains);
    });

    // Check Cupey listing details
    const cupey = sorted.find((l) => l.listing.title.includes("Clases de Salsa Gratis"));
    expect(cupey).toBeDefined();
    expect(cupey!.listing.venue.name).toBe("Downtown Cupey");
    expect(cupey!.listing.venue.address).toBe("54 Av. Paraná, San Juan, 00926, Puerto Rico");
    expect(cupey!.venueLocation).toEqual({ lat: 18.3840254, lng: -66.0630682 });
    expect(cupey!.listing.end_time).toBe("20:00");

    // Notes
    // 10 rows kept, 3 succeed, 7 fail
    expect(result.notes).toContain("7 event page(s) failed");
    expect(result.notes).toContain("26 event(s) not dance left out");
    expect(result.whole).toBeUndefined(); // because event page failures

    // Verify no request for non-dance slug "via-artesanal-ponce..."
    // (it's not in kept rows because it's not dance)
    expect(run.requests).not.toContain(
      "GET https://enmipatiopr.com/event/via-artesanal-ponce-discover-puerto-ricos-handmade-heritage",
    );
  });

  it("rejects when page 1 has no event list", async () => {
    const run = ctx([html(`${BASE_URL}?page=1`, "<html>No script</html>")], NOW);
    await expect(enmipatioAdapter.harvest!(source(), run)).rejects.toThrow(/carries no event list/);
  });

  it("leaves out cancelled occurrences", async () => {
    // We'll just test with a simple mock: create a custom page with one event that has cancelled occurrence
    const customPage = {
      component: "Event/Index",
      props: {
        events: {
          current_page: 1,
          last_page: 1,
          next_page_url: null,
          total: 1,
          data: [
            {
              id: 999,
              title: 'Noche de Danza (kept by "danz")',
              slug: "test-cancelled",
              date: "2026-11-01",
              time: "19:00:00",
              venue: "Test Venue",
              city: "San Juan",
              categories: [{ id: 1, name: "Cultural" }],
            },
          ],
        },
      },
      url: "/event?page=1",
      version: "",
    };
    const customHtml = `<!DOCTYPE html><html><body><script data-page="app" type="application/json">${JSON.stringify(
      customPage,
    )}</script></body></html>`;

    const eventWithCancelled = {
      component: "Event/Show",
      props: {
        event: {
          title: "Test Cancelled Event",
          venue: "Test Venue",
          address: "Test Address",
          latitude: "18.4655",
          longitude: "-66.1057",
          city: "San Juan",
          categories: [{ id: 1, name: "Música y Baile" }],
          occurrences: [
            {
              id: 1,
              starts_at: "2026-11-01T23:00:00.000000Z",
              ends_at: "2026-11-02T01:00:00.000000Z",
              all_day: false,
              is_cancelled: true,
            },
            {
              id: 2,
              starts_at: "2026-11-08T23:00:00.000000Z",
              ends_at: "2026-11-09T01:00:00.000000Z",
              all_day: false,
              is_cancelled: false,
            },
          ],
        },
      },
      url: "/event/test-cancelled",
      version: "",
    };
    const eventHtml = `<!DOCTYPE html><html><body><script data-page="app" type="application/json">${JSON.stringify(
      eventWithCancelled,
    )}</script></body></html>`;

    const run = ctx(
      [
        html(`${BASE_URL}?page=1`, customHtml),
        html("https://enmipatiopr.com/event/test-cancelled", eventHtml),
      ],
      NOW,
    );
    const result = await enmipatioAdapter.harvest!(source(), run);

    // Only the non-cancelled occurrence should appear
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.listing.local_date).toBe("2026-11-08");
  });
});
