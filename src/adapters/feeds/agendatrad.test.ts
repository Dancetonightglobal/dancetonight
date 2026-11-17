import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Source } from "@/src/adapters/types";
import {
  agendatradAdapter,
  parseAgendatradList,
  parseAgendatradAddress,
} from "@/src/adapters/feeds/agendatrad";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const NOW = new Date("2026-11-10T08:00:00Z");
const PARIS = {
  id: "paris",
  slug: "paris",
  name: "Paris",
  countryCode: "FR",
  center: { lat: 48.8566, lng: 2.3522 },
  radiusKm: 50,
  tz: "Europe/Paris",
  languages: ["fr"],
};

const SOURCE: Source = {
  id: "agendatrad",
  url: "https://agendatrad.org/calendar/France/Ile-de-France",
  kind: "html",
  trustTier: "first_party",
  platform: "agendatrad",
  feedUrl: null,
  metroId: "paris",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctx(fixtureBody: string, extraFixtures: Fixture[] = []) {
  const baseFixtures: Fixture[] = [
    {
      request: { method: "GET", url: "https://agendatrad.org/robots.txt" },
      response: {
        url: "https://agendatrad.org/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
      },
    },
    {
      request: {
        method: "GET",
        url: "https://agendatrad.org/calendar/France/Ile-de-France",
      },
      response: {
        url: "https://agendatrad.org/calendar/France/Ile-de-France",
        status: 200,
        headers: { "content-type": "text/html" },
        body: fixtureBody,
      },
    },
  ];
  const transport = fixtureTransport([...baseFixtures, ...extraFixtures]);
  let t = NOW.getTime();
  return {
    metro: PARIS,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "t",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
  };
}

describe("parseAgendatradList", () => {
  it("returns 23 rows from 25 raw blocks (two multi-day repeats deduplicated)", () => {
    const html = fixture("agendatrad/calendar-idf-2026-11-10.html");
    const rows = parseAgendatradList(html);
    expect(rows).toHaveLength(23);
    const wz8jkggq = rows.find((r) => r.id === "wz8jkggq");
    expect(wz8jkggq).toBeDefined();
    expect(wz8jkggq?.url).toBe(
      "https://agendatrad.org/e_2026-11/bal-folk-dansequivive-groupe-invite-dret.wz8jkggq",
    );
    expect(wz8jkggq?.title).toBe("Bal folk avec DanseQuiVive et le groupe invité En'K'Dret");
    expect(wz8jkggq?.types).toEqual(["Bal trad / Bal folk"]);
    expect(wz8jkggq?.city).toBe("Vitry-Sur-Seine");
    expect(wz8jkggq?.dept).toBe("94");
    expect(wz8jkggq?.start).toBe("2026-11-11T19:30");
    expect(wz8jkggq?.endTime).toBe("22:00");
    expect(wz8jkggq?.timeText).toBe("le 11 novembre 2026 de 19:30 à 22:00");
    const nvzgrr7k = rows.find((r) => r.id === "nvzgrr7k");
    expect(nvzgrr7k?.endTime).toBeNull();
  });
});

describe("parseAgendatradAddress", () => {
  it("extracts address, venue name, location from event page", () => {
    const html = fixture("agendatrad/event-bal-folk-dansequivive.html");
    const result = parseAgendatradAddress(html);
    expect(result.address).toBe("18, Rue Auber, 94400 Vitry-sur-Seine");
    expect(result.venueName).toBe("Salle Auber");
    expect(result.location).toEqual({ lat: 48.8007, lng: 2.3769 });
  });

  it("returns all null when no <address>", () => {
    const result = parseAgendatradAddress("<html>no address</html>");
    expect(result.address).toBeNull();
    expect(result.venueName).toBeNull();
    expect(result.location).toBeNull();
  });
});

describe("harvest", () => {
  it("with now = 2026-11-10T08:00Z, page1 fixture, event page fixture, other pages 404", async () => {
    const calendarHtml = fixture("agendatrad/calendar-idf-2026-11-10.html");
    const eventHtml = fixture("agendatrad/event-bal-folk-dansequivive.html");
    // Build extra fixtures: event pages for the 11 expected rows
    const expectedIds = [
      "wz8jkggq",
      "68wzsh7j",
      "hm2sxpvx",
      "pwr6gnbf",
      "928685yr",
      "rzb6pj2p",
      "c98ksktj",
      "z62mx5qj",
      "fdhkrctn",
      "xyrm8w7f",
      "m2d62f5b",
    ];
    const extraFixtures: Fixture[] = [];
    for (const id of expectedIds) {
      const url = `https://agendatrad.org/e_2026-11/${id}.html`; // simplified
      extraFixtures.push({
        request: { method: "GET", url },
        response: {
          url,
          status: 404,
          headers: { "content-type": "text/html" },
          body: "<html>Not Found</html>",
        },
      });
    }
    // Override wz8jkggq with correct fixture
    const wz8Url =
      "https://agendatrad.org/e_2026-11/bal-folk-dansequivive-groupe-invite-dret.wz8jkggq";
    const wz8Index = extraFixtures.findIndex((f) => f.request.url.includes("wz8jkggq"));
    if (wz8Index >= 0) {
      extraFixtures[wz8Index] = {
        request: { method: "GET", url: wz8Url },
        response: {
          url: wz8Url,
          status: 200,
          headers: { "content-type": "text/html" },
          body: eventHtml,
        },
      };
    }
    // Page 2 404
    extraFixtures.push({
      request: {
        method: "GET",
        url: "https://agendatrad.org/calendar/France/Ile-de-France?page=2",
      },
      response: {
        url: "https://agendatrad.org/calendar/France/Ile-de-France?page=2",
        status: 404,
        headers: { "content-type": "text/html" },
        body: "<html>Not Found</html>",
      },
    });

    const run = ctx(calendarHtml, extraFixtures);
    const result = await agendatradAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(11);
    expect(result.listings.map((l) => l.externalId)).toEqual([
      "agendatrad:wz8jkggq:2026-11-11",
      "agendatrad:68wzsh7j:2026-11-14",
      "agendatrad:hm2sxpvx:2026-11-14",
      "agendatrad:pwr6gnbf:2026-11-14",
      "agendatrad:928685yr:2026-11-14",
      "agendatrad:rzb6pj2p:2026-11-15",
      "agendatrad:c98ksktj:2026-11-20",
      "agendatrad:z62mx5qj:2026-11-21",
      "agendatrad:fdhkrctn:2026-11-21",
      "agendatrad:xyrm8w7f:2026-11-21",
      "agendatrad:m2d62f5b:2026-11-22",
    ]);
    const wz8 = result.listings.find((l) => l.externalId === "agendatrad:wz8jkggq:2026-11-11");
    expect(wz8?.listing.venue?.name).toBe("Salle Auber");
    expect(wz8?.listing.venue?.address).toBe("18, Rue Auber, 94400 Vitry-sur-Seine");
    expect(wz8?.listing.end_time).toBe("22:00");
    // Check evidence start
    expect(wz8?.listing.evidence?.start).toBe("le 11 novembre 2026 de 19:30 à 22:00");
    const hm2 = result.listings.find((l) => l.externalId === "agendatrad:hm2sxpvx:2026-11-14");
    expect(hm2?.listing.end_time).toBe("00:30");
    expect(hm2?.listing.local_date).toBe("2026-11-14");
    const pwr = result.listings.find((l) => l.externalId === "agendatrad:pwr6gnbf:2026-11-14");
    expect(pwr?.listing.venue?.address).toBe("Taverny (95)");
    for (const listing of result.listings) {
      expect(listing.listing.styles).toContain("folk");
    }
    expect(result.notes?.some((n) => /10 event page\(s\) unread/.test(n))).toBe(true);
    // Check note about page 2 failure
    expect(result.notes?.some((n) => /page 2 failed/.test(n))).toBe(true);
  });

  it("throws when page 1 has no event rows", async () => {
    const run = ctx("<html>no events</html>");
    await expect(agendatradAdapter.harvest!(SOURCE, run)).rejects.toThrow(
      "AgendaTrad calendar page had no event rows",
    );
  });

  it("skips row with dept 45 (outside Ile-de-France)", async () => {
    const html = `
      <div class=event id=event_test>
        <h4><a class=event_title href="/e_2026-11/test">Test</a></h4>
        <p><span class="badge badge-event_types">Bal trad / Bal folk</span>
        <p class=event_city> City <small>(45)</small>, <time datetime=2026-11-11T19:30:00+01:00>le 11 novembre 2026</time>
      </div>
    `;
    const run = ctx(html);
    const result = await agendatradAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(0);
  });

  it("never follows an off-site event link: no page read there, the list URL is the event URL", async () => {
    const html = `
      <div class=event id=event_evil0001>
        <h4 class=event_title><a class=event_title href=https://evil.example/e_2026-11/bal.evil0001>Bal folk</a></h4>
        <p><span class="badge badge-event_types">Bal trad / Bal folk</span>
        <p class=event_city> Paris <small>(75)</small>, <time datetime=2026-11-11T20:00:00+01:00>le 11 novembre 2026 de 20:00 à 23:00</time>
      </div>
    `;
    expect(parseAgendatradList(html)[0]?.url).toBeNull();
    const served = (url: string, body: string, type: string): Fixture => ({
      request: { method: "GET", url },
      response: { url, status: 200, headers: { "content-type": type }, body },
    });
    const run = ctx(html, [
      served("https://evil.example/robots.txt", "User-agent: *\nAllow: /\n", "text/plain"),
      served(
        "https://evil.example/e_2026-11/bal.evil0001",
        "<address><span>1 Rue Fausse</span><br><span>75001</span> <span>Paris</span></address>",
        "text/html",
      ),
    ]);
    const result = await agendatradAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.venue?.address).toBe("Paris (75)");
    expect(result.listings[0]?.eventUrl).toBe(SOURCE.url);
  });

  it("page 1 HTTP 500 -> harvest rejects", async () => {
    const transport = fixtureTransport([
      {
        request: { method: "GET", url: "https://agendatrad.org/robots.txt" },
        response: {
          url: "https://agendatrad.org/robots.txt",
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nAllow: /\n",
        },
      },
      {
        request: {
          method: "GET",
          url: "https://agendatrad.org/calendar/France/Ile-de-France",
        },
        response: {
          url: "https://agendatrad.org/calendar/France/Ile-de-France",
          status: 500,
          headers: { "content-type": "text/html" },
          body: "<html>Internal Server Error</html>",
        },
      },
    ]);
    let t = NOW.getTime();
    const run = {
      metro: PARIS,
      now: () => new Date(t),
      http: createPoliteHttp({
        transport,
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
      env: {},
      log: () => {},
    };
    await expect(agendatradAdapter.harvest!(SOURCE, run)).rejects.toThrow();
  });
});
