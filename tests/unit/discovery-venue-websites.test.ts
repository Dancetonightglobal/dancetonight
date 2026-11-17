import path from "node:path";

import { describe, expect, it } from "vitest";

import { chooseCandidates, priorityOf, type VenueSite } from "@/src/pipeline/discovery/candidates";
import { hostSkip, siteHost } from "@/src/pipeline/discovery/hosts";
import {
  eventPageLinks,
  failureStatus,
  isBotWall,
  namesPlace,
  probeSite,
} from "@/src/pipeline/discovery/site-probe";
import {
  createPoliteHttp,
  fixtureTransport,
  HttpError,
  loadFixtures,
  type Fixture,
} from "@/src/pipeline/http";

const NYC = { slug: "nyc", center: { lat: 40.7128, lng: -74.006 }, radiusKm: 40 };
const BROOKLYN = { lat: 40.7081, lng: -73.9571 };
const NEWARK = { lat: 40.7357, lng: -74.1724 };

const venue = (over: Partial<VenueSite>): VenueSite => ({
  venueId: "v1",
  name: "Club One",
  kind: "night_club",
  danceFloor: "yes",
  websiteUrl: "https://clubone.example/",
  location: BROOKLYN,
  ...over,
});

const ok = (url: string, body: string, finalUrl = url): Fixture => ({
  request: { method: "GET", url },
  response: { url: finalUrl, status: 200, headers: { "content-type": "text/html" }, body },
});
const status = (url: string, code: number): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: code, headers: {}, body: "" },
});
const robots = (origin: string, body = "User-agent: *\nDisallow:\n") =>
  ok(`${origin}/robots.txt`, body);

function httpOver(fixtures: Fixture[]) {
  let t = Date.parse("2026-10-04T16:00:00Z");
  const transport = fixtureTransport(fixtures);
  const http = createPoliteHttp({
    transport,
    userAgent: "DanceTonightBot/1.0 (+https://dancetonight.vercel.app/bot)",
    now: () => t,
    sleep: async (ms) => void (t += ms),
  });
  return { http, requests: transport.requests };
}

describe("hosts", () => {
  it("compares hosts lowercased and without www., and only http(s)", () => {
    expect(siteHost("https://WWW.Club.com/events")).toBe("club.com");
    expect(siteHost("http://club.com")).toBe("club.com");
    expect(siteHost("mailto:hi@club.com")).toBeNull();
    expect(siteHost("not a url")).toBeNull();
  });

  it("skips Tier D, other lanes' platforms and sites that are not the venue's own", () => {
    expect(hostSkip("ra.co")?.kind).toBe("tier_d");
    expect(hostSkip("www.dice.fm")?.kind).toBe("tier_d");
    expect(hostSkip("www.eventbrite.com")?.kind).toBe("platform");
    expect(hostSkip("eventbrite.co.uk")?.kind).toBe("platform");
    expect(hostSkip("linktr.ee")?.kind).toBe("not_a_venue_site");
    expect(hostSkip("en.wikipedia.org")?.kind).toBe("not_a_venue_site");
    expect(hostSkip("www1.nyc.gov")?.reason).toBe("a government portal");
    // D-846: a university's campus-wide calendar; a department's own site is still probed.
    const campus = "a university's campus-wide calendar";
    expect(hostSkip("calendar.usc.edu")?.reason).toBe(campus);
    expect(hostSkip("trojanevents.usc.edu")?.reason).toBe(campus);
    expect(hostSkip("events.ox.ac.uk")?.reason).toBe(campus);
    expect(hostSkip("www.events.unimelb.edu.au")?.reason).toBe(campus);
    expect(hostSkip("kaufman.usc.edu")).toBeNull();
    expect(hostSkip("usc.edu")).toBeNull();
    expect(hostSkip("calendar.example.com")).toBeNull();
    expect(hostSkip("www.aoh.com")?.kind).toBe("not_a_venue_site");
    expect(hostSkip("www.houseofpoitier.com")?.kind).toBe("not_a_venue_site");
    expect(hostSkip("houseofpoitier.com")?.reason).toBe("a swingers' club, not a dance venue");
    expect(hostSkip("blog.archive.org")?.reason).toBe("the Internet Archive");
    expect(hostSkip("local.yahoo.com")?.kind).toBe("not_a_venue_site");
    expect(hostSkip("www.groupon.com")?.kind).toBe("not_a_venue_site");
    expect(hostSkip("starrbar.com")).toBeNull();
    // A name that merely contains a skipped one is a venue's.
    expect(hostSkip("myra.co")).toBeNull();
  });
});

