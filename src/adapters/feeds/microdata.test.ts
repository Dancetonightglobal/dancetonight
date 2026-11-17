// Contract test for D-858: schema.org Event microdata (Ball & Chain's Webflow /events page) read as
// JSON-LD-shaped Event nodes, and the JSON-LD adapter falling back to them when a page has no JSON-LD Event.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { jsonLdAdapter } from "@/src/adapters/feeds/jsonld";
import { microdataEvents } from "@/src/adapters/feeds/microdata";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";

const HTML = readFileSync(path.join(__dirname, "__fixtures__/ballandchain-events.html"), "utf8");
const PAGE = "https://ballandchainmiami.com/events";
const NOW = new Date("2026-11-11T16:00:00Z");

const MIAMI: Metro = {
  id: "m",
  slug: "miami",
  name: "Miami",
  countryCode: "US",
  center: { lat: 25.7617, lng: -80.1918 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

const SOURCE: Source = {
  id: "s",
  url: PAGE,
  kind: "jsonld",
  trustTier: "first_party",
  platform: null,
  feedUrl: null,
  metroId: "m",
  styles: ["salsa"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctxWith(fixtures: Fixture[]): RunCtx {
  let t = NOW.getTime();
  return {
    metro: MIAMI,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport(fixtures),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    }),
    env: {},
    log: () => {},
  };
}

const FIXTURES: Fixture[] = [
  {
    request: { method: "GET", url: "https://ballandchainmiami.com/robots.txt" },
    response: {
      url: "https://ballandchainmiami.com/robots.txt",
      status: 200,
      headers: {},
      body: "",
    },
  },
  {
    request: { method: "GET", url: PAGE },
    response: { url: PAGE, status: 200, headers: { "content-type": "text/html" }, body: HTML },
  },
];

const SABOR_TICKETS = "https://speakeasygo.com/ball-and-chain/Sabor-Wednesday?eid=EVE-20ZKGK";

describe("microdataEvents", () => {
  const nodes = microdataEvents(HTML, PAGE);

  it("reads each dated, named Event scope in page order, and nothing else", () => {
    expect(nodes.map((n) => n.name)).toEqual([
      "The Ball & Chain Trio",
      "Closed for Private Event",
      "Sabor Wednesday",
      "La Pachanga",
      "Mambo Monday",
    ]);
    for (const node of nodes) expect(node["@type"]).toBe("Event");
  });

  it("writes data-raw and datetime clocks as ISO local times, padding the hour", () => {
    const sabor = nodes.find((n) => n.name === "Sabor Wednesday")!;
    expect(sabor.startDate).toBe("2026-11-11T22:00:00");
    expect(sabor.endDate).toBe("2026-11-12T01:00:00");
    const mambo = nodes.find((n) => n.name === "Mambo Monday")!;
    expect(mambo.startDate).toBe("2026-11-16T20:00:00");
    expect(mambo.endDate).toBeUndefined();
  });

  it("keeps nested scopes' properties in their own nodes", () => {
    const trio = nodes[0]!;
    expect(trio).toMatchObject({
      name: "The Ball & Chain Trio",
      description:
        "The Ball & Chain Trio at Ball & Chain, the live music bar and lounge on Calle Ocho in Little Havana, Miami, FL.",
      location: {
        "@type": "Place",
        name: "Ball & Chain",
        address: {
          "@type": "PostalAddress",
          streetAddress: "1513 SW 8th Street",
          addressLocality: "Miami",
          addressRegion: "FL",
          postalCode: "33135",
          addressCountry: "US",
        },
      },
      offers: {
        "@type": "Offer",
        url: "https://speakeasygo.com/ball-and-chain/The-Ball-%26-Chain-Trio?eid=EVE-KISNKK",
      },
      organizer: {
        "@type": "Organization",
        name: "Ball & Chain",
        url: "https://ballandchainmiami.com/",
      },
    });
    const pachanga = nodes.find((n) => n.name === "La Pachanga")!;
    expect(pachanga.location).toMatchObject({ "@type": "Place", name: "Ball & Chain" });
  });

  it("decodes entities in content, sets no url of its own, and ids each event by its ticket link", () => {
    const sabor = nodes.find((n) => n.name === "Sabor Wednesday")!;
    expect(sabor.description).toBe(
      "Sabor Wednesday at Ball & Chain: live salsa band and a free salsa class.",
    );
    expect(sabor.url).toBeUndefined();
    expect(sabor["@id"]).toBe(SABOR_TICKETS);
  });

  it("drops non-http(s) links and falls back to a page-based id", () => {
    const mambo = nodes.find((n) => n.name === "Mambo Monday")!;
    const offers = mambo.offers as Record<string, unknown> | undefined;
    expect(offers?.url).toBeUndefined();
    expect(mambo["@id"]).toBe(`${PAGE}#Mambo Monday|2026-11-16T20:00:00`);
  });

  it("returns nothing for a page with no Event microdata", () => {
    expect(microdataEvents("<html><body><p>No events</p></body></html>", PAGE)).toEqual([]);
    expect(microdataEvents("", PAGE)).toEqual([]);
  });
});

describe("the JSON-LD adapter on a microdata-only page (D-858)", () => {
  it("reads the microdata Events into timed listings at the venue", async () => {
    const result = await jsonLdAdapter.harvest!(SOURCE, ctxWith(FIXTURES));
    expect(result.notes ?? []).not.toContain("no schema.org events on the page");
    const titles = result.listings.map((l) => l.listing.title);
    expect(titles).toEqual(
      expect.arrayContaining(["The Ball & Chain Trio", "Sabor Wednesday", "La Pachanga"]),
    );
    // An Event with no location reads as online only, as for JSON-LD.
    expect(result.notes).toContain("online only, skipped: Mambo Monday");
    const sabor = result.listings.find((l) => l.listing.title === "Sabor Wednesday")!;
    const outcome = normalizeListing(sabor, { metro: MIAMI, source: SOURCE, now: NOW });
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.untimed).toBe(false);
    expect(outcome.event).toMatchObject({
      nightDate: "2026-11-11",
      ticketUrl: SABOR_TICKETS,
      venue: { name: "Ball & Chain" },
    });
    expect(outcome.event.startsAt?.toISOString()).toBe("2026-11-12T03:00:00.000Z");
    expect(outcome.event.endsAt?.toISOString()).toBe("2026-11-12T06:00:00.000Z");
  });

  it("reads the same microdata page as unchanged on the next visit", async () => {
    const first = await jsonLdAdapter.harvest!(SOURCE, ctxWith(FIXTURES));
    const second = await jsonLdAdapter.harvest!(
      { ...SOURCE, contentHash: first.doc!.contentHash },
      ctxWith(FIXTURES),
    );
    expect(second.unchanged).toBe(true);
  });
});
