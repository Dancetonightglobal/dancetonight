import { describe, expect, it } from "vitest";

import { mennaAdapter } from "@/src/adapters/feeds/menna";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// D-779 (NYC 11-07): menna tags food fairs, markets and matches "Party". "NYC Halal Fest 2026" was
// Food,Community,Party and showed as a noon festival session.
const LIST = "https://itsmenna.com/events";
const card = (id: number, title: string, categories: string) =>
  `<article class="event-card" data-categories="${categories}" data-date-iso="2026-11-07" ` +
  `data-date-end-iso="2026-11-07"><a href="/events/${id}-x/" class="event-card-link" ` +
  `aria-label="${title} — view details"></a><h3>${title}</h3></article>`;
const LIST_HTML = `<html><body>${[
  card(1748, "NYC Halal Fest 2026", "Food,Community,Party"),
  card(1, "Bazaar", "Shopping,Community,Wellness,Party"),
  card(2, "Match night", "Community,Sport,Party"),
  card(3, "Runway", "Art,Party,Fashion"),
  card(4, "Queer SWANA party", "Party,LGBTQ+,Community"),
  card(5, "Habibi night", "Music,Party"),
  card(6, "Dabke workshop", "Dance,Workshop"),
  card(7, "Mezze party", "Music,Party,Food"),
].join("")}</body></html>`;

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
const source: Source = {
  id: "s",
  url: LIST,
  kind: "jsonld",
  trustTier: "first_party",
  platform: "menna",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

describe("menna Party cards that are fairs (D-779)", () => {
  it("reads only party nights and dance cards", async () => {
    const page = (url: string, body: string): Fixture => ({
      request: { method: "GET", url },
      response: { url, status: 200, headers: { "content-type": "text/html" }, body },
    });
    const transport = fixtureTransport([
      page("https://itsmenna.com/robots.txt", "User-agent: *\nAllow: /\n"),
      page(LIST, LIST_HTML),
      ...[4, 5, 6, 7].map((id) =>
        page(`https://itsmenna.com/events/${id}-x/`, "<html><body>event</body></html>"),
      ),
    ]);
    let t = new Date("2026-11-07T15:00:00Z").getTime();
    const run: RunCtx = {
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
    };
    const result = await mennaAdapter.harvest!(source, run).catch(() => null);
    expect(transport.requests.filter((r) => r.includes("/events/")).sort()).toEqual(
      [4, 5, 6, 7].map((id) => `GET https://itsmenna.com/events/${id}-x/`),
    );
    expect(result?.notes ?? []).toContain("4 party or dance night(s) in the window of 8 listed");
  });
});
