import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { viewcyAdapter } from "@/src/adapters/feeds/viewcy";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// https://www.viewcy.com/discover?q=dance (2026-10-25), cut to its self.__next_f.push scripts: the
// first 28 of 111 events, in Viewcy's own order (not by date).
const DIR = path.join(__dirname, "__fixtures__");
const DISCOVER_HTML = readFileSync(path.join(DIR, "viewcy-discover-dance.html"), "utf8");

const DISCOVER = "https://www.viewcy.com/discover?q=dance";
const PROFILE = "https://www.viewcy.com/jewishembodimentlab";

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

const source = (url: string): Source => ({
  id: "s",
  url,
  kind: "jsonld",
  trustTier: "first_party",
  platform: "viewcy",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
});

const html = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: { "content-type": "text/html" }, body },
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const transport = fixtureTransport([
    {
      request: { method: "GET", url: "https://www.viewcy.com/robots.txt" },
      response: {
        url: "https://www.viewcy.com/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-Agent: *\nDisallow: /auth\nDisallow: /login\nDisallow: /tickets\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
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
    requests: transport.requests,
  };
}

const NOW = new Date("2026-10-25T16:00:00Z"); // noon in New York; window 10-25..11-07

// A profile page as Viewcy serves it: the flight data split over two push scripts, cut mid-object,
// with upcomingEvents (read) and pastEvents (never read).
const ABHAYA = {
  id: "36c0a47d-93ee-47d5-a187-9fb9fdea8143",
  name: "Abhaya Yoga",
  address: "55 Prospect St #105",
  city: "Brooklyn",
  state: "New York",
  country: "US",
  zipcode: "11201",
  latitude: 40.7004,
  longitude: -73.9869,
};

function profileEvent(id: string, name: string, startsAt: string, endsAt: string) {
  return {
    id,
    name,
    description: "$66",
    categoryName: "Ceremonies",
    startsAt,
    endsAt,
    nextEvent: { id: `${id}-occ`, startsAt, endsAt, timezone: "America/New_York", course: id },
    timezone: "America/New_York",
    locationSetting: "physical",
    location: ABHAYA,
    visibility: "listed",
    url: `/event/${id}`,
  };
}

function profilePage(upcoming: unknown[], hasNextPage = false): string {
  const flight =
    "61:" +
    JSON.stringify({
      upcomingEvents: {
        data: upcoming,
        object: "list",
        page: 1,
        totalPages: hasNextPage ? 2 : 1,
        perPage: 30,
        totalCount: upcoming.length,
        hasNextPage,
      },
      pastEvents: {
        data: [
          profileEvent(
            "the_sabbath_dance_el",
            "The Sabbath Dance: Elul Homecoming",
            "2026-08-21T23:30:00Z",
            "2026-08-22T03:00:00Z",
          ),
        ],
        object: "list",
        page: 1,
        totalPages: 1,
        perPage: 30,
        totalCount: 1,
        hasNextPage: false,
      },
    }) +
    "\n";
  const cut = Math.floor(flight.length / 2);
  const push = (text: string) => `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;
  return `<!DOCTYPE html><html><head><title>The Jewish Embodiment Lab | Viewcy</title></head><body>${push(
    flight.slice(0, cut),
  )}${push(flight.slice(cut))}</body></html>`;
}

describe("viewcy reader", () => {
  it("reads the search page's events in the window that name a place", async () => {
    const run = ctx([html(DISCOVER, DISCOVER_HTML)], NOW);
    const result = await viewcyAdapter.harvest!(source(DISCOVER), run);

    expect(run.requests).toEqual(["GET https://www.viewcy.com/robots.txt", `GET ${DISCOVER}`]);
    // 28 events: 17 in the window with a place (places outside the metro, such as Kingston,
    // Sheffield or Tucson, are kept here: the ingest leaves them out by their point), 3 in the
    // window with no place, 8 after the window.
    expect(result.listings).toHaveLength(17);
    expect(result.listings.every((l) => l.listing.local_date! >= "2026-10-25")).toBe(true);
    expect(result.listings.every((l) => l.listing.local_date! <= "2026-11-07")).toBe(true);
    expect(result.notes).toContain("3 event(s) in the window name no place; left out");
    expect(result.notes).toContain("8 event(s) after the window or before tonight left out");
    // The search lists 111 events and the page carries the first 28 only: never whole.
    expect(result.whole).toBeUndefined();
    expect(result.notes).toContain("read the first 28 of 111 events listed");
  });

  it("gives each event its page, venue, address, point, start and end", async () => {
    const run = ctx([html(DISCOVER, DISCOVER_HTML)], NOW);
    const result = await viewcyAdapter.harvest!(source(DISCOVER), run);

    const habibti = result.listings.find(
      (l) => l.listing.title === "Habibti Club: Halloween Edition",
    );
    expect(habibti).toBeDefined();
    expect(habibti!.eventUrl).toBe("https://www.viewcy.com/event/habibti_club_hallowe");
    expect(habibti!.externalId).toBe(
      "https://www.viewcy.com/event/habibti_club_hallowe#2026-10-31T01:00:00Z",
    );
    expect(habibti!.listing.local_date).toBe("2026-10-30");
    expect(habibti!.listing.doors_time).toBe("21:00");
    expect(habibti!.listing.end_time).toBe("02:00");
    expect(habibti!.listing.venue.name).toBe("Honey's");
    expect(habibti!.listing.venue.address).toBe("99 Scott Ave, Brooklyn, New York 11237-1329");
    expect(habibti!.venueLocation).toEqual({ lat: 40.7105931, lng: -73.92322010000001 });
    expect(habibti!.listing.prices).toEqual([]);
  });

  it("keeps a place with an address and no point, for the geocoder", async () => {
    const run = ctx([html(DISCOVER, DISCOVER_HTML)], NOW);
    const result = await viewcyAdapter.harvest!(source(DISCOVER), run);

    const lindy = result.listings.find(
      (l) => l.listing.title === "Lindy Hop Class with Brian Lawton",
    );
    expect(lindy).toBeDefined();
    expect(lindy!.listing.venue.name).toBe("TEMPO Lounge");
    expect(lindy!.listing.venue.address).toBe("29 Wurts St, Kingston, New York 12401");
    expect(lindy!.venueLocation ?? null).toBeNull();
  });

  it("reads a profile's upcoming events only, whole when there is no next page", async () => {
    const page = profilePage([
      profileEvent(
        "the_sabbath_dance_ch",
        "The Sabbath Dance: Cheshvan",
        "2026-10-30T23:30:00Z",
        "2026-10-31T02:30:00Z",
      ),
    ]);
    const run = ctx([html(PROFILE, page)], NOW);
    const result = await viewcyAdapter.harvest!(source(PROFILE), run);

    expect(result.whole).toBe(true);
    expect(result.listings).toHaveLength(1);
    const dance = result.listings[0]!;
    expect(dance.listing.title).toBe("The Sabbath Dance: Cheshvan");
    expect(dance.eventUrl).toBe("https://www.viewcy.com/event/the_sabbath_dance_ch");
    expect(dance.listing.local_date).toBe("2026-10-30");
    expect(dance.listing.doors_time).toBe("19:30");
    expect(dance.listing.end_time).toBe("22:30");
    expect(dance.listing.venue.name).toBe("Abhaya Yoga");
    expect(dance.listing.venue.address).toBe("55 Prospect St #105, Brooklyn, New York 11201");
    expect(dance.venueLocation).toEqual({ lat: 40.7004, lng: -73.9869 });
  });

  it("reads a profile with nothing upcoming as whole and empty", async () => {
    const run = ctx([html(PROFILE, profilePage([]))], NOW);
    const result = await viewcyAdapter.harvest!(source(PROFILE), run);

    expect(result.whole).toBe(true);
    expect(result.listings).toEqual([]);
  });

  it("is not whole when the profile has a next page of upcoming events", async () => {
    const page = profilePage(
      [
        profileEvent(
          "the_sabbath_dance_ch",
          "The Sabbath Dance: Cheshvan",
          "2026-10-30T23:30:00Z",
          "2026-10-31T02:30:00Z",
        ),
      ],
      true,
    );
    const run = ctx([html(PROFILE, page)], NOW);
    const result = await viewcyAdapter.harvest!(source(PROFILE), run);

    expect(result.whole).toBeUndefined();
    expect(result.listings).toHaveLength(1);
  });

  it("drops an end more than a day after the start", async () => {
    const page = profilePage([
      profileEvent("retreat", "Dance Retreat", "2026-10-30T23:30:00Z", "2026-11-02T02:30:00Z"),
    ]);
    const run = ctx([html(PROFILE, page)], NOW);
    const result = await viewcyAdapter.harvest!(source(PROFILE), run);

    expect(result.listings[0]!.listing.end_time).toBeNull();
  });

  it("fails a page that carries no event list", async () => {
    const run = ctx([html(DISCOVER, "<html><body>Just a moment...</body></html>")], NOW);
    await expect(viewcyAdapter.harvest!(source(DISCOVER), run)).rejects.toThrow(/no event list/);
  });
});
