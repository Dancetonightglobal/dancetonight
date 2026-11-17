// D-125: the Serper gap measurement, over a stub transport (no network, no key).
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  classifyHost,
  formatGapReport,
  gapCsv,
  gapQueries,
  organicLeads,
  runSerpGap,
  SERPER_ENDPOINT,
} from "@/src/pipeline/discovery/serp-gap";
import { createPoliteHttp, type Transport } from "@/src/pipeline/http";

const NOW = new Date("2026-10-05T14:00:00Z");
const METRO = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
} as unknown as Metro;
const HELD = {
  sources: new Set(["swingplanit.example"]),
  venueSites: new Set(["nebulanewyork.com"]),
};

describe("the Serper gap's parts", () => {
  it("asks every family's phrases with the metro's name, two pages each", () => {
    const queries = gapQueries(METRO);
    expect(queries[0]).toEqual({ family: "salsa", q: "salsa social New York", page: 1 });
    expect(queries[1]).toEqual({ family: "salsa", q: "salsa social New York", page: 2 });
    expect(queries).toHaveLength(130);
  });

  it("keeps organic links and titles only, http(s) only", () => {
    const body = JSON.stringify({
      organic: [
        {
          title: "Salsa at Club X",
          link: "https://www.clubx.example/events",
          position: 1,
          snippet: "…",
        },
        { title: "bad", link: "javascript:alert(1)", position: 2 },
      ],
      peopleAlsoAsk: [{ link: "https://ignored.example/" }],
    });
    expect(organicLeads(body, { family: "salsa", q: "salsa social New York", page: 1 })).toEqual([
      {
        url: "https://www.clubx.example/events",
        title: "Salsa at Club X",
        host: "clubx.example",
        family: "salsa",
        q: "salsa social New York",
        position: 1,
      },
    ]);
    expect(organicLeads("not json", { family: "salsa", q: "x", page: 1 })).toEqual([]);
  });

  it("sorts hosts against what the deterministic path holds", () => {
    expect(classifyHost("swingplanit.example", HELD)).toBe("a source we hold");
    expect(classifyHost("nebulanewyork.com", HELD)).toBe("a seeded venue's website");
    expect(classifyHost("houseofyes.org", HELD)).toBe("another lane's");
    expect(classifyHost("www.eventbrite.com", HELD)).toBe("a platform another reader takes");
    expect(classifyHost("ra.co", HELD)).toBe("Tier D");
    expect(classifyHost("www.timeout.com", HELD)).toBe("not a venue's site");
    expect(classifyHost("clubx.example", HELD)).toBe("missed");
  });
});

describe("runSerpGap", () => {
  it("searches, sorts, probes only what is missed, and sends the key to Serper alone", async () => {
    const seen: Array<{ url: string; key?: string }> = [];
    const page = (url: string, body: string) => ({
      url,
      status: 200,
      headers: { "content-type": "text/html" },
      body,
    });
    const transport: Transport = async (req) => {
      seen.push({ url: req.url, key: req.headers["x-api-key"] });
      if (req.url === SERPER_ENDPOINT)
        return {
          url: req.url,
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organic: [
              { title: "Nebula", link: "https://www.nebulanewyork.com/events", position: 1 },
              { title: "Club X nights", link: "https://clubx.example/", position: 2 },
              { title: "Time Out", link: "https://www.timeout.com/newyork/nightlife", position: 3 },
            ],
          }),
        };
      if (req.url.endsWith("/robots.txt")) return page(req.url, "User-agent: *\nDisallow:\n");
      if (req.url === "https://clubx.example/")
        return page(req.url, '<h1>Club X</h1><a href="/events">Events</a>');
      if (req.url === "https://clubx.example/events")
        return page(req.url, "<p>October 9, 2026 Salsa</p><p>October 10, 2026 Bachata</p>");
      throw new Error(`unexpected ${req.url}`);
    };
    let t = NOW.getTime();
    const http = createPoliteHttp({
      transport,
      userAgent: "DanceTonightBot/1.0 (+https://dancetonight.vercel.app/bot)",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    });
    const report = await runSerpGap({
      metro: METRO,
      http,
      apiKey: "test-key",
      held: HELD,
      now: () => NOW,
      maxQueries: 2,
    });
    expect(report.queries).toBe(2);
    expect(report.results).toBe(6);
    expect(report.hosts.map((h) => [h.host, h.class])).toEqual([
      ["nebulanewyork.com", "a seeded venue's website"],
      ["clubx.example", "missed"],
      ["timeout.com", "not a venue's site"],
    ]);
    expect(report.hosts[1]!.probe).toMatchObject({ status: "page_only", gate: true });
    expect(report.gap).toEqual(["clubx.example"]);
    // The key goes to Serper and nowhere else; held hosts are never fetched.
    expect(seen.filter((s) => s.key).every((s) => s.url === SERPER_ENDPOINT)).toBe(true);
    expect(seen.some((s) => s.url.includes("nebulanewyork") || s.url.includes("timeout"))).toBe(
      false,
    );
    expect(formatGapReport(report)).toContain(
      "Missed hosts with a calendar a reader takes or the dance gate passes: 1 of 1.",
    );
    expect(gapCsv(report).split("\n")[2]).toBe(
      "clubx.example,missed,salsa,2,https://clubx.example/,Club X nights,page_only,https://clubx.example/events,true,true",
    );
  });
});