describe("choosing candidates", () => {
  it("puts club, salsa and nightlife places first and studios last", () => {
    const order = [
      { kind: "studio", danceFloor: "unknown" as const },
      { kind: "other", danceFloor: "unknown" as const },
      { kind: "night_club", danceFloor: "unknown" as const },
      { kind: "dance_hall", danceFloor: "yes" as const },
      { kind: "night_club", danceFloor: "yes" as const },
      { kind: "bar", danceFloor: "unknown" as const },
      { kind: "community_center", danceFloor: "unknown" as const },
    ]
      .map((v) => priorityOf(v))
      .sort((a, b) => a.priority - b.priority)
      .map((p) => p.group);
    expect(order).toEqual([
      "dance or salsa club",
      "dance hall",
      "nightlife venue",
      "lounge",
      "music or event venue",
      "community or social club",
      "dance studio",
    ]);
  });

  it("gives one candidate per host, ordered by its best place, and names every skip", () => {
    const { candidates, skipped } = chooseCandidates(
      [
        venue({
          venueId: "s1",
          name: "Studio A",
          kind: "studio",
          danceFloor: "unknown",
          websiteUrl: "https://chain.example/a",
        }),
        venue({
          venueId: "s2",
          name: "Studio B",
          kind: "studio",
          danceFloor: "unknown",
          websiteUrl: "https://www.chain.example/b",
        }),
        venue({ venueId: "c1", name: "Club Z", websiteUrl: "https://zclub.example/" }),
        venue({
          venueId: "n1",
          name: "Newark Hall",
          websiteUrl: "https://newark.example/",
          location: NEWARK,
        }),
        venue({ venueId: "k1", name: "Known", websiteUrl: "https://known.example/" }),
        venue({ venueId: "r1", name: "Gone", websiteUrl: "https://gone.example/" }),
        venue({ venueId: "l1", name: "Linky", websiteUrl: "https://linktr.ee/linky" }),
        venue({ venueId: "e1", name: "Ticketed", websiteUrl: "https://www.eventbrite.com/o/123" }),
      ],
      new Map([
        ["known.example", { url: "https://known.example/cal", enabled: true }],
        ["gone.example", { url: "https://gone.example/", enabled: false }],
      ]),
      NYC,
    );
    expect(candidates.map((c) => [c.host, c.venueId, c.group])).toEqual([
      ["zclub.example", "c1", "dance or salsa club"],
      // Two places share one site: no single venue is attached.
      ["chain.example", null, "dance studio"],
    ]);
    expect(candidates[1]!.venueNames).toEqual(["Studio A", "Studio B"]);
    expect(skipped.map((s) => [s.host, s.reason])).toEqual([
      ["known.example", "already a source"],
      ["linktr.ee", "not_a_venue_site"],
      ["newark.example", "outside the metro"],
      ["eventbrite.com", "platform"],
      ["gone.example", "retired"],
    ]);
  });

  it("keeps a host listed by a place inside the outline even when another place outside lists it", () => {
    const { candidates, skipped } = chooseCandidates(
      [
        venue({
          venueId: "a",
          name: "Uptown",
          websiteUrl: "https://two.example/",
          location: NEWARK,
        }),
        venue({ venueId: "b", name: "Downtown", websiteUrl: "https://two.example/bk" }),
      ],
      new Map(),
      NYC,
    );
    expect(candidates.map((c) => [c.host, c.venueId, c.url])).toEqual([
      ["two.example", "b", "https://two.example/bk"],
    ]);
    expect(skipped).toEqual([]);
  });
});

