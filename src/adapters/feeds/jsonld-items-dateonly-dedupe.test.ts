import { describe, expect, it } from "vitest";

import { jsonLdItemsAdapter } from "@/src/adapters/feeds/jsonld-items";
import type { RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const page = (url: string, body: string, status = 200): Fixture => ({
  request: { method: "GET", url },
  response: { url, status, headers: { "content-type": "text/html" }, body },
});

const MUMBAI = {
  id: "m",
  slug: "mumbai",
  name: "Mumbai",
  countryCode: "IN",
  center: { lat: 19.076, lng: 72.8777 },
  radiusKm: 50,
  tz: "Asia/Kolkata",
  languages: ["en"],
};

const source = (url: string): Source => ({
  id: "s",
  url,
  kind: "jsonld",
  trustTier: "first_party",
  platform: "jsonld_items",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const transport = fixtureTransport(fixtures);
  let t = now.getTime();
  return {
    metro: MUMBAI,
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

describe("jsonld_items: drop date-only list row when its event page gives the night a time (D-622)", () => {
  it("(a) list date-only + page timed -> 1 listing with time and note", async () => {
    const listHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Almost Human - Halloween Edition",
          "startDate": "2026-11-01",
          "url": "https://allevents.in/mumbai/almost-human-halloween-edition/123",
          "location": {
            "@type": "Place",
            "name": "Some Venue",
            "address": "Mumbai, India"
          }
        }
      </script>
    `;
    const eventHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Almost Human - Halloween Edition",
          "startDate": "2026-11-01T21:00:00+05:30",
          "location": {
            "@type": "Place",
            "name": "Some Venue",
            "address": "Mumbai, India"
          }
        }
      </script>
    `;
    const run = ctx(
      [
        page("https://allevents.in/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/parties", listHtml),
        page("https://allevents.in/mumbai/almost-human-halloween-edition/123", eventHtml),
      ],
      new Date("2026-10-31T06:00:00Z"),
    );
    const result = await jsonLdItemsAdapter.harvest!(
      source("https://allevents.in/mumbai/parties"),
      run,
    );
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.listing.doors_time || result.listings[0]!.listing.dancing_time).toBe(
      "21:00",
    );
    expect(result.notes).toContain(
      "1 date-only list row(s) dropped for their event page's timed row",
    );
  });

  it("(a2) title differs in case/spacing but URL matches -> 1 listing", async () => {
    const listHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Almost Human - Halloween Edition",
          "startDate": "2026-11-01",
          "url": "https://allevents.in/mumbai/almost-human-halloween-edition/123",
          "location": {
            "@type": "Place",
            "name": "Some Venue",
            "address": "Mumbai, India"
          }
        }
      </script>
    `;
    const eventHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Almost Human - Halloween edition",
          "startDate": "2026-11-01T21:00:00+05:30",
          "location": {
            "@type": "Place",
            "name": "Some Venue",
            "address": "Mumbai, India"
          }
        }
      </script>
    `;
    const run = ctx(
      [
        page("https://allevents.in/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/parties", listHtml),
        page("https://allevents.in/mumbai/almost-human-halloween-edition/123", eventHtml),
      ],
      new Date("2026-10-31T06:00:00Z"),
    );
    const result = await jsonLdItemsAdapter.harvest!(
      source("https://allevents.in/mumbai/parties"),
      run,
    );
    expect(result.listings).toHaveLength(1);
    expect(result.notes).toContain(
      "1 date-only list row(s) dropped for their event page's timed row",
    );
  });

  it("(b) list date-only and page timed but different dates -> 2 listings, no note", async () => {
    const listHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Nexum",
          "startDate": "2026-11-02",
          "url": "https://allevents.in/mumbai/nexum/456",
          "location": {
            "@type": "Place",
            "name": "Venue",
            "address": "Mumbai"
          }
        }
      </script>
    `;
    const eventHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Nexum",
          "startDate": "2026-11-03T21:00:00+05:30",
          "location": {
            "@type": "Place",
            "name": "Venue",
            "address": "Mumbai"
          }
        }
      </script>
    `;
    const run = ctx(
      [
        page("https://allevents.in/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/parties", listHtml),
        page("https://allevents.in/mumbai/nexum/456", eventHtml),
      ],
      new Date("2026-10-31T06:00:00Z"),
    );
    const result = await jsonLdItemsAdapter.harvest!(
      source("https://allevents.in/mumbai/parties"),
      run,
    );
    expect(result.listings).toHaveLength(2);
    expect((result.notes ?? []).some((n) => n.includes("date-only list row(s) dropped"))).toBe(
      false,
    );
  });

  it("(c) page row is also date-only -> unchanged (the existing night match keeps one), no note", async () => {
    const listHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Event",
          "startDate": "2026-11-01",
          "url": "https://allevents.in/mumbai/event/789",
          "location": {
            "@type": "Place",
            "name": "Venue",
            "address": "Mumbai"
          }
        }
      </script>
    `;
    const eventHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Event",
          "startDate": "2026-11-01",
          "location": {
            "@type": "Place",
            "name": "Venue",
            "address": "Mumbai"
          }
        }
      </script>
    `;
    const run = ctx(
      [
        page("https://allevents.in/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/parties", listHtml),
        page("https://allevents.in/mumbai/event/789", eventHtml),
      ],
      new Date("2026-10-31T06:00:00Z"),
    );
    const result = await jsonLdItemsAdapter.harvest!(
      source("https://allevents.in/mumbai/parties"),
      run,
    );
    // Both rows are date-only, but the existing dedupe by nightKey drops the list row
    // because the page row has the same nightKey (same title, date, and no times).
    // So we expect only 1 listing (the page row).
    expect(result.listings).toHaveLength(1);
    expect((result.notes ?? []).some((n) => n.includes("date-only list row(s) dropped"))).toBe(
      false,
    );
  });

  it("(d) list date-only + page timed -> 1 listing (timed)", async () => {
    const listHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Paint With Strangers",
          "startDate": "2026-11-02",
          "url": "https://allevents.in/mumbai/paint-with-strangers/999",
          "location": {
            "@type": "Place",
            "name": "Art Studio",
            "address": "Mumbai"
          }
        }
      </script>
    `;
    const eventHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Paint With Strangers",
          "startDate": "2026-11-02T19:00:00+05:30",
          "location": {
            "@type": "Place",
            "name": "Art Studio",
            "address": "Mumbai"
          }
        }
      </script>
    `;
    const run = ctx(
      [
        page("https://allevents.in/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/robots.txt", "User-agent: *\nDisallow:\n"),
        page("https://allevents.in/mumbai/parties", listHtml),
        page("https://allevents.in/mumbai/paint-with-strangers/999", eventHtml),
      ],
      new Date("2026-10-31T06:00:00Z"),
    );
    const result = await jsonLdItemsAdapter.harvest!(
      source("https://allevents.in/mumbai/parties"),
      run,
    );
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.listing.doors_time || result.listings[0]!.listing.dancing_time).toBe(
      "19:00",
    );
    expect(result.notes).toContain(
      "1 date-only list row(s) dropped for their event page's timed row",
    );
  });
});
