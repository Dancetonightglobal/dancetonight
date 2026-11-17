// What a visitor submits becomes draft listings (D-135): structured events first, the model
// otherwise, everything it reads checked against the text, and nothing lost to a quota.
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AiClient, AiFailure } from "@/src/ai";
import type { Metro } from "@/src/adapters/types";
import { rawExtractionSchema, type RawExtraction } from "@/src/domain/listing";
import { buildBlocklist } from "@/src/pipeline/blocklist";
import { fixtureTransport, type Fixture } from "@/src/pipeline/http";
import {
  PASTED_TEXT_URL,
  SUBMISSION_QUOTA_SCOPE,
  SUBMISSION_TEXT_MAX_CHARS,
  readSubmission,
  submissionHttp,
} from "@/src/pipeline/submission";

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
// Monday 5 October 2026, noon in New York.
const NOW = new Date("2026-10-05T16:00:00Z");

const ok = (url: string, body: string, headers: Record<string, string> = {}): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers, body },
});

/** A client that answers from a queue and records what it was asked. */
function fakeClient(replies: Array<RawExtraction | AiFailure>) {
  const asked: Array<{ job: string; user: string; metro: string; maxItems: unknown }> = [];
  const client = {
    async run(
      request: { job: { id: string }; user: string; jsonSchema: Record<string, unknown> },
      options: { metro: string },
    ) {
      const props = request.jsonSchema.properties as { listings: { maxItems: unknown } };
      asked.push({
        job: request.job.id,
        user: request.user,
        metro: options.metro,
        maxItems: props.listings.maxItems,
      });
      const reply = replies.shift();
      if (!reply) throw new Error("no reply queued");
      if (typeof reply === "string") {
        return { ok: false, reason: reply, provider: "cloudflare", detail: "test" };
      }
      return {
        ok: true,
        value: reply,
        provider: "cloudflare",
        model: "granite",
        usage: { inputTokens: 100, outputTokens: 50, cost: 79, unit: "neuron" },
      };
    },
  } as unknown as AiClient;
  return { client, asked };
}

const extraction = (listings: unknown[]) =>
  rawExtractionSchema.parse({ page_kind: "single_event", language: "en", listings });

const PASTED = [
  "Salsa Social at Copacabana",
  "Friday October 9, 2026",
  "Lesson 8pm, dancing 9pm to 2am",
  "$15 at the door",
].join("\n");

const SALSA = {
  title: "Salsa Social at Copacabana",
  listing_type: "social",
  styles: ["salsa"],
  local_date: "2026-10-09",
  lesson_time: "20:00",
  dancing_time: "21:00",
  end_time: "02:00",
  prices: [{ label: "door", amount: 15, currency: "USD" }],
};

const noHttp = submissionHttp({
  userAgent: "DanceTonightBot/1.0",
  transport: fixtureTransport([]),
});

