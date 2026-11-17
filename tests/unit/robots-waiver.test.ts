// D-831: a site whose owner gave written permission is read although its robots.txt disallows us
// (AgendaTrad, Paris: "User-agent: * / Disallow: /", permission via the owner 2026-11-10). Only the robots
// check is waived, only on that seed's own host; spacing, the User-Agent and the blocklist stay.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createPoliteHttp,
  HttpError,
  type TransportRequest,
  type TransportResponse,
} from "@/src/pipeline/http";
import { robotsWaivedHosts, robotsWaiverLines } from "@/src/pipeline/robots-waiver";
import { METRO_SOURCES } from "@/config/sources";

const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";

function setup(waived?: ReadonlySet<string>) {
  const requests: TransportRequest[] = [];
  const sleeps: number[] = [];
  let clock = 1_000_000;
  const transport = async (req: TransportRequest): Promise<TransportResponse> => {
    requests.push(req);
    if (req.url.endsWith("/robots.txt")) {
      return { url: req.url, status: 200, headers: {}, body: DISALLOW_ALL };
    }
    return { url: req.url, status: 200, headers: {}, body: "<html>bal</html>" };
  };
  const http = createPoliteHttp({
    transport,
    userAgent: "DanceTonightBot/1.0 (+https://dancetonightglobal.com/bot)",
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    ...(waived ? { robotsWaivedHosts: waived } : {}),
  });
  return { http, requests, sleeps };
}

describe("robots waiver in the polite client (D-831)", () => {
  it("refuses a disallowed site with no waiver", async () => {
    const { http } = setup();
    await expect(
      http.request({
        url: "https://agendatrad.org/calendar/France",
        purpose: "crawl",
        maxBytes: 1000,
      }),
    ).rejects.toMatchObject({ kind: "robots_disallowed" } satisfies Partial<HttpError>);
  });

  it("reads a waived host, with our User-Agent and crawl spacing", async () => {
    const { http, requests, sleeps } = setup(new Set(["agendatrad.org"]));
    const first = await http.request({
      url: "https://agendatrad.org/calendar/France",
      purpose: "crawl",
      maxBytes: 1000,
    });
    expect(first.status).toBe(200);
    await http.request({
      url: "https://www.agendatrad.org/calendar/France?page=2",
      purpose: "crawl",
      maxBytes: 1000,
    });
    const pages = requests.filter((r) => !r.url.endsWith("/robots.txt"));
    expect(pages).toHaveLength(2);
    expect(pages[0]!.headers["user-agent"] ?? pages[0]!.headers["User-Agent"]).toContain(
      "DanceTonightBot",
    );
    expect(Math.max(0, ...sleeps)).toBeGreaterThanOrEqual(5000);
  });

  it("does not waive another host", async () => {
    const { http } = setup(new Set(["agendatrad.org"]));
    await expect(
      http.request({ url: "https://other.example/calendar", purpose: "crawl", maxBytes: 1000 }),
    ).rejects.toMatchObject({ kind: "robots_disallowed" });
  });
});

describe("robotsWaivedHosts and the run line", () => {
  const seeds = [
    {
      url: "https://www.agendatrad.org/calendar/France",
      label: "AgendaTrad",
      robotsWaiver: { grantedBy: "AgendaTrad via the owner", on: "2026-11-10", decision: "D-831" },
    },
    { url: "https://other.example/", label: "Other" },
  ];

  it("lists the waived seed's host without www", () => {
    expect([...robotsWaivedHosts(seeds)]).toEqual(["agendatrad.org"]);
  });

  it("writes one run line per waived seed", () => {
    expect(robotsWaiverLines(seeds)).toEqual([
      "https://www.agendatrad.org/calendar/France: robots.txt waived: written permission (D-831, AgendaTrad via the owner, 2026-11-10)",
    ]);
  });
});

describe("every robots waiver in the config cites a recorded decision", () => {
  const decisions = readFileSync("docs/DECISIONS.md", "utf8");
  const waivers = Object.values(METRO_SOURCES)
    .flat()
    .filter((seed) => seed.robotsWaiver);

  it.each(waivers.map((seed) => [seed.url, seed.robotsWaiver!] as const))("%s", (_url, waiver) => {
    expect(waiver.grantedBy.trim()).not.toBe("");
    expect(waiver.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(waiver.decision).toMatch(/^D-\d+$/);
    expect(decisions).toContain(`## ${waiver.decision} `);
  });

  it("runs (a placeholder while no seed carries a waiver)", () => {
    expect(Array.isArray(waivers)).toBe(true);
  });
});
