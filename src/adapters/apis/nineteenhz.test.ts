import { describe, expect, it } from "vitest";
import { nineteenHzRows, nineteenHzAdapter } from "@/src/adapters/apis/nineteenhz";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";
import { readFileSync } from "fs";

const LA_HTML = readFileSync(new URL("./__fixtures__/nineteenhz/la.html", import.meta.url), "utf8");

const LA_METRO: Metro = {
  id: "la",
  slug: "los-angeles",
  name: "Los Angeles",
  countryCode: "US",
  center: { lat: 34.0522, lng: -118.2437 },
  radiusKm: 50,
  tz: "America/Los_Angeles",
  languages: ["en"],
};

const MIAMI_METRO: Metro = {
  id: "miami",
  slug: "miami",
  name: "Miami",
  countryCode: "US",
  center: { lat: 25.7617, lng: -80.1918 },
  radiusKm: 30,
  tz: "America/New_York",
  languages: ["en"],
};

const SOURCE: Source = {
  id: "s",
  url: "https://19hz.info/eventlisting_LosAngeles.php",
  kind: "html",
  trustTier: "directory",
  platform: "nineteenhz",
  feedUrl: null,
  metroId: "la",
  styles: ["house", "techno", "drum-and-bass"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctxFor(
  html: string,
  metro: Metro = LA_METRO,
  now: Date = new Date("2026-11-07T06:00:00Z"),
  robots: { status: number; body: string } = { status: 404, body: "" },
): RunCtx {
  let t = now.getTime();
  return {
    metro,
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
        if (req.url === "https://19hz.info/robots.txt") {
          return {
            url: req.url,
            status: robots.status,
            headers: {},
            body: robots.body,
          };
        }
        if (req.url === SOURCE.url) {
          return { url: req.url, status: 200, headers: {}, body: html };
        }
        return { url: req.url, status: 404, headers: {}, body: "" };
      },
    }),
  };
}

describe("nineteenHzRows", () => {
  it("finds 32 rows, 30 dated and 2 weekly (the <th> header row is not a row)", () => {
    const rows = nineteenHzRows(LA_HTML);
    expect(rows).toHaveLength(32);
    const dated = rows.filter((r) => r.sortDate !== null);
    expect(dated).toHaveLength(30);
    const weekly = rows.filter((r) => r.sortDate === null);
    expect(weekly).toHaveLength(2);
  });

  it("parses Golden Hour row correctly", () => {
    const rows = nineteenHzRows(LA_HTML);
    const goldenHour = rows.find((r) => r.title.includes("Chai Rave: Diwali at Sunset"));
    expect(goldenHour).toBeDefined();
    expect(goldenHour?.town).toBe("Los Angeles");
    expect(goldenHour?.sortDate).toBe("2026-11-06");
    expect(goldenHour?.url).toBe(
      "https://www.eventbrite.com/e/chai-rave-la-diwali-at-sunset-level8-on-nov-6th-special-diwali-edition-tickets-2001072923983",
    );
  });

  it("handles address venue correctly", () => {
    const rows = nineteenHzRows(LA_HTML);
    const morningAfters = rows.find((r) => r.title.includes("Friday Morning Afters w/ kariwood"));
    expect(morningAfters).toBeDefined();
    expect(morningAfters?.venue).toBe("1140 E 11th St");
    expect(morningAfters?.town).toBe("Los Angeles");
  });
});

