// D-792: Berlin 11-08. Ticketmaster's "Overmono - Pure Devotion - World Tour" was screened at ingest (D-757 after
// D-771), but its row stored before D-771 stayed listed: the stored-row check re-screens a row with its STORED
// styles. A listing screened at ingest now retires the row this source stored under the same key. Here Elsewhere's
// club night is stored at 22:30, then its source lists it at 19:00, where the venue's mixed calendar screens it.

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { EVENTBRITE_API, eventbriteEventsUrl } from "@/src/adapters/apis/eventbrite";
import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
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
const fixtures = (local: string): Fixture[] => [
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
        event("1999999999001", "Marsolo, Jack Marlow", local),
        event("1999999999002", "Gilla Band, PISS", "2026-10-09T19:00:00"),
      ],
      pagination: { has_more_items: false },
    }),
  ),
];

let db: Db;
let metro: Metro;

async function read(local: string, at: number) {
  let t = at;
  return runIngest({
    db,
    metro,
    env: { EVENTBRITE_PRIVATE_TOKEN: "test-token" },
    only: [PAGE],
    full: true,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport(fixtures(local)),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  });
}

async function active() {
  return (await db.select({ title: events.title, status: events.status }).from(events))
    .filter((r) => r.status === "active")
    .map((r) => r.title);
}

describeDb("a listing screened at ingest retires its stored row (D-792)", () => {
  beforeAll(async () => {
    db = await testDb("screened_stored_retire");
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

  it("the 22:30 club night stored earlier goes when the source's same event is screened at 19:00", async () => {
    await read("2026-10-09T22:30:00", NOW.getTime());
    expect(await active()).toEqual(["Marsolo, Jack Marlow"]);
    const report = await read("2026-10-09T19:00:00", NOW.getTime() + 3_600_000);
    const line = report.sources.find((s) => s.url === PAGE)!;
    expect(line.listings).toBe(0);
    expect(await active()).toEqual([]);
  });

  it("a night still listed stays", async () => {
    await read("2026-10-09T22:30:00", NOW.getTime());
    await read("2026-10-09T22:30:00", NOW.getTime() + 3_600_000);
    expect(await active()).toEqual(["Marsolo, Jack Marlow"]);
  });
});