describe("hosts that are not lane 4's to probe", () => {
  it("skips another lane's venues, names a website that is not a web address, and says what an earlier probe found", () => {
    const { candidates, skipped } = chooseCandidates(
      [
        venue({
          venueId: "a",
          name: "3 Dollar Bill",
          websiteUrl: "https://www.3dollarbillbk.com/",
        }),
        venue({
          venueId: "b",
          name: "House of Yes",
          websiteUrl: "https://calendar.houseofyes.org/",
        }),
        venue({ venueId: "c", name: "Elsewhere", websiteUrl: "https://www.elsewhere.club/events" }),
        venue({ venueId: "d", name: "No Scheme", websiteUrl: "noscheme.example" }),
        venue({ venueId: "e", name: "Held Club", websiteUrl: "https://held.example/" }),
      ],
      new Map([
        ["held.example", { url: "https://held.example/events", enabled: false, status: "held" }],
      ]),
      NYC,
    );
    expect(candidates).toEqual([]);
    expect(skipped.map((s) => [s.host, s.reason, s.detail])).toEqual([
      ["3dollarbillbk.com", "another lane's", "3 Dollar Bill: lane 3's starting source"],
      ["calendar.houseofyes.org", "another lane's", "House of Yes: lane 3's starting source"],
      ["elsewhere.club", "another lane's", "Elsewhere: lane 5's, through its Eventbrite organizer"],
      ["noscheme.example", "not a web address", "the stored website is not an http(s) address"],
      ["held.example", "probed before", "held: https://held.example/events"],
    ]);
  });
});

describe("whether a page is still the place's", () => {
  const page = (text: string) =>
    `<html><head><title>${text}</title></head><body><p>${text}</p></body></html>`;

  it("finds an identifying word of the name in the page or the host", () => {
    expect(namesPlace(["Starr Bar"], "starrbar.com", page("Welcome"))).toBe(true);
    expect(namesPlace(["Signal"], "signalnyc.club", page("Events"))).toBe(true);
    expect(namesPlace(["Lovers Rock"], "loversrocknyc.com", page("Lovers Rock tonight"))).toBe(
      true,
    );
    expect(
      namesPlace(["Club Tropicana"], "tropic-nights.example", page("Club Tropicana tonight")),
    ).toBe(true);
  });

  it("ignores the city, alone or glued to the name", () => {
    expect(
      namesPlace(["40/40 Night Club, New York City"], "the4040club.com", page("Welcome")),
    ).toBe(true);
    expect(namesPlace(["Nexonyc"], "nexonewyork.com", page("Welcome"))).toBe(true);
  });

  it("reads a page that names nobody we know as repurposed", () => {
    expect(
      namesPlace(["Club Tropicana"], "ct-nyc.example", page("Ten best crypto wallets of 2026")),
    ).toBe(false);
  });

  it("reads only what a visitor sees: a name in a script, a style or a comment does not count", () => {
    const html =
      '<script>var venue = "Club Tropicana";</script><style>.tropicana{}</style><!-- tropicana --><p>Ten best crypto wallets</p>';
    expect(namesPlace(["Club Tropicana"], "ct-nyc.example", html)).toBe(false);
  });

  it("cannot check a name made only of common words, and does not guess", () => {
    expect(namesPlace(["The Dance Studio"], "x.example", page("Anything"))).toBe(true);
  });
});

describe("events page links", () => {
  it("follows the site's own calendar links, best first, and nothing off the site", () => {
    const html = `
      <a href="/about">About</a>
      <a href="/events">Events</a>
      <a href="/calendar/">What's on</a>
      <a href="https://calendar.club.example/">Calendar</a>
      <a href="https://ra.co/clubs/1">Events on RA</a>
      <a href="/events/2026/10/one-party">One party</a>
      <a href="/wp-login.php">Events login</a>
      <a href="/#events">Events</a>
      <a href="/private-events/">Private events</a>
      <a href="/menus/party-menu/">Party menu</a>
      <a href="/event-venues">Event venues</a>
      <a href="/events-rentals">Book an event</a>`;
    expect(eventPageLinks(html, "https://club.example/")).toEqual([
      "https://club.example/events",
      // Equal scores: the shorter address first, then alphabetical.
      "https://calendar.club.example/",
      "https://club.example/calendar/",
    ]);
  });
});

