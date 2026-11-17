// Eventbrite organizers resolved from event links (D-131), and what Elsewhere adds to New York.

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EVENTBRITE_API,
  eventbriteAdapter,
  eventbriteEventId,
  eventbriteEventIdsInHtml,
  eventbriteEventsUrl,
  eventbriteToListings,
} from "@/src/adapters/apis/eventbrite";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { localDateOf } from "@/src/domain/time";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";
import { normalizeListing } from "@/src/pipeline/normalize";

const ELSEWHERE_PAGE = readFileSync(
  path.join(__dirname, "__fixtures__/elsewhere-events.excerpt.txt"),
  "utf8",
);
const NOW = new Date("2026-10-04T16:00:00Z"); // Sunday, noon in New York
const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};
const ELSEWHERE: Source = {
  id: "s",
  url: "https://www.elsewhere.club/events",
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  feedUrl: null,
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

/** The page's own event cards (schema.org microdata), in the Eventbrite API's event shape. */
interface Card {
  id: string;
  name: string;
  startUtc: string;
  badge: string | null;
}
function cards(html: string): Card[] {
  return html
    .split("<article")
    .slice(1)
    .map((a) => ({
      id: /eventbrite\.com\/e\/[^"]*?(\d{9,})"/.exec(a)?.[1] ?? "",
      name: /itemProp="name">([^<]+)<\/span>/.exec(a)?.[1]?.replace(/&amp;/g, "&") ?? "",
      startUtc: /dateTime="([^"]+)"[^>]*itemProp="startDate"/.exec(a)?.[1] ?? "",
      badge: /<ul><li>(club|live)<\/li>/.exec(a)?.[1] ?? null,
    }));
}
const localIso = (utc: string) => {
  const at = new Date(utc);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: NYC.tz,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `${localDateOf(at, NYC.tz)}T${time}:00`;
};
const asApiEvent = (card: Card) => ({
  id: card.id,
  name: { text: card.name },
  url: `https://www.eventbrite.com/e/${card.id}`,
  start: { timezone: NYC.tz, local: localIso(card.startUtc) },
  end: null,
  status: "live",
  online_event: false,
  venue: {
    name: "Elsewhere",
    address: {
      localized_address_display: "599 Johnson Ave, Brooklyn, NY 11237",
      latitude: "40.7094",
      longitude: "-73.9232",
    },
  },
});

function ctxWith(
  respond: (req: TransportRequest) => { status: number; body: string },
): RunCtx & { seen: string[] } {
  const seen: string[] = [];
  let t = NOW.getTime();
  return {
    metro: NYC,
    now: () => new Date(t),
    env: { EVENTBRITE_PRIVATE_TOKEN: "secret-token" },
    log: () => {},
    seen,
    http: createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
      transport: async (req) => {
        seen.push(req.url);
        return { url: req.url, headers: {}, ...respond(req) };
      },
    }),
  };
}

const PAGE_CARDS = cards(ELSEWHERE_PAGE);
// Built from the documented shapes: an event names its organizer by id; the organizer's list
// holds every card on the page but the last, which another promoter sells.
const ORGANIZER = "11112222333";
const PROMOTER = "44445555666";
const LAST = PAGE_CARDS.at(-1)!;
const answer = (req: TransportRequest) => {
  if (req.url === "https://www.elsewhere.club/robots.txt")
    return {
      status: 200,
      body: "User-agent: *\nSitemap: https://www.elsewhere.club/sitemap.xml\n",
    };
  if (req.url === ELSEWHERE.url) return { status: 200, body: ELSEWHERE_PAGE };
  const event = /\/v3\/events\/(\d+)\/$/.exec(req.url)?.[1];
  if (event === "1990000000000") return { status: 404, body: '{"error":"NOT_FOUND"}' };
  if (event)
    return {
      status: 200,
      body: JSON.stringify({ id: event, organizer_id: event === LAST.id ? PROMOTER : ORGANIZER }),
    };
  if (req.url === eventbriteEventsUrl({ kind: "organizers", id: ORGANIZER }))
    return {
      status: 200,
      body: JSON.stringify({
        events: PAGE_CARDS.slice(0, -1).map(asApiEvent),
        pagination: { has_more_items: false },
      }),
    };
  if (req.url === eventbriteEventsUrl({ kind: "organizers", id: PROMOTER }))
    return {
      status: 200,
      body: JSON.stringify({ events: [asApiEvent(LAST)], pagination: { has_more_items: false } }),
    };
  return { status: 500, body: "unexpected" };
};