describe("pasted text", () => {
  it("drafts the night the text writes, read by the submission job under its own scope", async () => {
    const { client, asked } = fakeClient([extraction([SALSA])]);
    const read = await readSubmission(
      { kind: "text", text: PASTED },
      { http: noHttp, ai: { client }, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft", method: "model" });
    if (read.status !== "draft") return;
    expect(read.drafts).toHaveLength(1);
    expect(read.drafts[0]).toMatchObject({
      title: "Salsa Social at Copacabana",
      nightDate: "2026-10-09",
      lessonAt: "2026-10-10T00:00:00.000Z",
      dancingAt: "2026-10-10T01:00:00.000Z",
      endsAt: "2026-10-10T06:00:00.000Z",
      tz: "America/New_York",
      canonicalUrl: null,
    });
    expect(read.calls).toHaveLength(1);
    expect(asked).toEqual([
      expect.objectContaining({ job: "submission", metro: SUBMISSION_QUOTA_SCOPE, maxItems: 3 }),
    ]);
    // The model is told there is no page, and no made-up address stands in for one.
    expect(asked[0]!.user).toContain("Page URL: none: text a visitor pasted");
    expect(asked[0]!.user).not.toContain(PASTED_TEXT_URL);
  });

  it("drops what the text does not write: a title the model made up drafts nothing", async () => {
    const { client } = fakeClient([extraction([{ ...SALSA, title: "Bachata Thursdays" }])]);
    const read = await readSubmission(
      { kind: "text", text: PASTED },
      { http: noHttp, ai: { client }, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "empty", method: "model" });
    if (read.status !== "empty") return;
    expect(read.notes.join(" ")).toMatch(/Bachata Thursdays: the page does not write this title/);
  });

  it("drafts a rule as its next night, with the rule's own words", async () => {
    const text = "Tango Y Te\nEvery Sunday, 7pm\nFree";
    const { client } = fakeClient([
      extraction([
        {
          title: "Tango Y Te",
          listing_type: "social",
          styles: ["argentine_tango"],
          dancing_time: "19:00",
          recurrence_text: "Every Sunday",
          is_free: true,
        },
      ]),
    ]);
    const read = await readSubmission(
      { kind: "text", text },
      { http: noHttp, ai: { client }, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft" });
    if (read.status !== "draft") return;
    expect(read.drafts).toHaveLength(1);
    expect(read.drafts[0]).toMatchObject({
      nightDate: "2026-10-11",
      recurrenceText: "Every Sunday",
      isFree: true,
    });
  });

  it("drafts at most three nights", async () => {
    const nights = ["10", "11", "12", "13"].map((d) => `October ${d}, 2026: Lindy jam`);
    const text = nights.join("\n");
    const { client } = fakeClient([
      extraction(
        ["10", "11", "12", "13"].map((d) => ({
          title: "Lindy jam",
          listing_type: "social",
          styles: ["lindy_hop"],
          local_date: `2026-10-${d}`,
        })),
      ),
    ]);
    const read = await readSubmission(
      { kind: "text", text },
      { http: noHttp, ai: { client }, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft" });
    if (read.status !== "draft") return;
    expect(read.drafts.map((d) => d.nightDate)).toEqual(["2026-10-10", "2026-10-11", "2026-10-12"]);
    expect(read.notes.join(" ")).toMatch(/the first 3 to come are drafted/);
  });

  it("is queued for a person when no model can read it, never lost", async () => {
    const { client } = fakeClient(["quota_exhausted"]);
    await expect(
      readSubmission(
        { kind: "text", text: PASTED },
        { http: noHttp, ai: { client }, metro: NYC, now: NOW },
      ),
    ).resolves.toMatchObject({
      status: "queued",
      reason: expect.stringMatching(/quota_exhausted/),
    });
    await expect(
      readSubmission(
        { kind: "text", text: PASTED },
        { http: noHttp, ai: null, metro: NYC, now: NOW },
      ),
    ).resolves.toMatchObject({ status: "queued", calls: [] });
  });

  it("refuses empty or over-long text without a model call", async () => {
    const { client, asked } = fakeClient([]);
    const deps = { http: noHttp, ai: { client }, metro: NYC, now: NOW };
    await expect(readSubmission({ kind: "text", text: " \n\u0000 " }, deps)).resolves.toMatchObject(
      { status: "refused" },
    );
    await expect(
      readSubmission({ kind: "text", text: "x".repeat(SUBMISSION_TEXT_MAX_CHARS + 1) }, deps),
    ).resolves.toMatchObject({ status: "refused", reason: expect.stringMatching(/over 12000/) });
    expect(asked).toHaveLength(0);
  });
});

describe("what is drafted", () => {
  it("drafts no night that has passed", async () => {
    const text = "Salsa Social at Copacabana\nThursday October 1, 2026, 9pm";
    const { client } = fakeClient([
      extraction([{ ...SALSA, local_date: "2026-10-01", lesson_time: null, end_time: null }]),
    ]);
    const read = await readSubmission(
      { kind: "text", text },
      { http: noHttp, ai: { client }, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "empty" });
    if (read.status !== "empty") return;
    expect(read.notes.join(" ")).toMatch(/2026-10-01 has passed/);
  });

  it("sends the model no more of a page than of pasted text", async () => {
    const PAGE = "https://salsa.example/events/long";
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: fixtureTransport([
        ok("https://salsa.example/robots.txt", "User-agent: *\nAllow: /\n"),
        ok(
          PAGE,
          `<main>${"<p>Salsa every night of the week at the club.</p>".repeat(1_000)}</main>`,
        ),
      ]),
      sleep: async () => {},
    });
    const { client, asked } = fakeClient([extraction([])]);
    await readSubmission(
      { kind: "url", url: PAGE },
      { http, ai: { client }, metro: NYC, now: NOW },
    );
    const pageText = asked[0]!.user.split("Page text:\n")[1]!;
    expect(pageText.length).toBeLessThanOrEqual(SUBMISSION_TEXT_MAX_CHARS);
  });
});

describe("a URL", () => {
  const PAGE = "https://salsa.example/events/friday";
  const ROBOTS = ok("https://salsa.example/robots.txt", "User-agent: *\nAllow: /\n");

  it("reads a page's structured event with no model call", async () => {
    const jsonld = {
      "@context": "https://schema.org",
      "@type": "DanceEvent",
      name: "Friday Salsa Social",
      startDate: "2026-10-09T21:00:00-04:00",
      location: { "@type": "Place", name: "Copacabana", address: "268 W 47th St, New York" },
    };
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: fixtureTransport([
        ROBOTS,
        ok(
          PAGE,
          `<html><script type="application/ld+json">${JSON.stringify(jsonld)}</script><h1>Friday</h1></html>`,
        ),
      ]),
      sleep: async () => {},
    });
    const { client, asked } = fakeClient([]);
    const read = await readSubmission(
      { kind: "url", url: PAGE },
      { http, ai: { client }, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft", method: "jsonld", calls: [] });
    if (read.status !== "draft") return;
    expect(read.drafts[0]).toMatchObject({
      title: "Friday Salsa Social",
      nightDate: "2026-10-09",
      venueName: "Copacabana",
      canonicalUrl: PAGE,
    });
    expect(asked).toHaveLength(0);
  });

  it("drafts at most three of a calendar page's structured events", async () => {
    const graph = ["09", "10", "11", "12"].map((d) => ({
      "@type": "DanceEvent",
      name: "Bachata night",
      startDate: `2026-10-${d}T21:00:00-04:00`,
      location: { "@type": "Place", name: "Copacabana" },
    }));
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: fixtureTransport([
        ROBOTS,
        ok(
          PAGE,
          `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`,
        ),
      ]),
      sleep: async () => {},
    });
    const read = await readSubmission(
      { kind: "url", url: PAGE },
      { http, ai: null, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft", method: "jsonld" });
    if (read.status !== "draft") return;
    expect(read.drafts.map((d) => d.nightDate)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(read.notes.join(" ")).toMatch(/the first 3 to come are drafted/);
  });

  it("reads a page with no structured events through the model, checked against its text", async () => {
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: fixtureTransport([
        ROBOTS,
        ok(
          PAGE,
          `<html><body><main>${PASTED.split("\n")
            .map((l) => `<p>${l}</p>`)
            .join("")}</main></body></html>`,
        ),
      ]),
      sleep: async () => {},
    });
    const { client, asked } = fakeClient([extraction([SALSA])]);
    const read = await readSubmission(
      { kind: "url", url: PAGE },
      { http, ai: { client }, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft", method: "model" });
    if (read.status !== "draft") return;
    expect(read.drafts[0]).toMatchObject({ nightDate: "2026-10-09", canonicalUrl: PAGE });
    expect(asked[0]!.user).toContain(`Page URL: ${PAGE}`);
  });

  it("refuses a URL into our own network before any request", async () => {
    const transport = fixtureTransport([]);
    const http = submissionHttp({ userAgent: "DanceTonightBot/1.0", transport });
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:3000/admin",
      "file:///etc/passwd",
      "https://salsa.example:8443/",
    ]) {
      await expect(
        readSubmission({ kind: "url", url }, { http, ai: null, metro: NYC, now: NOW }),
        url,
      ).resolves.toMatchObject({ status: "refused" });
    }
    expect(transport.requests).toEqual([]);
  });

  it("does not read a page robots.txt keeps from us, and says so plainly", async () => {
    const transport = fixtureTransport([
      ok("https://salsa.example/robots.txt", "User-agent: *\nDisallow: /events/\n"),
      ok(PAGE, "<p>Friday salsa</p>"),
    ]);
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport,
      sleep: async () => {},
    });
    await expect(
      readSubmission({ kind: "url", url: PAGE }, { http, ai: null, metro: NYC, now: NOW }),
    ).resolves.toEqual({
      status: "unreadable",
      reason: "the site asks automated readers not to read this page",
      detail: expect.stringMatching(/robots\.txt disallows \/events\/friday/),
    });
    expect(transport.requests).not.toContain(`GET ${PAGE}`);
  });

  it("gives a page whose robots.txt refuses AI input to a person, not the model", async () => {
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: fixtureTransport([
        ok(
          "https://salsa.example/robots.txt",
          "User-agent: *\nContent-Signal: ai-input=no\nAllow: /\n",
        ),
        ok(PAGE, "<main><p>Salsa Social at Copacabana</p><p>Friday October 9, 2026</p></main>"),
      ]),
      sleep: async () => {},
    });
    const { client, asked } = fakeClient([extraction([SALSA])]);
    await expect(
      readSubmission({ kind: "url", url: PAGE }, { http, ai: { client }, metro: NYC, now: NOW }),
    ).resolves.toMatchObject({
      status: "queued",
      reason: expect.stringMatching(/not be read by AI/),
    });
    expect(asked).toHaveLength(0);
  });

  it("drafts the first three nights to come, whatever the page's order, and none that has passed", async () => {
    const graph = ["12", "11", "10", "09", "01"].map((d) => ({
      "@type": "DanceEvent",
      name: "Bachata night",
      startDate: `2026-10-${d}T21:00:00-04:00`,
      location: { "@type": "Place", name: "Copacabana" },
    }));
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: fixtureTransport([
        ROBOTS,
        ok(
          PAGE,
          `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`,
        ),
      ]),
      sleep: async () => {},
    });
    const read = await readSubmission(
      { kind: "url", url: PAGE },
      { http, ai: null, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft" });
    if (read.status !== "draft") return;
    expect(read.drafts.map((d) => d.nightDate)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
  });

  it("keeps nights that share one @id apart", async () => {
    const graph = ["07", "09", "11"].map((d) => ({
      "@type": "DanceEvent",
      "@id": "https://salsa.example/events/friday#event",
      name: "Friday salsa",
      startDate: `2026-10-${d}T21:00:00-04:00`,
      location: { "@type": "Place", name: "Copacabana" },
    }));
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      transport: fixtureTransport([
        ROBOTS,
        ok(
          PAGE,
          `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph })}</script>`,
        ),
      ]),
      sleep: async () => {},
    });
    const read = await readSubmission(
      { kind: "url", url: PAGE },
      { http, ai: null, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({ status: "draft" });
    if (read.status !== "draft") return;
    expect(read.drafts.map((d) => d.nightDate)).toEqual(["2026-10-07", "2026-10-09", "2026-10-11"]);
  });
});

