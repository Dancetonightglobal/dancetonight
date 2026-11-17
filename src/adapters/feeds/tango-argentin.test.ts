import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Source } from "@/src/adapters/types";
import {
  tangoArgentinAdapter,
  parseTangoArgentinFeed,
  parseTangoArgentinAgenda,
  type TangoArgentinItem,
} from "@/src/adapters/feeds/tango-argentin";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const NOW = new Date("2026-11-06T08:00:00Z");
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
  id: "tango",
  url: "https://tango-argentin.fr/daymilongas",
  kind: "jsonld",
  trustTier: "first_party",
  platform: "tango_argentin",
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
      request: { method: "GET", url: "https://tango-argentin.fr/robots.txt" },
      response: {
        url: "https://tango-argentin.fr/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
      },
    },
    {
      request: {
        method: "GET",
        url: "https://tango-argentin.fr/daymilongas",
      },
      response: {
        url: "https://tango-argentin.fr/daymilongas",
        status: 200,
        headers: { "content-type": "application/rss+xml" },
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

describe("parseTangoArgentinFeed", () => {
  it("returns 7 items with correct fields", () => {
    const xml = fixture("tango-argentin/daymilongas-2026-11-06.xml");
    const items = parseTangoArgentinFeed(xml);
    expect(items).toHaveLength(7);
    const paradis = items.find((i) => i.title?.includes("Paradis"));
    expect(paradis?.date).toBe("2026-11-06");
    expect(paradis?.time).toBe("20:00");
    expect(paradis?.address).toBe("64 rue Orfila 75020 Paris");
    expect(paradis?.link).toBe(
      "https://tango-argentin.fr/paris/milonga-le-paradis-au-studio-gambetta.html",
    );
    expect(paradis?.when).toBe("vendredi 6 novembre 2026 20h00");
  });

  it("handles time formats: 9h30 -> 09:30, 20h -> 20:00", () => {
    // Test with custom XML
    const xml = `
      <rss>
        <item>
          <title>Test</title>
          <link>https://example.com</link>
          <guid>test</guid>
          <description>
            &lt;ul&gt;
            &lt;li&gt;Rendez-vous : mardi 1 décembre 2026 9h30&lt;/li&gt;
            &lt;li&gt;Adresse : test&lt;/li&gt;
            &lt;li&gt;Infos : test&lt;/li&gt;
            &lt;/ul&gt;
          </description>
        </item>
      </rss>
    `;
    const items = parseTangoArgentinFeed(xml);
    expect(items[0]?.date).toBe("2026-12-01");
    expect(items[0]?.time).toBe("09:30");
  });

  it("Amigos Del Tango address has no leading space", () => {
    const xml = fixture("tango-argentin/daymilongas-2026-11-06.xml");
    const items = parseTangoArgentinFeed(xml);
    const amigos = items.find((i) => i.title?.includes("Amigos"));
    expect(amigos?.address).toBe("11 Rue de la Montagne d Aulas 75015 Paris");
  });
});

describe("harvest", () => {
  it("with now = 2026-11-06T08:00Z, metro Paris: 6 listings (Arles skipped)", async () => {
    const xml = fixture("tango-argentin/daymilongas-2026-11-06.xml");
    const run = ctx(xml);
    const result = await tangoArgentinAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(6);
    expect(result.notes).toContain("1 item(s) outside Ile-de-France skipped");
    // Check that styles include tango
    for (const listing of result.listings) {
      expect(listing.listing.styles).toContain("tango");
    }
    // Find the 20:00 item
    const paradis = result.listings.find((l) => l.listing.title?.includes("Paradis"));
    expect(paradis?.listing.doors_time).toBe("20:00");
    expect(paradis?.listing.local_date).toBe("2026-11-06");
  });

  it("with now = 2026-11-08T08:00Z: 0 listings (all dated before window)", async () => {
    const xml = fixture("tango-argentin/daymilongas-2026-11-06.xml");
    const run = ctx(xml);
    // Override now to be later
    const originalNow = run.now;
    run.now = () => new Date("2026-11-08T08:00:00Z");
    const result = await tangoArgentinAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(0);
  });

  it("gives the same item on two dates two external ids", async () => {
    const xml = fixture("tango-argentin/daymilongas-2026-11-06.xml");
    const nextDay = xml.replace(/vendredi\s+6 novembre 2026/g, "samedi 7 novembre 2026");
    const first = await tangoArgentinAdapter.harvest!(SOURCE, ctx(xml));
    const second = await tangoArgentinAdapter.harvest!(SOURCE, ctx(nextDay));
    const id = (r: typeof first) =>
      r.listings.find((l) => l.listing.title?.includes("Cnit"))?.externalId;
    expect(id(first)).toBe("https://tango-argentin.fr/ud8on31ip8lb686ckhpmuodfco:2026-11-06");
    expect(id(second)).toBe("https://tango-argentin.fr/ud8on31ip8lb686ckhpmuodfco:2026-11-07");
  });

  it("throws on non-RSS feed", async () => {
    const run = ctx("<html>not rss</html>");
    await expect(tangoArgentinAdapter.harvest!(SOURCE, run)).rejects.toThrow(
      "not a tango-argentin.fr feed or agenda page",
    );
  });

  describe("parseTangoArgentinAgenda", () => {
    it("returns 35 items: 11 on 2026-11-07, 15 on 2026-11-08, 4 on 2026-11-09, 5 on 2026-11-10", () => {
      const html = fixture("tango-argentin/ile-de-france-2026-11-07.html");
      const items = parseTangoArgentinAgenda(html);
      expect(items).toHaveLength(35);
      const byDate = items.reduce(
        (acc, item) => {
          const date = item.date!;
          acc[date] = (acc[date] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      expect(byDate["2026-11-07"]).toBe(11);
      expect(byDate["2026-11-08"]).toBe(15);
      expect(byDate["2026-11-09"]).toBe(4);
      expect(byDate["2026-11-10"]).toBe(5);
    });

    it("first 2026-11-09 item: title Sensation Milonga, link correct, time 20:00, endTime 00:30, address correct, info contains DJ", () => {
      const html = fixture("tango-argentin/ile-de-france-2026-11-07.html");
      const items = parseTangoArgentinAgenda(html);
      const nov9Items = items.filter((item) => item.date === "2026-11-09");
      expect(nov9Items.length).toBeGreaterThan(0);
      const first = nov9Items[0];
      if (!first) throw new Error("No first item found");
      expect(first.title).toBe("Sensation Milonga");
      expect(first.link).toBe("https://tango-argentin.fr/paris/sensation-milonga.html");
      expect(first.time).toBe("20:00");
      expect(first.endTime).toBe("00:30");
      expect(first.address).toBe("105 rue de Tolbiac 75013 Paris");
      expect(first.info).toContain("Claudio Coppola");
    });

    it("Pratique de la Sourdiere address is CEASC 23 rue de la Sourdiere 75001 Paris", () => {
      const html = fixture("tango-argentin/ile-de-france-2026-11-07.html");
      const items = parseTangoArgentinAgenda(html);
      const pratique = items.find((item) => item.title?.includes("Pratique de la Sourdiere"));
      expect(pratique?.address).toBe("CEASC 23 rue de la Sourdiere 75001 Paris");
    });
  });

  describe("harvest with agenda page", () => {
    it("with now = 2026-11-07T08:00:00Z, metro Paris: 34 listings (35 minus 1 duplicate), notes contain duplicate skip", async () => {
      const html = fixture("tango-argentin/ile-de-france-2026-11-07.html");
      const run = ctx(html);
      const result = await tangoArgentinAdapter.harvest!(SOURCE, run);
      expect(result.listings).toHaveLength(34);
      expect(result.notes).toContain("1 duplicate row(s) skipped");
      for (const listing of result.listings) {
        expect(listing.listing.styles).toContain("tango");
      }
      const neolonga = result.listings.find((l) => l.listing.title?.includes("Neolonga"));
      expect(neolonga?.listing.doors_time).toBe("20:30");
      expect(neolonga?.listing.local_date).toBe("2026-11-07");
      expect(neolonga?.listing.end_time).toBe("02:00");
      const comuna = result.listings.find((l) => l.listing.title?.includes("La Comuna"));
      expect(comuna?.listing.local_date).toBe("2026-11-09");
    });

    it("with now = 2026-11-10T08:00:00Z: only the 5 Tuesday rows", async () => {
      const html = fixture("tango-argentin/ile-de-france-2026-11-07.html");
      const run = ctx(html);
      // Override now to be later
      const originalNow = run.now;
      run.now = () => new Date("2026-11-10T08:00:00Z");
      const result = await tangoArgentinAdapter.harvest!(SOURCE, run);
      expect(result.listings).toHaveLength(5);
      // All should be on 2026-11-10
      for (const listing of result.listings) {
        expect(listing.listing.local_date).toBe("2026-11-10");
      }
    });

    it("Listings for Quais de Seine on different dates get different external ids", async () => {
      const html = fixture("tango-argentin/ile-de-france-2026-11-07.html");
      const run = ctx(html);
      const result = await tangoArgentinAdapter.harvest!(SOURCE, run);
      const quais = result.listings.filter((l) => l.listing.title?.includes("Quais de Seine"));
      // There should be at least two listings on different dates
      expect(quais.length).toBeGreaterThanOrEqual(2);
      const ids = quais.map((l) => l.externalId).sort();
      // All external ids should be unique
      expect(new Set(ids).size).toBe(ids.length);
      // Each external id should follow the pattern
      ids.forEach((id) => {
        expect(id).toMatch(
          /^https:\/\/tango-argentin\.fr\/paris\/quais-de-seine\.html:\d{4}-\d{2}-\d{2}$/,
        );
      });
      // The two expected dates should be present
      expect(ids).toContain("https://tango-argentin.fr/paris/quais-de-seine.html:2026-11-07");
      expect(ids).toContain("https://tango-argentin.fr/paris/quais-de-seine.html:2026-11-08");
    });

    it("body with neither <rss nor agenda heading throws", async () => {
      const run = ctx("<html>nothing</html>");
      await expect(tangoArgentinAdapter.harvest!(SOURCE, run)).rejects.toThrow(
        "not a tango-argentin.fr feed or agenda page",
      );
    });

    it("agenda page with no rows throws", async () => {
      const html = fixture("tango-argentin/ile-de-france-2026-11-07.html").replace(
        /location\.href=/g,
        "x=",
      );
      const run = ctx(html);
      await expect(tangoArgentinAdapter.harvest!(SOURCE, run)).rejects.toThrow(
        "tango-argentin.fr agenda page had no rows",
      );
    });
  });
});