describe("Eventbrite event links", () => {
  it("reads an event id from any slug, host or query, and nothing else", () => {
    expect(
      eventbriteEventId(
        "https://www.eventbrite.com/e/disco-tehran-anniversary-party-tickets-1995466938329",
      ),
    ).toBe("1995466938329");
    expect(eventbriteEventId("https://www.eventbrite.co.uk/e/1995466938329/")).toBe(
      "1995466938329",
    );
    expect(eventbriteEventId("https://www.eventbrite.com/o/115478120751")).toBeNull();
    expect(eventbriteEventId("https://eventbrite.com.evil.example/e/1995466938329")).toBeNull();
    expect(eventbriteEventId("https://example.org/e/1995466938329")).toBeNull();
    expect(eventbriteEventId("https://www.eventbrite.com/e/slug-1995466938329/tickets")).toBe(
      "1995466938329",
    );
  });

  it("finds Elsewhere's 36 event links on its page, which names no organizer", () => {
    expect(eventbriteEventIdsInHtml(ELSEWHERE_PAGE)).toHaveLength(36);
    expect(ELSEWHERE_PAGE).not.toMatch(/eventbrite\.[a-z.]+\/o\//);
  });

  it("finds links a script wrote protocol-relative, JSON-escaped or followed by an entity", () => {
    expect(
      eventbriteEventIdsInHtml(
        '<a href="//www.eventbrite.com/e/a-1111111111111">a</a>' +
          '<script>{"url":"https:\\/\\/www.eventbrite.com\\/e\\/b-2222222222222"}</script>' +
          '<a href="https://www.eventbrite.com/e/c-3333333333333&amp;aff=x">c</a>' +
          '<a href="https://www.eventbrite.com/e/d-4444444444444/tickets">d</a>' +
          '<a href="https://eventbrite.com.evil.example/e/e-5555555555555">e</a>',
      ),
    ).toEqual(["1111111111111", "2222222222222", "3333333333333", "4444444444444"]);
  });
});

describe("the Eventbrite adapter, from event links", () => {
  it("reads a venue page's organizers, looking up only events not yet read", async () => {
    const ctx = ctxWith(answer);
    const result = await eventbriteAdapter.harvest!(ELSEWHERE, ctx);
    const lookups = ctx.seen.filter((u) => /\/v3\/events\/\d+\/$/.test(u));
    // The first card's organizer lists 35 of the 36; only the last is looked up again.
    expect(lookups).toEqual([
      `${EVENTBRITE_API}/events/${PAGE_CARDS[0]!.id}/`,
      `${EVENTBRITE_API}/events/${LAST.id}/`,
    ]);
    expect(result.notes?.slice(0, 2)).toEqual([
      `organizer ${ORGANIZER}, from the page's link to event ${PAGE_CARDS[0]!.id}`,
      `organizer ${PROMOTER}, from the page's link to event ${LAST.id}`,
    ]);
    // Read under the page's own address, so its mixed-calendar flag applies.
    expect(result.doc?.url).toBe(ELSEWHERE.url);
    expect(ctx.seen.every((u) => !u.includes("secret-token"))).toBe(true);
  });
});

describe("what Elsewhere adds, replayed from its page of 2026-10-04", () => {
  it("lists its club nights and screens its concerts (mixed calendar, D-083)", () => {
    const { listings } = eventbriteToListings(PAGE_CARDS.map(asApiEvent), {
      fetchedAt: NOW,
      metroTz: NYC.tz,
      fromNight: "2026-10-04",
    });
    const badge = new Map(PAGE_CARDS.map((c) => [c.name, c.badge]));
    const outcomes = listings.map((l) => ({
      badge: badge.get(l.listing.title) ?? null,
      title: l.listing.title.slice(0, 24),
      outcome: normalizeListing(l, {
        metro: NYC,
        source: { ...ELSEWHERE, mixedCalendar: true },
        now: NOW,
      }),
    }));
    // In the 14 nights from 2026-10-04 the page has 11 events: 5 club nights, 6 concerts.
    expect(outcomes.map((o) => o.badge).sort()).toEqual([
      ...Array<string>(5).fill("club"),
      ...Array<string>(6).fill("live"),
    ]);
    const kept = outcomes.flatMap((o) =>
      o.outcome.ok ? [[o.outcome.event.nightDate, o.badge, o.title]] : [],
    );
    expect(kept).toEqual([
      ["2026-10-04", "club", "Disco Tehran Anniversary"],
      ["2026-10-04", "club", "Ninajirachi After Party "],
      ["2026-10-16", "club", "Marsolo, JACK MARLOW, Na"],
      // 10:30pm on the 17th: the page's UTC date says the 18th.
      ["2026-10-17", "club", "Tye Turner + ZABAAN pres"],
    ]);
    // Every concert is screened; so is one 6pm club night (MIRCHI), which names no dance.
    expect(
      outcomes.filter((o) => !o.outcome.ok).map((o) => [o.badge, o.title.slice(0, 6)]),
    ).toEqual([
      ["live", "cootie"],
      ["live", "Madi D"],
      ["live", "Elsewh"],
      ["live", "Slow M"],
      ["live", "Gilla "],
      ["club", "MIRCHI"],
      ["live", "DJ_Dav"],
    ]);
  });

  it("is a best case: a concert whose description names a dance party gets past the screen", () => {
    // The page gives no descriptions; the API does, and buildListing reads styles and the
    // listing type from them. This is the limit of D-083's screen on Eventbrite, said here.
    const concert = PAGE_CARDS.find((c) => c.name.startsWith("Slow Magic"))!;
    const { listings } = eventbriteToListings(
      [
        {
          ...asApiEvent(concert),
          description: { text: "Live set, then a dance party with DJs until late." },
        },
      ],
      { fetchedAt: NOW, metroTz: NYC.tz, fromNight: "2026-10-04" },
    );
    const outcome = normalizeListing(listings[0]!, {
      metro: NYC,
      source: { ...ELSEWHERE, mixedCalendar: true },
      now: NOW,
    });
    expect(outcome.ok).toBe(true);
  });
});
