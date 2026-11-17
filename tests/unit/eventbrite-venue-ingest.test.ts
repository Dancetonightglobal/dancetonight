// A venue page seeded as an Eventbrite source, through one ingest run (D-131): Elsewhere's page
// links events, the API names their organizer, and the venue's mixed-calendar flag screens its
// concerts. The Eventbrite answers are built from the documented shape; no token exists here.

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { EVENTBRITE_API, eventbriteEventsUrl } from "@/src/adapters/apis/eventbrite";
import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, venues } from "@/src/db/schema";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { loadMetro } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-10-04T16:00:00Z");
const PAGE = "https://www.elsewhere.club/events";
const ORGANIZER = "11112222333";
const ok = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: {}, body },
});
const event = (id: string, name: string, local: string) => ({
  id,
  name: { text: name },
  url: `https://www.eventbrite.com/e/${id}`,
  start: { timezone: "America/New_York", local },
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
const FIXTURES: Fixture[] = [
  ok("https://www.elsewhere.club/robots.txt", "User-agent: *\n"),
  ok(
    PAGE,
    '<a href="https://www.eventbrite.com/e/club-night-1999999999001">Buy</a>' +
      '<a href="https://www.eventbrite.com/e/a-band-1999999999002">Buy</a>',
  ),
  ok(
    `${EVENTBRITE_API}/events/1999999999001/`,
    JSON.stringify({ id: "1999999999001", organizer_id: ORGANIZER }),
  ),
  ok(
    eventbriteEventsUrl({ kind: "organizers", id: ORGANIZER }),
    JSON.stringify({
      events: [
        event("1999999999001", "Marsolo, Jack Marlow", "2026-10-09T22:30:00"),
        event("1999999999002", "Gilla Band, PISS", "2026-10-09T19:00:00"),
      ],
      pagination: { has_more_items: false },
    }),
  ),
];

let db: Db;
let metro: Metro;

describeDb("a venue page read through Eventbrite, in one ingest run (D-131)", () => {
  beforeAll(async () => {
    db = await testDb("eventbrite_venue");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
  });

  it("lists Elsewhere's club night, screens its concert, and looks up one organizer", async () => {
    let t = NOW.getTime();
    const transport = fixtureTransport(FIXTURES);
    const report = await runIngest({
      db,
      metro,
      env: { EVENTBRITE_PRIVATE_TOKEN: "test-token" },
      only: [PAGE],
      now: () => new Date(t),
      http: createPoliteHttp({
        transport,
        userAgent: "DanceTonightBot/1.0",
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
    });
    const line = report.sources.find((s) => s.url === PAGE)!;
    expect(line).toMatchObject({ adapter: "eventbrite", status: "ok", listings: 1 });
    expect(line.notes).toContain(
      `organizer ${ORGANIZER}, from the page's link to event 1999999999001`,
    );
    // The second link is in the organizer's list already: one lookup, not two.
    expect(transport.requests.filter((r) => r.includes("/v3/events/"))).toHaveLength(1);
    // Nothing new is kept as a source of its own.
    expect(report.discovered).toBe(0);
    const titles = (await db.select({ title: events.title }).from(events)).map((r) => r.title);
    expect(titles).toEqual(["Marsolo, Jack Marlow"]);
  });

  it("stores the neighbourhood of a venue the run itself wrote, in that run (D-585)", async () => {
    let t = NOW.getTime();
    await runIngest({
      db,
      metro,
      env: { EVENTBRITE_PRIVATE_TOKEN: "test-token" },
      only: [PAGE],
      now: () => new Date(t),
      http: createPoliteHttp({
        transport: fixtureTransport(FIXTURES),
        userAgent: "DanceTonightBot/1.0",
        now: () => t,
        sleep: async (ms) => void (t += ms),
      }),
    });
    // Elsewhere did not exist before the run; the site no longer works a neighbourhood out itself.
    const rows = await db
      .select({ name: venues.name, location: venues.location, neighborhood: venues.neighborhood })
      .from(venues);
    expect(rows).toHaveLength(1);
    const expected = neighbourhoodAt(rows[0]!.location);
    expect(expected).not.toBeNull();
    expect(rows[0]!.neighborhood).toBe(expected);
  });
});
