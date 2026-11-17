// D-873 contract: a page that links one small .ics file per event (Tanzschule Traumtänzer's /tanzparty/, Berlin
// 2026-11-12) is read as an index: each on-site .ics link is fetched and read as a calendar. The page itself
// (442 KB) loses 6-8 of ~20 events per model read; each file is one exact VEVENT.
import { describe, expect, it } from "vitest";

import { icsLinksAdapter, icsLinksOn } from "@/src/adapters/feeds/ics-links";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const PAGE_URL = "https://www.traumtaenzer.de/tanzparty/";
const ics = (id: number, day: string, summary: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Traumtänzer//iCal//DE",
    "X-WR-TIMEZONE:Europe/Berlin",
    "BEGIN:VEVENT",
    `DTSTART;TZID=Europe/Berlin:${day}T180000`,
    `DTEND;TZID=Europe/Berlin:${day}T210000`,
    `UID:ttveranst${id}@traumtaenzer.de`,
    "DTSTAMP:20261112T122627Z",
    "LOCATION:Tanzschule Traumtänzer - Flughafen Tempelhof\\, Columbiadamm 8",
    `URL;VALUE=URI:https://www.traumtaenzer.de/tanzveranstaltung/2026/11/15/x-${id}/`,
    `SUMMARY:${summary}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const link = (id: number) => `https://www.traumtaenzer.de/download/traumtaenzer.ics/V${id}/`;
const PAGE = `<html><body>
<a href="${link(9268)}">iCal</a>
<a href="${link(9268)}">iCal again</a>
<a href="/download/traumtaenzer.ics/V9269/">relative</a>
<a href="https://evil.example.com/x.ics">off-site</a>
<a href="javascript:alert(1)//.ics">js</a>
<a href="ftp://www.traumtaenzer.de/a.ics">ftp</a>
<a href="https://www.traumtaenzer.de/tanzkurse/">not a calendar</a>
<a href="${link(9270)}">broken</a>
</body></html>`;

const BERLIN: Metro = {
  id: "ber",
  slug: "berlin",
  name: "Berlin",
  countryCode: "DE",
  center: { lat: 52.52, lng: 13.405 },
  radiusKm: 40,
  tz: "Europe/Berlin",
  languages: ["de", "en"],
};

const source: Source = {
  id: "traum",
  url: PAGE_URL,
  kind: "html",
  trustTier: "first_party",
  platform: "ics_links",
  feedUrl: null,
  metroId: "ber",
  styles: ["social_ballroom"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctx(files: Record<string, { status: number; body: string }>, now: Date, page = PAGE) {
  const ok = (url: string, body: string, type: string, status = 200): Fixture => ({
    request: { method: "GET", url },
    response: { url, status, headers: { "content-type": type }, body },
  });
  const fixtures: Fixture[] = [
    ok("https://www.traumtaenzer.de/robots.txt", "User-agent: *\nAllow: /\n", "text/plain"),
    ok(PAGE_URL, page, "text/html"),
    ...Object.entries(files).map(([url, f]) => ok(url, f.body, "text/calendar", f.status)),
  ];
  const transport = fixtureTransport(fixtures);
  let t = now.getTime();
  const run: RunCtx = {
    metro: BERLIN,
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
  return { run, requests: transport.requests };
}

describe("icsLinksOn", () => {
  it("lists each on-site http(s) .ics link once, absolute, in page order", () => {
    expect(icsLinksOn(PAGE, PAGE_URL)).toEqual([
      link(9268),
      "https://www.traumtaenzer.de/download/traumtaenzer.ics/V9269/",
      link(9270),
    ]);
  });

  it("caps the list at 60 links", () => {
    const many = Array.from({ length: 80 }, (_, i) => `<a href="${link(1000 + i)}">x</a>`).join("");
    expect(icsLinksOn(many, PAGE_URL)).toHaveLength(60);
  });

  it("finds none on a page without calendar links", () => {
    expect(icsLinksOn("<a href='/tanzkurse/'>x</a>", PAGE_URL)).toEqual([]);
  });
});

describe("icsLinksAdapter", () => {
  const NOW = new Date("2026-11-12T12:00:00Z");

  it("reads every linked calendar; a file that fails is a note, not a failure", async () => {
    const { run, requests } = ctx(
      {
        [link(9268)]: { status: 200, body: ics(9268, "20261115", "Ballhaus Tanzparty") },
        "https://www.traumtaenzer.de/download/traumtaenzer.ics/V9269/": {
          status: 200,
          body: ics(9269, "20261121", "Discofox Party"),
        },
        [link(9270)]: { status: 200, body: "<html>not a calendar</html>" },
      },
      NOW,
    );
    const result = await icsLinksAdapter.harvest!(source, run);
    const titles = result.listings.map((l) => l.listing.title).sort();
    expect(titles).toEqual(["Ballhaus Tanzparty", "Discofox Party"]);
    const ballhaus = result.listings.find((l) => l.listing.title === "Ballhaus Tanzparty")!;
    expect(ballhaus.listing.local_date).toBe("2026-11-15");
    // An untyped VEVENT's DTSTART is its doors time (icsToListings), in Europe/Berlin.
    expect(ballhaus.listing.doors_time ?? ballhaus.listing.dancing_time).toBe("18:00");
    expect(ballhaus.listing.end_time).toBe("21:00");
    expect(ballhaus.listing.venue.address).toContain("Columbiadamm 8");
    expect(result.notes?.some((n) => n.includes("1 of 3"))).toBe(true);
    // Never off-site, never a non-http link.
    expect(requests.some((r) => String(r).includes("evil.example.com"))).toBe(false);
    expect(requests.some((r) => String(r).includes("ftp:"))).toBe(false);
    expect(requests.some((r) => String(r).includes("V9268"))).toBe(true);
  });

  it("fails when the page links no calendars (the page changed)", async () => {
    const { run } = ctx({}, NOW, "<html><body><a href='/tanzkurse/'>Kurse</a></body></html>");
    await expect(icsLinksAdapter.harvest!(source, run)).rejects.toThrow(/no calendar links/);
  });

  it("fails when every linked calendar fails", async () => {
    const { run } = ctx(
      {
        [link(9268)]: { status: 500, body: "" },
        "https://www.traumtaenzer.de/download/traumtaenzer.ics/V9269/": { status: 404, body: "" },
        [link(9270)]: { status: 200, body: "<html></html>" },
      },
      NOW,
    );
    await expect(icsLinksAdapter.harvest!(source, run)).rejects.toThrow();
  });
});
