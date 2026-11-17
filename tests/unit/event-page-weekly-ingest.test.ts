// D-465 through whole ingest runs: DanceUS lists a weekly night as one dated JSON-LD Event for its next date only;
// the event's own page says "Recurring" and names the weekday, so the night becomes a weekly series. A later read
// that still lists it keeps the same rows (no duplicate); a read without it 3 days later keeps it (DanceUS's
// window rolls); a read without it 9 days later (past the 8-day cutoff) leaves no active row after tonight.
import { and, eq, gt, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, eventSources, metros } from "@/src/db/schema";
import { createPoliteHttp } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { loadMetro, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

// Monday 2026-11-02, noon in San Juan: the window holds Fridays 11-06 and 11-13.
const NOW = new Date("2026-11-02T16:00:00Z");
const CALENDAR = "https://www.danceus.org/events/salsa/puerto-rico-salsa-calendar/";
const TABERNA_PAGE =
  "https://www.danceus.org/event/15831770263678/salsa-dancing-fridays-at-taberna/";
const TITLE = "Salsa Dancing Fridays at Taberna Los Vazquez";

const event = (name: string, startDate: string, url: string) => ({
  "@type": "Event",
  name,
  startDate,
  url,
  location: {
    "@type": "Place",
    name: "Taberna Los Vazquez",
    address: "1348 Calle Orbeta, San Juan, 00907, Puerto Rico",
    geo: { "@type": "GeoCoordinates", latitude: 18.4489, longitude: -66.0689 },
  },
});
const calendar = (nodes: unknown[]) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": nodes,
  })}</script></head><body></body></html>`;
const TABERNA = event(TITLE, "2026-11-06T23:00:00-04:00", TABERNA_PAGE);
const OTHER = event(
  "Noche de Salsa @ Vaca Brava",
  "2026-11-05T21:00:00-04:00",
  "https://www.danceus.org/event/317703868116/noche-de-salsa-vaca-brava/",
);
const TABERNA_OWN_PAGE = `<html><head>
<meta name="description" content="Every Friday there&#39;s live salsa music and dancing at Taberna Los Vazquez.">
</head><body><div>Party · Social Salsa Recurring</div></body></html>`;

let db: Db;
let metro: Metro;

describeDb("DanceUS weekly nights from their own page (D-465)", () => {
  beforeAll(async () => {
    db = await testDb("event_page_weekly_ingest");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "san-juan",
      name: "San Juan",
      countryCode: "PR",
      center: { lat: 18.4655, lng: -66.1057 },
      radiusKm: 30,
      tz: "America/Puerto_Rico",
      languages: ["es", "en"],
    });
    metro = (await loadMetro(db, "san-juan"))!;
    await upsertSource(db, metro.id, {
      url: CALENDAR,
      kind: "jsonld",
      trustTier: "directory",
      discoveredBy: "seed_list",
      styles: ["salsa"],
    });
  });

  const DAY = 24 * 60 * 60 * 1000;
  const read = async (calendarHtml: string, daysLater = 0) => {
    let t = NOW.getTime() + daysLater * DAY;
    const http = createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
      transport: async (req) => {
        const body =
          req.url === CALENDAR ? calendarHtml : req.url === TABERNA_PAGE ? TABERNA_OWN_PAGE : "";
        return { url: req.url, status: 200, headers: {}, body };
      },
    });
    return runIngest({ db, metro, http, now: () => new Date(t), env: {}, only: [CALENDAR] });
  };
  const tabernaAhead = (after = "2026-11-02") =>
    db
      .select({ id: events.id, night: events.nightDate })
      .from(events)
      .where(and(eq(events.title, TITLE), eq(events.status, "active"), gt(events.nightDate, after)))
      .orderBy(events.nightDate);

  it("makes the Friday weekly, and a second read keeps the same rows", async () => {
    const first = await read(calendar([TABERNA, OTHER]));
    const line = first.sources.find((s) => s.url === CALENDAR);
    expect(line?.notes.join(" ")).toContain("made weekly");
    const rows = await tabernaAhead();
    expect(rows.map((r) => r.night)).toEqual(["2026-11-06", "2026-11-13"]);

    await read(calendar([TABERNA, OTHER]));
    expect(await tabernaAhead()).toEqual(rows);
  });

  it("keeps the night when a read 3 days later does not list it", async () => {
    await read(calendar([TABERNA, OTHER]));
    const rows = await tabernaAhead();
    await read(calendar([OTHER]), 3);
    expect(await tabernaAhead()).toEqual(rows);
  });

  it("retires the rows after tonight when a read 9 days later does not list it", async () => {
    await read(calendar([TABERNA, OTHER]));
    expect((await tabernaAhead("2026-11-11")).length).toBeGreaterThan(0);
    const later = await read(calendar([OTHER]), 9);
    expect(await tabernaAhead("2026-11-11")).toEqual([]);
    const line = later.sources.find((s) => s.url === CALENDAR);
    expect(line?.notes.join(" ")).toContain("has not given for 8 days");
  });

  it("keeps every row after tonight when a read 9 days later still lists the night", async () => {
    await read(calendar([TABERNA, OTHER]));
    const next = event(TITLE, "2026-11-13T23:00:00-04:00", TABERNA_PAGE);
    await read(calendar([next, OTHER]), 9);
    const rows = await tabernaAhead("2026-11-11");
    expect(rows.map((r) => r.night)).toEqual(["2026-11-13", "2026-11-20"]);
    const stale = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${eventSources} es join ${events} e on e.id = es.event_id
        where e.title = ${TITLE} and e.night_date > '2026-11-11' and es.last_seen_at < ${NOW.toISOString()}::timestamptz + interval '9 days'`,
    );
    expect(stale[0]!.n).toBe(0);
  });
});
