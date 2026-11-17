// D-870 contract: the Swing Out London socials list read with no model. Each row names its venue
// and area ("A-Train - The Hammersmith Club in Hammersmith") and its full postcode (the map link's
// title "W6 9DH to be precise"), so every night is placed and the directory's copy can meet the
// organiser's own copy at one venue (A-Train, Swingland, 11-11 daily report).
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSwingOutLondon, swingOutLondonAdapter } from "@/src/adapters/feeds/swingoutlondon";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const PAGE = readFileSync(path.join(DIR, "swingoutlondon-2026-11-11.html"), "utf8");
const URL_ = "https://www.swingoutlondon.co.uk/";

const LONDON: Metro = {
  id: "lon",
  slug: "london",
  name: "London",
  countryCode: "GB",
  center: { lat: 51.5074, lng: -0.1278 },
  radiusKm: 50,
  tz: "Europe/London",
  languages: ["en"],
};

const source: Source = {
  id: "sol",
  url: URL_,
  kind: "jsonld",
  trustTier: "directory",
  platform: "swingoutlondon",
  feedUrl: null,
  metroId: "lon",
  styles: ["lindy_hop", "balboa", "blues"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctx(body: string, now: Date): RunCtx & { requests: string[] } {
  const fixtures: Fixture[] = [
    {
      request: { method: "GET", url: "https://www.swingoutlondon.co.uk/robots.txt" },
      response: {
        url: "https://www.swingoutlondon.co.uk/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
      },
    },
    {
      request: { method: "GET", url: URL_ },
      response: { url: URL_, status: 200, headers: { "content-type": "text/html" }, body },
    },
  ];
  const transport = fixtureTransport(fixtures);
  let t = now.getTime();
  return {
    metro: LONDON,
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

describe("parseSwingOutLondon", () => {
  const rows = parseSwingOutLondon(PAGE, URL_);

  it("reads every social row of the dated list and none of the weekly classes", () => {
    expect(rows).toHaveLength(25);
    expect(rows.every((r) => /^2026-11-\d\d$/.test(r.night))).toBe(true);
    // The weekly class list below ("Angel with Swing Patrol") is not read.
    expect(rows.some((r) => r.title.startsWith("Angel"))).toBe(false);
  });

  it("splits the title from the venue and area, and takes the full postcode", () => {
    const aTrain = rows.find((r) => r.id === "42-2026-11-16");
    expect(aTrain).toEqual({
      id: "42-2026-11-16",
      night: "2026-11-16",
      title: "A-Train",
      venueName: "The Hammersmith Club",
      area: "Hammersmith",
      postcode: "W6 9DH",
      url: "https://www.swingland.com/a-train/schedule/",
      cancelled: false,
    });
  });

  it("drops the infrequent-event highlight markup and decodes entities", () => {
    const highlighted = rows.find((r) => r.id === "1305-2026-11-15");
    expect(highlighted?.title).toBe("Brixton's Got Rhythm!");
    expect(highlighted?.venueName).toBe("Craft Metropolis");
    const jamboree = rows.find((r) => r.id === "1317-2026-11-12");
    expect(jamboree?.title).toBe("The Cable Street Rag Band @ Jamboree");
    expect(jamboree?.area).toBe("King's Cross");
    const george = rows.find((r) => r.id === "1323-2026-11-17");
    expect(george?.venueName).toBe("The George & Devonshire");
    expect(george?.postcode).toBe("W4 2QE");
  });

  it("splits venue from area at the last ' in '", () => {
    const quaker = rows.find((r) => r.id === "2087-2026-11-14");
    expect(quaker?.venueName).toBe("Westminster Quaker Meeting House");
    expect(quaker?.area).toBe("Westminster");
  });

  it("marks a row the site flags as cancelled", () => {
    const html = PAGE.replace(
      "Jazzbourne in New Cross</span></a></span></li>",
      'Jazzbourne in New Cross</span></a><em class="social_cancelled">Cancelled</em></span></li>',
    );
    const row = parseSwingOutLondon(html, URL_).find((r) => r.id === "1320-2026-11-11");
    expect(row?.cancelled).toBe(true);
  });

  it("keeps a row with no http(s) link, with url null", () => {
    const html = PAGE.replace('href="https://www.learntoswingdance.com"', 'href="mailto:x@y.z"');
    const row = parseSwingOutLondon(html, URL_).find((r) => r.id === "1320-2026-11-11");
    expect(row?.url).toBeNull();
    expect(row?.title).toBe("Wednesday Swing Club");
  });

  it("returns no rows for a page without the dated list", () => {
    expect(parseSwingOutLondon("<html><body>Maintenance</body></html>", URL_)).toEqual([]);
  });
});

describe("swingOutLondon reader", () => {
  it("places each night in the window at its venue and postcode, untimed", async () => {
    const run = ctx(PAGE, new Date("2026-11-12T12:00:00Z"));
    const result = await swingOutLondonAdapter.harvest!(source, run);

    // 11-11 is before the window (fromNight 11-12); the other 24 rows are in it.
    expect(result.listings).toHaveLength(24);
    expect(result.whole).toBe(true);
    // Only the list page itself is fetched (robots.txt aside): never the organisers' links.
    expect(run.requests.filter((u) => !u.endsWith("/robots.txt"))).toEqual([`GET ${URL_}`]);

    const aTrain = result.listings.find((l) => l.externalId === "swingoutlondon:42-2026-11-16");
    expect(aTrain).toBeDefined();
    expect(aTrain!.listing.title).toBe("A-Train");
    expect(aTrain!.listing.local_date).toBe("2026-11-16");
    expect(aTrain!.listing.listing_type).toBe("social");
    expect(aTrain!.listing.venue.name).toBe("The Hammersmith Club");
    expect(aTrain!.listing.venue.address).toBe("London W6 9DH");
    expect(aTrain!.listing.doors_time).toBeNull();
    expect(aTrain!.listing.dancing_time).toBeNull();
    expect(aTrain!.listing.styles).toEqual(["lindy_hop", "balboa", "blues"]);
    expect(aTrain!.eventUrl).toBe("https://www.swingland.com/a-train/schedule/");
    expect(aTrain!.provenance.sourceUrl).toBe(URL_);
  });

  it("throws when the page shows no socials, so a broken read retires nothing", async () => {
    const run = ctx("<html><body>Maintenance</body></html>", new Date("2026-11-12T12:00:00Z"));
    await expect(swingOutLondonAdapter.harvest!(source, run)).rejects.toThrow();
  });
});
