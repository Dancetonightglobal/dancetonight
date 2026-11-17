import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  itemListLinks,
  readItemPages,
  withSourceStyle,
  wixEventLinks,
  xceedEventLinks,
} from "@/src/adapters/feeds/event-pages";
import { extractJsonLd } from "@/src/adapters/feeds/jsonld";
import { eventPageLinks, jsonLdItemsAdapter } from "@/src/adapters/feeds/jsonld-items";
import type { HarvestedListing, Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// Pages saved from the live sites on 2026-10-04 (__fixtures__/event-pages, trimmed to their
// JSON-LD and event links).
const DIR = path.join(__dirname, "__fixtures__/event-pages");
const fixture = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const page = (url: string, body: string, status = 200): Fixture => ({
  request: { method: "GET", url },
  response: { url, status, headers: { "content-type": "text/html" }, body },
});

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

const source = (url: string, styles: string[] = []): Source => ({
  id: "s",
  url,
  kind: "jsonld",
  trustTier: "first_party",
  platform: "jsonld_items",
  feedUrl: null,
  metroId: "m",
  styles,
  etag: null,
  lastModified: null,
  contentHash: null,
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const transport = fixtureTransport(fixtures);
  let t = now.getTime();
  return {
    metro: NYC,
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

const SWINGS = "https://www.nycswings.net";
const swingsPages = (): Fixture[] => [
  page(`${SWINGS}/robots.txt`, "User-agent: *\nDisallow: /wp-admin/\n"),
  page(`${SWINGS}/`, fixture("nycswings-home.html")),
  ...readdirSync(DIR)
    .filter((name) => name.startsWith("nycswings-e-"))
    .map((name) =>
      page(`${SWINGS}/e/${name.slice("nycswings-e-".length, -".html".length)}/`, fixture(name)),
    ),
];

const row = ({ listing }: HarvestedListing) =>
  [
    listing.local_date,
    listing.doors_time ?? listing.lesson_time ?? listing.dancing_time,
    listing.title,
  ] as const;

describe("event pages a list names, each read for its schema.org Event (D-111)", () => {
  it("takes an ItemList's event pages on the list's own site, never its breadcrumbs or videos", () => {
    const blocks = [
      {
        "@graph": [
          {
            "@type": "BreadcrumbList",
            itemListElement: [{ "@type": "ListItem", item: "https://a.example/events/" }],
          },
          {
            "@type": "ItemList",
            itemListElement: [
              { "@type": "ListItem", url: "https://www.a.example/e/salsa-social/" },
              { "@type": "ListItem", item: { url: "/events/tango-night" } },
              { "@type": "ListItem", url: "https://elsewhere.example/e/other/" },
              { "@type": "ListItem", url: "https://a.example/shop/shoes" },
              { "@type": "VideoObject", embedUrl: "https://www.youtube.com/embed/x" },
            ],
          },
        ],
      },
    ];
    expect(itemListLinks(blocks, "https://a.example/")).toEqual([
      "https://www.a.example/e/salsa-social/",
      "https://a.example/events/tango-night",
    ]);
  });

  it("finds NYC Swings' 17 event pages, and a Wix site's event pages among its videos", () => {
    expect(eventPageLinks(fixture("nycswings-home.html"), `${SWINGS}/`)).toHaveLength(17);
    const ranch = "https://www.bigappleranch.com/";
    expect(itemListLinks(extractJsonLd(fixture("bigappleranch-home.html")).blocks, ranch)).toEqual(
      [],
    );
    expect(wixEventLinks(fixture("bigappleranch-home.html"), ranch)).toEqual([
      `${ranch}event-details-registration/december-2026`,
      `${ranch}event-details-registration/november-2026-ranch`,
      `${ranch}event-details-registration/october-24-2026-ranch`,
    ]);
  });

  it("reads NYC Swings' nights from its event pages, with no model", async () => {
    const run = ctx(swingsPages(), new Date("2026-10-04T16:00:00Z"));
    const result = await jsonLdItemsAdapter.harvest!(
      source(`${SWINGS}/`, ["west_coast_swing"]),
      run,
    );
    // Never whole: House of West's page gives 10/7 and says nothing of 10/14, a night it runs.
    expect(result.whole).toBeUndefined();
    expect(result.readWithModel).toBeUndefined();
    // robots.txt, the list page and its 17 event pages.
    expect(run.requests).toHaveLength(19);
    expect(result.listings).toHaveLength(18);
    const rows = result.listings.map(row);
    expect(rows).toContainEqual([
      "2026-10-07",
      "21:00",
      "House of West – NYC’s Weekly West Coast Swing Party",
    ]);
    expect(rows).toContainEqual(["2026-10-11", "17:00", "Soul Sunday: West Coast Swing Social"]);
    // A page that gives two nights gives both.
    expect(rows.filter(([, , title]) => title === "West Coast Swing with Swingiversity")).toEqual([
      ["2026-10-09", "19:30", "West Coast Swing with Swingiversity"],
      ["2026-10-16", "19:30", "West Coast Swing with Swingiversity"],
    ]);
    const party = result.listings.find((l) => l.listing.title.startsWith("House of West"))!;
    expect(party.listing.venue).toMatchObject({ name: "Danznik Studios" });
    expect(party.listing.venue.address).toMatch(/^240 W 37th St/);
    expect(party.listing.prices.map((p) => p.amount)).toEqual([25]);
    expect(party.provenance).toMatchObject({
      method: "jsonld",
      sourceUrl: `${SWINGS}/e/house-of-west/`,
    });
  });

  it("calls a read with a page that failed partial, so it retires nothing", async () => {
    const pages = swingsPages().map((f) =>
      f.request.url.endsWith("/e/house-of-west/") ? page(f.request.url, "", 500) : f,
    );
    const result = await jsonLdItemsAdapter.harvest!(
      source(`${SWINGS}/`),
      ctx(pages, new Date("2026-10-04T16:00:00Z")),
    );
    expect(result.whole).toBeUndefined();
    expect(result.listings.some((l) => l.listing.title.startsWith("House of West"))).toBe(false);
    expect(result.notes?.some((n) => n.startsWith(`${SWINGS}/e/house-of-west/:`))).toBe(true);
  });

  it("reads Big Apple Ranch's Wix event pages", async () => {
    const RANCH = "https://www.bigappleranch.com";
    const run = ctx(
      [
        page(`${RANCH}/robots.txt`, "User-agent: *\nDisallow: /_partials*\n"),
        page(`${RANCH}/`, fixture("bigappleranch-home.html")),
        page(`${RANCH}/event-details-registration/december-2026`, "", 404),
        page(
          `${RANCH}/event-details-registration/november-2026-ranch`,
          fixture("bigappleranch-november.html"),
        ),
        page(
          `${RANCH}/event-details-registration/october-24-2026-ranch`,
          fixture("bigappleranch-october-24.html"),
        ),
      ],
      new Date("2026-10-20T16:00:00Z"),
    );
    const result = await jsonLdItemsAdapter.harvest!(source(`${RANCH}/`, ["two_step"]), run);
    expect(result.listings.map(row)).toEqual([["2026-10-24", "20:00", "October 24, 2026 Ranch"]]);
    expect(result.listings[0]!.listing.end_time).toBe("01:00");
    expect(result.listings[0]!.listing.venue.address).toBe(
      "320 W 37th St, New York, NY 10018, USA",
    );
    // December's page answered 404: the read is partial.
    expect(result.whole).toBeUndefined();
  });

  it("hands a page with no event pages and no events to the model", async () => {
    const SITE = "https://plain.example";
    const result = await jsonLdItemsAdapter.harvest!(
      source(`${SITE}/`),
      ctx(
        [
          page(`${SITE}/robots.txt`, "User-agent: *\nDisallow:\n"),
          page(`${SITE}/`, "<html><body><p>Socials on Fridays.</p></body></html>"),
        ],
        new Date("2026-10-04T16:00:00Z"),
      ),
    );
    expect(result.readWithModel).toBe("the page names no event pages and carries no event");
    expect(result.listings).toEqual([]);
  });

  it("files a dance organiser's DJ night under its dance, and leaves a club's alone", () => {
    const listing = (styles: string[]) => ({ listing: { styles } }) as unknown as HarvestedListing;
    expect(withSourceStyle(listing(["dj_night"]), ["lindy_hop"]).listing.styles).toEqual([
      "lindy_hop",
    ]);
    expect(withSourceStyle(listing(["dj_night", "salsa"]), ["lindy_hop"]).listing.styles).toEqual([
      "dj_night",
      "salsa",
    ]);
    expect(withSourceStyle(listing(["dj_night"]), ["dj_night"]).listing.styles).toEqual([
      "dj_night",
    ]);
    expect(withSourceStyle(listing(["dj_night"]), []).listing.styles).toEqual(["dj_night"]);
    expect(withSourceStyle(listing([]), ["lindy_hop"]).listing.styles).toEqual([]);
  });

  it("calls a read partial when a page answers with no Event and nothing stands in for it", async () => {
    const SITE = "https://series.example";
    const event = `<script type="application/ld+json">{"@type":"Event","name":"Social","startDate":"2026-10-05T20:00:00-04:00","location":{"@type":"Place","name":"Hall","address":"1 Main St, New York, NY"}}</script>`;
    const read = (challenge: string) =>
      readItemPages(
        [
          { url: `${SITE}/e/social/`, night: null },
          { url: `${SITE}/e/other/`, night: null },
        ],
        ctx(
          [
            page(`${SITE}/robots.txt`, "User-agent: *\nDisallow:\n"),
            page(`${SITE}/e/social/`, event),
            page(`${SITE}/e/other/`, challenge),
          ],
          new Date("2026-10-04T16:00:00Z"),
        ),
        { fromNight: "2026-10-04" },
      );
    // A challenge page answers 200 and carries no Event.
    const partial = await read("<html><body>Just a moment...</body></html>");
    expect(partial.listings).toHaveLength(1);
    expect(partial.whole).toBe(false);
    expect((await read(event.replace("Social", "Other"))).whole).toBe(true);
  });

  it("reads a span that began over a week ago and runs into the window, and skips one that ended", async () => {
    const SITE = "https://span.example";
    const run = ctx(
      [
        page(`${SITE}/robots.txt`, "User-agent: *\nDisallow:\n"),
        page(
          `${SITE}/events/festival`,
          `<script type="application/ld+json">{"@type":"Event","name":"Fall Festival","startDate":"2026-10-06T20:00:00-04:00","location":{"@type":"Place","name":"Hall","address":"1 Main St, New York, NY"}}</script>`,
        ),
      ],
      new Date("2026-10-04T16:00:00Z"),
    );
    const read = await readItemPages(
      [
        { url: `${SITE}/events/festival`, night: "2026-09-20", endDay: "2026-10-10" },
        { url: `${SITE}/events/summer`, night: "2026-08-01", endDay: "2026-09-01" },
      ],
      run,
      { fromNight: "2026-10-04" },
    );
    expect(run.requests).toEqual([`GET ${SITE}/robots.txt`, `GET ${SITE}/events/festival`]);
    expect(read.listings).toHaveLength(1);
    expect(read.whole).toBe(true);
  });

  it("dedupes a night on both the list page and its own page by night key, not just externalId", async () => {
    const SITE = "https://list.example";
    const listHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "ItemList",
              "itemListElement": [
                { "@type": "ListItem", "url": "${SITE}/e/social/" }
              ]
            },
            {
              "@id": "${SITE}/e/social/#event-2026-10-14",
              "@type": "Event",
              "name": "Salsa Social",
              "startDate": "2026-10-14T20:00:00-04:00",
              "location": {
                "@type": "Place",
                "name": "Solas",
                "address": "232 E 9th St, New York, NY 10003"
              }
            },
            {
              "@id": "${SITE}/e/social/#event-2026-10-21",
              "@type": "Event",
              "name": "Salsa Social",
              "startDate": "2026-10-21T20:00:00-04:00",
              "location": {
                "@type": "Place",
                "name": "Solas",
                "address": "232 E 9th St, New York, NY 10003"
              }
            }
          ]
        }
      </script>
    `;
    const eventHtml = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@id": "${SITE}/e/social/#main",
              "@type": "Event",
              "name": "Salsa Social",
              "startDate": "2026-10-14T20:00:00-04:00",
              "location": {
                "@type": "Place",
                "name": "Solas",
                "address": "232 E 9th St, New York, NY 10003"
              }
            }
          ]
        }
      </script>
    `;
    const run = ctx(
      [
        page(`${SITE}/robots.txt`, "User-agent: *\nDisallow:\n"),
        page(`${SITE}/`, listHtml),
        page(`${SITE}/e/social/`, eventHtml),
      ],
      new Date("2026-10-14T16:00:00Z"),
    );
    const result = await jsonLdItemsAdapter.harvest!(source(`${SITE}/`), run);
    // Should have exactly 2 listings: 2026-10-14 (from the event page) and 2026-10-21 (from the list page).
    expect(result.listings).toHaveLength(2);
    const rows = result.listings.map((l) => [l.listing.local_date, l.provenance.sourceUrl]);
    expect(rows).toContainEqual(["2026-10-14", `${SITE}/e/social/`]);
    expect(rows).toContainEqual(["2026-10-21", `${SITE}/`]);
    // Ensure no duplicate for 2026-10-14.
    const oct14 = result.listings.filter((l) => l.listing.local_date === "2026-10-14");
    expect(oct14).toHaveLength(1);
    expect(oct14[0]!.provenance.sourceUrl).toBe(`${SITE}/e/social/`);
  });

  it("xceedEventLinks returns Xceed event URLs", () => {
    const html = `
      <a href="/en/barcelona/event/deep-tech-house-by-navider-32/245329"><div>x</div></a>
      <a class="c" href="/en/barcelona/event/deep-tech-house-by-navider-32/245329">dup</a>
      <script>{"u":"/en/barcelona/event/loud-contact-x-delirium-presents-voral-festival/244904\\"}</script>
      <a href="https://xceed.me/en/barcelona/venue/slow-club">venue</a>
      <a href="https://other.example/en/barcelona/event/foo/1">other</a>
    `;
    const pageUrl = "https://xceed.me/en/barcelona/events";
    const links = xceedEventLinks(html, pageUrl);
    expect(links).toEqual([
      "https://xceed.me/en/barcelona/event/deep-tech-house-by-navider-32/245329",
      "https://xceed.me/en/barcelona/event/loud-contact-x-delirium-presents-voral-festival/244904",
    ]);
  });

  it("xceedEventLinks returns empty array for non-Xceed host", () => {
    const html = `<a href="/en/barcelona/event/deep-tech-house-by-navider-32/245329">x</a>`;
    const pageUrl = "https://nyc.example/events";
    const links = xceedEventLinks(html, pageUrl);
    expect(links).toEqual([]);
  });

  it("eventPageLinks includes Xceed URLs", () => {
    const html = `
      <a href="/en/barcelona/event/deep-tech-house-by-navider-32/245329">x</a>
      <script type="application/ld+json">{"@type":"ItemList","itemListElement":[]}</script>
    `;
    const pageUrl = "https://xceed.me/en/barcelona/events";
    const links = eventPageLinks(html, pageUrl);
    expect(links).toContain(
      "https://xceed.me/en/barcelona/event/deep-tech-house-by-navider-32/245329",
    );
  });
});
