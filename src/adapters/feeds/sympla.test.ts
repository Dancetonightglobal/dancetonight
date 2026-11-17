import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { symplaAdapter } from "@/src/adapters/feeds/sympla";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const listFixture = () => readFileSync(path.join(DIR, "sympla-rio-list-2026-10-29.html"), "utf8");
const eventFixture3632351 = () => readFileSync(path.join(DIR, "sympla-event-3632351.html"), "utf8");
const eventFixture3596160 = () => readFileSync(path.join(DIR, "sympla-event-3596160.html"), "utf8");

const RIO: Metro = {
  id: "m",
  slug: "rio",
  name: "Rio de Janeiro",
  countryCode: "BR",
  center: { lat: -22.9068, lng: -43.1729 },
  radiusKm: 50,
  tz: "America/Sao_Paulo",
  languages: ["pt"],
};

const source = (url: string): Source => ({
  id: "s",
  url,
  kind: "html",
  trustTier: "first_party",
  platform: "sympla",
  feedUrl: null,
  metroId: "m",
  styles: ["forro"],
  etag: null,
  lastModified: null,
  contentHash: null,
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const seen = new Set<string>();
  const enhanced: Fixture[] = [];
  for (const f of fixtures) {
    const url = f.request.url;
    const domain = new URL(url).origin;
    if (!seen.has(domain)) {
      seen.add(domain);
      enhanced.push({
        request: { method: "GET", url: `${domain}/robots.txt` },
        response: {
          url: `${domain}/robots.txt`,
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nAllow: /\n",
        },
      });
    }
    enhanced.push(f);
  }
  const transport = fixtureTransport(enhanced);
  let t = now.getTime();
  return {
    metro: RIO,
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

describe("sympla reader", () => {
  it("reads list, follows event links, builds listings", async () => {
    const now = new Date("2026-10-29T15:00:00Z"); // 12:00 Rio
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj" },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3632351(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/fiesta-latina-chevere-quinta-feira-29-outubro-copacabana-tau/3596160",
          },
          response: {
            url: "https://www.sympla.com.br/evento/fiesta-latina-chevere-quinta-feira-29-outubro-copacabana-tau/3596160",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3596160(),
          },
        },
        // For the other 10 URLs, simulate 404
        // We'll not add fixtures for them, causing the http client to throw.
        // The test will still work because the adapter catches errors and adds notes.
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj"),
      run,
    );

    // Should have 2 listings (the two we have fixtures for)
    expect(result.listings).toHaveLength(2);
    const listing3632351 = result.listings.find((l) => l.externalId === "sympla:3632351");
    expect(listing3632351).toBeDefined();
    expect(listing3632351!.listing.title).toBe("Baile do Forró de Pife no Glorioso Cultural");
    expect(listing3632351!.listing.local_date).toBe("2026-10-29");
    expect(listing3632351!.listing.doors_time).toBe("18:00");
    expect(listing3632351!.listing.end_time).toBe("01:00");
    expect(listing3632351!.listing.venue.name).toBe("Glorioso Cultural Bar");
    expect(listing3632351!.listing.venue.address).toBe(
      "Rua do Catete, 95 - Catete, Rio de Janeiro - RJ, 22220-001",
    );
    expect(listing3632351!.venueLocation).toEqual({
      lat: -22.9241092,
      lng: -43.1767651,
    });
    expect(listing3632351!.listing.organizer.name).toBe("Forró de Pife");
    expect(listing3632351!.eventUrl).toBe(
      "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
    );
    expect(listing3632351!.listing.cancelled).toBeNull();

    const listing3596160 = result.listings.find((l) => l.externalId === "sympla:3596160");
    expect(listing3596160).toBeDefined();
    expect(listing3596160!.listing.title).toBe(
      "Fiesta Latina ¡CHÉVERE! | Quinta-feira 29 outubro | Copacabana | TAU",
    );
    expect(listing3596160!.listing.doors_time).toBe("22:00");
    expect(listing3596160!.listing.venue.name).toBe("Tau");

    // Should have notes for the 10 unreadable pages
    expect(result.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/its page could not be read/)]),
    );
    // whole should not be true because of failures
    expect(result.whole).toBeUndefined();
  });

  it("handles cancelled event", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    const cancelledHtml = eventFixture3632351().replace('"cancelled":false', '"cancelled":true');
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj" },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: cancelledHtml,
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj"),
      run,
    );
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.listing.cancelled).toBe(true);
  });

  it("skips private event", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    const privateHtml = eventFixture3632351().replace(
      '"privateEvent":false',
      '"privateEvent":true',
    );
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj" },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: privateHtml,
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj"),
      run,
    );
    expect(result.listings).toHaveLength(0);
    expect(result.notes).toContain("1 event(s) not public left out");
  });

  it("skips an event in a non-dance Sympla category", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    const categoryHtml = eventFixture3632351().replace(
      '"privateEvent":false',
      '"privateEvent":false,"eventsCategory":{"id":5,"name":"gastronomia","slug":"gastronomia-comidas-e-bebidas"}',
    );
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj" },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: categoryHtml,
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj"),
      run,
    );
    expect(result.listings).toHaveLength(0);
    expect(result.notes).toContain("1 event(s) in a non-dance Sympla category left out");
  });

  it("keeps an event in the music category", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    const musicHtml = eventFixture3632351().replace(
      '"privateEvent":false',
      '"privateEvent":false,"eventsCategory":{"id":27,"name":"musica","slug":"musica"}',
    );
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj" },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: musicHtml,
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj"),
      run,
    );
    expect(result.listings).toHaveLength(1);
    expect(result.notes).not.toContain("non-dance Sympla category");
  });

  it("throws when list page has no event links", async () => {
    const now = new Date();
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://example.com/" },
          response: {
            url: "https://example.com/",
            status: 200,
            headers: { "content-type": "text/html" },
            body: "<html>no links</html>",
          },
        },
      ],
      now,
    );

    await expect(symplaAdapter.harvest!(source("https://example.com/"), run)).rejects.toThrow(
      "the page lists no Sympla event links",
    );
  });

  it("skips events outside window", async () => {
    const now = new Date("2026-11-20T15:00:00Z"); // far future
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj" },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
            status: 200,
            headers: { "content-type": "text/html" },
            body: listFixture(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3632351(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/fiesta-latina-chevere-quinta-feira-29-outubro-copacabana-tau/3596160",
          },
          response: {
            url: "https://www.sympla.com.br/evento/fiesta-latina-chevere-quinta-feira-29-outubro-copacabana-tau/3596160",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3596160(),
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj"),
      run,
    );
    expect(result.listings).toHaveLength(0);
    expect(result.notes).toContain("2 event(s) outside the window left out");
  });

  it("follows pagination and merges event URLs", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    // Create a minimal list fixture for page 1 with one event
    const page1Html = `
      <html>
        <a href="/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351">Event X</a>
      </html>
    `;
    // Page 2 has both X and Y
    const page2Html = `
      <html>
        <a href="/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351">Event X</a>
        <a href="/evento/fiesta-latina-chevere-quinta-feira-29-outubro-copacabana-tau/3596160">Event Y</a>
      </html>
    `;
    // Page 3 has no links
    const page3Html = `<html>no links</html>`;

    const run = ctx(
      [
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
            status: 200,
            headers: { "content-type": "text/html" },
            body: page1Html,
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=2",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=2",
            status: 200,
            headers: { "content-type": "text/html" },
            body: page2Html,
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=3",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=3",
            status: 200,
            headers: { "content-type": "text/html" },
            body: page3Html,
          },
        },
        // Event page fixtures
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3632351(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/fiesta-latina-chevere-quinta-feira-29-outubro-copacabana-tau/3596160",
          },
          response: {
            url: "https://www.sympla.com.br/evento/fiesta-latina-chevere-quinta-feira-29-outubro-copacabana-tau/3596160",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3596160(),
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje"),
      run,
    );
    // Should have 2 listings (X and Y)
    expect(result.listings).toHaveLength(2);
    expect(result.notes).toContain("read 2 list page(s)");
  });

  it("handles empty page with page >= 2 without throwing", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    const run = ctx(
      [
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=4",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=4",
            status: 200,
            headers: { "content-type": "text/html" },
            body: "<html>no links</html>",
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=4"),
      run,
    );
    expect(result.listings).toHaveLength(0);
    expect(result.notes).toContain("the page lists no Sympla event links (past the last page)");
  });

  it("does not follow pagination on non-Sympla URLs", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    const page1Html = `
      <html>
        <a href="https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351">Event X</a>
      </html>
    `;
    const run = ctx(
      [
        {
          request: { method: "GET", url: "https://example.com/list" },
          response: {
            url: "https://example.com/list",
            status: 200,
            headers: { "content-type": "text/html" },
            body: page1Html,
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3632351(),
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(source("https://example.com/list"), run);
    // Should read the one event
    expect(result.listings).toHaveLength(1);
    // Should NOT have a "read" note because pagination shouldn't be followed
    expect((result.notes ?? []).some((n) => n.startsWith("read "))).toBe(false);
  });

  it("continues when later page fetch fails", async () => {
    const now = new Date("2026-10-29T15:00:00Z");
    const page1Html = `
      <html>
        <a href="/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351">Event X</a>
      </html>
    `;
    const run = ctx(
      [
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
            status: 200,
            headers: { "content-type": "text/html" },
            body: page1Html,
          },
        },
        // No mock for page 2 -> will throw
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
          },
          response: {
            url: "https://www.sympla.com.br/evento/baile-do-forro-de-pife-no-glorioso-cultural/3632351",
            status: 200,
            headers: { "content-type": "text/html" },
            body: eventFixture3632351(),
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje"),
      run,
    );
    // Should still read event from page 1
    expect(result.listings).toHaveLength(1);
    // No note about list pages because page 2 failed
    expect((result.notes ?? []).some((n) => n.startsWith("read "))).toBe(false);
  });
});