describe("nineteenHzAdapter", () => {
  it("Golden Hour row: start night 2026-11-06 at 16:00", async () => {
    const ctx = ctxFor(LA_HTML);
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctx);
    const goldenHour = result.listings.find((l) =>
      l.listing.title.includes("Chai Rave: Diwali at Sunset"),
    );
    expect(goldenHour).toBeDefined();
    expect(goldenHour?.listing.local_date).toBe("2026-11-06");
    expect(goldenHour?.listing.doors_time).toBe("16:00");
    expect(goldenHour?.eventUrl).toBe(
      "https://www.eventbrite.com/e/chai-rave-la-diwali-at-sunset-level8-on-nov-6th-special-diwali-edition-tickets-2001072923983",
    );
  });

  it("lists the 4am row on the night before with the Nov 6 06:00 clock, by its street address", async () => {
    // Test with clock where 4am row is in window
    const ctx = ctxFor(LA_HTML, LA_METRO, new Date("2026-11-06T06:00:00Z"));
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctx);
    const morningAfters = result.listings.find((l) =>
      l.listing.title.includes("Friday Morning Afters w/ kariwood"),
    );
    expect(morningAfters).toBeDefined();
    expect(morningAfters?.listing.venue.address).toBe("1140 E 11th St, Los Angeles");
    expect(morningAfters?.listing.venue.name).toBeNull();
  });

  it("lists no San Diego or Costa Mesa row and no TBA venue", async () => {
    const rows = nineteenHzRows(LA_HTML);
    const droppedUrls = rows
      .filter((r) => r.town === "San Diego" || r.town === "Costa Mesa" || r.venue === "TBA")
      .map((r) => r.url)
      .filter((u): u is string => u !== null);
    expect(droppedUrls.length).toBeGreaterThan(5);
    const ctx = ctxFor(LA_HTML);
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctx);
    expect(result.listings.length).toBeGreaterThan(5);
    for (const listing of result.listings) {
      expect(droppedUrls).not.toContain(listing.listing.ticket_url);
      expect(listing.listing.venue.name?.toLowerCase()).not.toBe("tba");
    }
  });

  it("no instagram.com URLs", async () => {
    const ctx = ctxFor(LA_HTML);
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctx);
    for (const listing of result.listings) {
      expect(listing.eventUrl).not.toContain("instagram.com");
      if (listing.listing.ticket_url) {
        expect(listing.listing.ticket_url).not.toContain("instagram.com");
      }
    }
  });

  it("row with only instagram link gets source URL as eventUrl", async () => {
    const ctx = ctxFor(LA_HTML);
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctx);
    const instagramRow = result.listings.find((l) =>
      l.listing.title.includes("Ketchup b2b Mixmarkie"),
    );
    expect(instagramRow).toBeDefined();
    expect(instagramRow?.eventUrl).toBe(SOURCE.url);
  });

  it("keeps the ra.co ticket page, the key that merges it with the same RA night (D-592)", async () => {
    const ctx = ctxFor(LA_HTML);
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctx);
    const raRow = result.listings.find(
      (l) => l.listing.ticket_url === "https://ra.co/events/2560379",
    );
    expect(raRow?.listing.title).toContain("Potion");
    expect(raRow?.eventUrl).toBe("https://ra.co/events/2560379");
  });

  it("reads the clock in the metro's zone (Miami: America/New_York)", async () => {
    const ctx = ctxFor(LA_HTML, MIAMI_METRO);
    const result = await nineteenHzAdapter.harvest!({ ...SOURCE, metroId: "miami" }, ctx);
    const potion = result.listings.find(
      (l) => l.listing.ticket_url === "https://ra.co/events/2560379",
    );
    expect(potion?.tz).toBe("America/New_York");
    expect(potion?.listing.doors_time).toBe("21:30");
  });

  it("stops when robots.txt disallows the page", async () => {
    const ctx = ctxFor(LA_HTML, LA_METRO, new Date("2026-11-07T06:00:00Z"), {
      status: 200,
      body: "User-agent: *\nDisallow: /eventlisting_LosAngeles.php\n",
    });
    await expect(nineteenHzAdapter.harvest!(SOURCE, ctx)).rejects.toThrow(/robots\.txt disallows/);
  });

  it("keys a row on its ticket page, so a title edit keeps the same id", async () => {
    const before = await nineteenHzAdapter.harvest!(SOURCE, ctxFor(LA_HTML));
    const edited = LA_HTML.replace("Potion: Glo Phase, LUPE", "Potion: Glo Phase b2b LUPE");
    const after = await nineteenHzAdapter.harvest!(SOURCE, ctxFor(edited));
    const id = (r: typeof before) =>
      r.listings.find((l) => l.listing.ticket_url === "https://ra.co/events/2560379")?.externalId;
    expect(id(before)).toBeDefined();
    expect(id(after)).toBe(id(before));
  });

  // A bare venue name ("Kingdom") cannot be placed alone; the row's own town goes with it as the address hint, so
  // it places and merges with the same night from RA, Etix or DICE (Austin's first read, coverage-116, 2026-11-07).
  it("sends a bare venue name with its town as the address hint", async () => {
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctxFor(LA_HTML));
    const goldenHour = result.listings.find((l) =>
      l.listing.title.includes("Chai Rave: Diwali at Sunset"),
    );
    expect(goldenHour?.listing.venue.name).toBe("Golden Hour");
    expect(goldenHour?.listing.venue.address).toBe("Golden Hour, Los Angeles");
  });

  it("places a Texas row by venue and town (Kingdom, Austin) and leaves a street address as it was", async () => {
    const austin: Metro = {
      id: "austin",
      slug: "austin",
      name: "Austin",
      countryCode: "US",
      center: { lat: 30.2672, lng: -97.7431 },
      radiusKm: 40,
      tz: "America/Chicago",
      languages: ["en"],
    };
    const row = (title: string, venue: string) =>
      `<tr><td>Sat: Nov 7 <br />(10pm)</td><td><a href='https://www.etix.com/ticket/p/${title.length}'>${title}</a>` +
      ` @ ${venue} (Austin)<td>house</td><td>$20 | 18+</td><td></td><td></td>` +
      `<td><div class='shrink'>2026/11/07</div></td></tr>`;
    const html = `<table>${row("Doss", "Kingdom")}${row("Dawn Set", "1140 E 11th St")}</table>`;
    const result = await nineteenHzAdapter.harvest!(
      { ...SOURCE, metroId: "austin" },
      ctxFor(html, austin),
    );
    const doss = result.listings.find((l) => l.listing.title === "Doss");
    expect(doss?.listing.venue.name).toBe("Kingdom");
    expect(doss?.listing.venue.address).toBe("Kingdom, Austin");
    const dawn = result.listings.find((l) => l.listing.title === "Dawn Set");
    expect(dawn?.listing.venue.name).toBeNull();
    expect(dawn?.listing.venue.address).toBe("1140 E 11th St, Austin");
  });

  it("throws on empty page", async () => {
    const ctx = ctxFor("");
    await expect(nineteenHzAdapter.harvest!(SOURCE, ctx)).rejects.toThrow(
      "19hz page shows no dated rows",
    );
  });

  it("notes line matches format", async () => {
    const ctx = ctxFor(LA_HTML);
    const result = await nineteenHzAdapter.harvest!(SOURCE, ctx);
    expect(result.notes?.[0]).toMatch(
      /^\d+ rows; \d+ dated; \d+ weekly rows skipped; \d+ in the window; \d+ outside the metro; \d+ no venue; \d+ no time; \d+ listed$/,
    );
  });
});