describe("failures", () => {
  it("reads gone domains as dead, refusals as blocked and the rest as unreachable", () => {
    expect(
      failureStatus(new HttpError("http_status", "u", "the site answered 404", 404)).status,
    ).toBe("dead");
    expect(
      failureStatus(new HttpError("http_status", "u", "the site answered 410", 410)).status,
    ).toBe("dead");
    expect(
      failureStatus(
        new HttpError("network", "u", "fetch failed: ENOTFOUND getaddrinfo ENOTFOUND x"),
      ).status,
    ).toBe("dead");
    expect(failureStatus(new HttpError("stopped", "u", "the site answered 403", 403)).status).toBe(
      "blocked",
    );
    expect(
      failureStatus(new HttpError("robots_disallowed", "u", "robots.txt disallows /")).status,
    ).toBe("blocked");
    expect(
      failureStatus(new HttpError("http_status", "u", "the site answered 502", 502)).status,
    ).toBe("unreachable");
    expect(failureStatus(new HttpError("network", "u", "fetch failed: ECONNRESET")).status).toBe(
      "unreachable",
    );
    expect(failureStatus(new HttpError("timeout", "u", "no answer within 20 s")).status).toBe(
      "unreachable",
    );
    // robots.txt fails first on a dead or struggling host: why it failed decides.
    const robots = (why: string) =>
      failureStatus(new HttpError("robots_disallowed", "u", why)).status;
    expect(
      robots(
        "robots.txt could not be fetched (fetch failed: ENOTFOUND getaddrinfo ENOTFOUND x.com), which counts as disallowing the whole site",
      ),
    ).toBe("dead");
    expect(robots("robots.txt answered 503, which counts as disallowing the whole site")).toBe(
      "unreachable",
    );
    expect(
      robots(
        "robots.txt could not be fetched (no answer within 20 s), which counts as disallowing the whole site",
      ),
    ).toBe("unreachable");
    expect(robots("robots.txt disallows / (rule: disallow /)")).toBe("blocked");
  });
});

describe("probing a venue's site", () => {
  const ORIGIN = "https://clubone.example";
  const site = { url: `${ORIGIN}/`, venueNames: ["Club One Brooklyn"] };

  it("ends at the home page when it names a feed", async () => {
    const { http } = httpOver([
      robots(ORIGIN),
      ok(
        `${ORIGIN}/`,
        '<h1>Club One</h1><link rel="alternate" type="text/calendar" href="/cal.ics">',
      ),
    ]);
    const outcome = await probeSite(http, site);
    expect(outcome).toMatchObject({
      status: "structured",
      kind: "feed_ics",
      feedUrl: `${ORIGIN}/cal.ics`,
      url: `${ORIGIN}/`,
      requests: 2,
    });
  });

  it("follows an events link when the home page has no feed, and stops at the first that does", async () => {
    const { http, requests } = httpOver([
      robots(ORIGIN),
      ok(
        `${ORIGIN}/`,
        '<h1>Club One</h1><a href="/events">Events</a><a href="/calendar">Calendar</a>',
      ),
      ok(`${ORIGIN}/events`, '<div class="tribe-events-calendar"></div>'),
    ]);
    const outcome = await probeSite(http, site);
    expect(outcome).toMatchObject({
      status: "structured",
      kind: "wp_tribe",
      url: `${ORIGIN}/events`,
    });
    expect(requests).toHaveLength(3);
  });

  it("is page only when an events page carries nothing structured, and names Tier D calendars", async () => {
    const { http } = httpOver([
      robots(ORIGIN),
      ok(`${ORIGIN}/`, '<h1>Club One</h1><a href="/events">Events</a>'),
      ok(
        `${ORIGIN}/events`,
        '<p>Fri Oct 9: Disco</p><a href="https://ra.co/events/1">Tickets</a><a href="https://www.eventbrite.com/o/club-one-12345678">More</a>',
      ),
    ]);
    const outcome = await probeSite(http, site);
    expect(outcome).toMatchObject({
      status: "page_only",
      url: `${ORIGIN}/events`,
      tierD: ["ra.co"],
    });
    expect(outcome.discovered.map((d) => d.platform)).toEqual(["eventbrite"]);
  });

  it("is nothing when the home page has no events page", async () => {
    const { http } = httpOver([
      robots(ORIGIN),
      ok(`${ORIGIN}/`, "<h1>Club One</h1><p>Open late</p>"),
    ]);
    expect((await probeSite(http, site)).status).toBe("nothing");
  });

  it("retires a parked domain and one that no longer names the place", async () => {
    const parked = httpOver([
      robots(ORIGIN),
      ok(`${ORIGIN}/`, "<h1>This domain is for sale!</h1>"),
    ]);
    expect(await probeSite(parked.http, site)).toMatchObject({
      status: "dead",
      reason: "a parked domain",
    });
    const blog = httpOver([robots(ORIGIN), ok(`${ORIGIN}/`, "<h1>Ten best crypto wallets</h1>")]);
    expect(
      (await probeSite(blog.http, { ...site, url: `${ORIGIN}/`, venueNames: ["Tropicana"] }))
        .status,
    ).toBe("repurposed");
  });

  it("records a bot wall's challenge page as blocked", async () => {
    const { http } = httpOver([
      robots(ORIGIN),
      ok(
        `${ORIGIN}/`,
        '<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head></html>',
      ),
    ]);
    expect(await probeSite(http, site)).toMatchObject({
      status: "blocked",
      reason: "a bot wall's challenge page",
    });
  });

  it("records a 404 as dead and a 403 as blocked, and asks nothing more", async () => {
    const gone = httpOver([robots(ORIGIN), status(`${ORIGIN}/`, 404)]);
    expect((await probeSite(gone.http, site)).status).toBe("dead");
    const walled = httpOver([robots(ORIGIN), status(`${ORIGIN}/`, 403)]);
    expect((await probeSite(walled.http, site)).status).toBe("blocked");
    expect(walled.requests).toHaveLength(2);
  });

  it("honours robots.txt: a refused home page is blocked, never fetched", async () => {
    const { http, requests } = httpOver([robots(ORIGIN, "User-agent: *\nDisallow: /\n")]);
    expect((await probeSite(http, site)).status).toBe("blocked");
    expect(requests).toEqual([`GET ${ORIGIN}/robots.txt`]);
  });
});