describe("a URL that redirects", () => {
  // Three local servers: the first, another port on the same address (the same site to the
  // polite client), and a second address (another site). A real run reaches none of them.
  const servers: http.Server[] = [];
  const ports: number[] = [];
  const hits: string[] = [];
  const listen = async (host: string, handler: http.RequestListener) => {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    servers.push(server);
    return (server.address() as AddressInfo).port;
  };
  beforeAll(async () => {
    const page = (res: http.ServerResponse) => {
      res.setHeader("content-type", "text/html");
      res.end(
        `<script type="application/ld+json">${JSON.stringify({
          "@context": "https://schema.org",
          "@type": "DanceEvent",
          name: "Friday salsa",
          startDate: "2026-10-09T21:00:00-04:00",
          location: { "@type": "Place", name: "Copacabana" },
        })}</script>`,
      );
    };
    ports[1] = await listen("127.0.0.1", (req, res) => {
      hits.push(`b${req.url}`);
      if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
      page(res);
    });
    ports[2] = await listen("127.0.0.2", (req, res) => {
      hits.push(`c${req.url}`);
      if (req.url === "/robots.txt") return res.end("User-agent: *\nDisallow: /private\n");
      page(res);
    });
    ports[0] = await listen("127.0.0.1", (req, res) => {
      hits.push(`a${req.url}`);
      if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
      const to: Record<string, string> = {
        "/same-site": `http://127.0.0.1:${ports[1]}/event`,
        "/to-disallowed": `http://127.0.0.2:${ports[2]}/private/event`,
        "/to-allowed": `http://127.0.0.2:${ports[2]}/event`,
        "/to-blocked": `http://127.0.0.2:${ports[2]}/blocked/event`,
      };
      res.writeHead(302, { location: to[req.url ?? ""] ?? "/" });
      res.end();
    });
  });
  afterAll(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  const POLICY = () => ({
    allowed: (address: string) => address === "127.0.0.1" || address === "127.0.0.2",
    ports: ["", "80", "443", ...ports.map(String)],
  });
  const client = () =>
    submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      sleep: async () => {},
      blocklist: buildBlocklist([
        { patternType: "url_prefix", value: `http://127.0.0.2:${ports[2]}/blocked/` },
      ]),
      untrusted: { policy: POLICY() },
    });
  const submit = (path: string) =>
    readSubmission(
      { kind: "url", url: `http://127.0.0.1:${ports[0]}${path}` },
      { http: client(), ai: null, metro: NYC, now: NOW, urlPolicy: POLICY() },
    );

  it("follows a hop to another site that allows it", async () => {
    await expect(submit("/to-allowed")).resolves.toMatchObject({
      status: "draft",
      method: "jsonld",
    });
    expect(hits).toContain("c/robots.txt");
  });

  it("follows a hop within the same site without waiting on itself", async () => {
    await expect(submit("/same-site")).resolves.toMatchObject({ status: "draft" });
  });

  it("refuses a hop the other site's robots.txt disallows, before fetching it", async () => {
    await expect(submit("/to-disallowed")).resolves.toMatchObject({
      status: "unreadable",
      detail: expect.stringMatching(/robots\.txt disallows \/private\/event/),
    });
    expect(hits).not.toContain("c/private/event");
  });

  it("refuses a hop to a blocklisted site, before fetching it", async () => {
    await expect(submit("/to-blocked")).resolves.toMatchObject({
      status: "unreadable",
      detail: expect.stringMatching(/on the blocklist/),
    });
    expect(hits).not.toContain("c/blocked/event");
  });

  it("tells the visitor nothing about a name that resolves to one of our addresses", async () => {
    const http = submissionHttp({
      userAgent: "DanceTonightBot/1.0",
      sleep: async () => {},
      untrusted: { resolve: (_h, _o, cb) => cb(null, [{ address: "10.0.0.7", family: 4 }]) },
    });
    const read = await readSubmission(
      { kind: "url", url: "https://intranet-wiki.example.com/" },
      { http, ai: null, metro: NYC, now: NOW },
    );
    expect(read).toMatchObject({
      status: "unreadable",
      reason: "the page could not be fetched",
    });
    expect(JSON.stringify(read.status === "unreadable" ? read.reason : "")).not.toMatch(
      /intranet|10\.0/,
    );
  });
});
