// Venti (venti.live), Argentina's party ticketer, read from its sitemap like Posh (owner, 2026-10-29).
// Fixtures fetched 2026-10-29: a trimmed copy of https://venti.live/sitemap.xml and four event pages.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_VENTI_PAGES,
  VENTI_LASTMOD_DAYS,
  VENTI_SITEMAP,
  parseVentiSitemap,
  ventiAdapter,
  ventiCandidates,
} from "@/src/adapters/apis/venti";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__/venti");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const SITEMAP = read("sitemap.xml");
const PAGES: Record<string, string> = {
  "https://venti.live/evento/el-club-de-la-serpiente-30-de-octubre-the-bow-complejo-punta-carrasco-caba":
    read("event-serpiente-caba.html"),
  "https://venti.live/evento/fiesta-bresh-en-mandarine-31-de-octubre-edici-n-halloween-2": read(
    "event-bresh-mandarine.html",
  ),
  "https://venti.live/evento/akapellah-la-cruz-tour-2026-en-buenos-aires-en-niceto-club-18-a-os":
    read("event-akapellah-niceto.html"),
};
const ROSARIO_HTML = read("event-serpiente-rosario.html");

const NOW = new Date("2026-10-29T20:00:00Z");
const BA: Metro = {
  id: "m",
  slug: "buenos-aires",
  name: "Buenos Aires",
  countryCode: "AR",
  center: { lat: -34.6037, lng: -58.3816 },
  radiusKm: 25,
  tz: "America/Argentina/Buenos_Aires",
  languages: ["es"],
};
const SOURCE: Source = {
  id: "s",
  url: VENTI_SITEMAP,
  kind: "platform_api",
  trustTier: "ticketing",
  platform: "venti",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctxFor(sitemap: string, pages: Record<string, string>, seen: string[]): RunCtx {
  let t = NOW.getTime();
  return {
    metro: BA,
    now: () => new Date(t),
    env: {},
    log: () => {},
    http: createPoliteHttp({
      userAgent: "test",
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      transport: async (req: TransportRequest) => {
        seen.push(req.url);
        if (req.url === "https://venti.live/robots.txt") {
          return {
            url: req.url,
            status: 200,
            headers: {},
            body: "User-agent: *\nDisallow: /api\n",
          };
        }
        if (req.url === VENTI_SITEMAP)
          return { url: req.url, status: 200, headers: {}, body: sitemap };
        const body = pages[req.url];
        if (body !== undefined) return { url: req.url, status: 200, headers: {}, body };
        return { url: req.url, status: 404, headers: {}, body: "" };
      },
    }),
  };
}

describe("parseVentiSitemap", () => {
  it("keeps only /evento/<slug> pages, with their lastmod", () => {
    const entries = parseVentiSitemap(SITEMAP);
    expect(entries).toHaveLength(10); // the /eventos list page is dropped
    expect(entries.every((e) => e.url.startsWith("https://venti.live/evento/"))).toBe(true);
    const bresh = entries.find((e) => e.url.includes("fiesta-bresh-en-mandarine"));
    expect(bresh?.lastmod?.toISOString().slice(0, 10)).toBe("2026-10-28");
  });
});

describe("ventiCandidates", () => {
  it("keeps recent pages not named for another city, newest lastmod first", () => {
    const candidates = ventiCandidates(parseVentiSitemap(SITEMAP), NOW);
    // Dropped: rosario, necochea and punta-del-este by name; bosco (2025), pope, cabaret-voltaire and
    // moyka (lastmod over VENTI_LASTMOD_DAYS old).
    expect(candidates).toEqual([
      "https://venti.live/evento/fiesta-bresh-en-mandarine-31-de-octubre-edici-n-halloween-2",
      "https://venti.live/evento/akapellah-la-cruz-tour-2026-en-buenos-aires-en-niceto-club-18-a-os",
      "https://venti.live/evento/el-club-de-la-serpiente-30-de-octubre-the-bow-complejo-punta-carrasco-caba",
    ]);
  });
});

describe("ventiAdapter", () => {
  it("is Argentina only", () => {
    expect(ventiAdapter.id).toBe("venti");
    expect(ventiAdapter.countries).toEqual(["AR"]);
  });

  it("reads the candidates' JSON-LD and keeps events inside the metro; never touches /api", async () => {
    const seen: string[] = [];
    const result = await ventiAdapter.harvest!(SOURCE, ctxFor(SITEMAP, PAGES, seen));
    expect(seen.every((u) => !new URL(u).pathname.startsWith("/api"))).toBe(true);
    const titles = result.listings.map((l) => l.listing.title);
    expect(titles).toHaveLength(3);
    expect(titles.some((t) => /SERPIENTE/i.test(t))).toBe(true);
    expect(titles.some((t) => /Bresh/i.test(t))).toBe(true);
    expect(result.notes?.[0]).toMatch(
      /10 event pages in the sitemap; 3 recent and not another city's; 3 read; 3 events in the metro, 0 outside it, 0 without coordinates/,
    );
    expect(result.doc?.url).toBe(VENTI_SITEMAP);
  });

  it("treats Venti's 23:59 start (no time given) as the date only", async () => {
    const result = await ventiAdapter.harvest!(SOURCE, ctxFor(SITEMAP, PAGES, []));
    const serpiente = result.listings.find((l) => /SERPIENTE/i.test(l.listing.title));
    // startDate 2026-10-31T02:59:28Z is 23:59 on 30 October in Buenos Aires.
    expect(serpiente?.listing.local_date).toBe("2026-10-30");
    expect(serpiente?.listing.dancing_time).toBeNull();
    expect(serpiente?.listing.doors_time).toBeNull();
    const akapellah = result.listings.find((l) => /Akapellah/i.test(l.listing.title));
    // startDate 2026-11-01T23:00:00Z is a real time: 20:00 on 1 November.
    expect(akapellah?.listing.local_date).toBe("2026-11-01");
    // A structured start is doors unless the words say otherwise (structured.ts).
    expect(akapellah?.listing.doors_time).toBe("20:00");
  });

  it("drops an event whose coordinates are outside the metro (Rosario)", async () => {
    const url = "https://venti.live/evento/lotus-night-club";
    const sitemap = `<urlset><url><loc>${url}</loc><lastmod>2026-10-29</lastmod></url></urlset>`;
    const result = await ventiAdapter.harvest!(
      SOURCE,
      ctxFor(sitemap, { [url]: ROSARIO_HTML }, []),
    );
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(/1 read; 0 events in the metro, 1 outside it/);
  });
});

describe("constants", () => {
  it("are what the spec says", () => {
    expect(VENTI_SITEMAP).toBe("https://venti.live/sitemap.xml");
    expect(VENTI_LASTMOD_DAYS).toBe(30);
    expect(MAX_VENTI_PAGES).toBe(120);
  });
});