describe("probing the real sites saved on 2026-10-04", () => {
  // Pages recorded by `pnpm discover --record` against the live sites (robots.txt honoured).
  const saved = loadFixtures(path.join(__dirname, "fixtures/discovery"));
  const probe = async (url: string, venueNames: string[]) => {
    const { http } = httpOver(await saved);
    return probeSite(http, { url, venueNames });
  };

  it("finds Copacabana's and Retro Club's iCalendar exports on their home pages", async () => {
    expect(await probe("https://thecopanyc.com/", ["Copacabana Nightclub"])).toMatchObject({
      status: "structured",
      kind: "feed_ics",
      feedUrl: "https://thecopanyc.com/events/?ical=1",
    });
    expect(await probe("http://www.retroclubnyc.com", ["Retroclubnyc"])).toMatchObject({
      status: "structured",
      kind: "feed_ics",
      feedUrl: "https://retroclubnyc.com/events/?ical=1",
    });
  });

  it("finds 3 Dollar Bill's Squarespace events collection and names it for lane 3's reader", async () => {
    expect(await probe("http://3dollarbillbk.com/", ["3 Dollar Bill"])).toMatchObject({
      status: "structured",
      kind: "squarespace",
      url: "https://www.3dollarbillbk.com/",
    });
  });

  it("reads Nebula's events page as page only, and never opens its private-events page", async () => {
    expect(await probe("http://Nebulanewyork.com/", ["Nebula"])).toMatchObject({
      status: "page_only",
      url: "https://www.nebulanewyork.com/events",
    });
  });

  it("retires La Clave, whose domain now redirects to a parking error page", async () => {
    expect(await probe("http://LaClaveNYC.com/", ["La Clave NYC"])).toMatchObject({
      status: "moved",
      reason: "the site redirects to clkmg.com",
    });
  });

  it("records 230 Fifth's SiteGround captcha as a bot wall", async () => {
    const [wall] = (await saved).filter(
      (f) => f.request.url === "https://230-fifth.com/robots.txt",
    );
    expect(isBotWall(wall!.response)).toBe(true);
    expect(isBotWall({ status: 200, body: "<html><title>Club</title></html>" })).toBe(false);
  });
});
