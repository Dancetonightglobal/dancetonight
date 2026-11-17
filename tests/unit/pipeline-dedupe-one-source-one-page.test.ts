// D-766: one source's two listings of one night at one venue that point at the SAME specific event page,
// at one start or both untimed, are one listing whatever their titles. Miami 11-06: m2miami "Canal Zero" and
// "Canal Zero Anniversary", both untimed, one ticket page /events/canal-zero-mineu (event URL = the list
// page). Philadelphia 11-06: ourphilly "BalletX Studio Lindy Hop 101" and "Lindy Hop 101", both 18:45, one
// event page. A source's list page shared by two listings is not one event page.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-11-06T16:00:00Z");
const NIGHT = "2026-11-06";
const M2 = { lat: 25.7907, lng: -80.1301 };
const FAR = { lat: 25.7617, lng: -80.1918 }; // about 7 km away
let db: Db;
let metro: Metro;
let m2: Source;
let ourphilly: Source;

function event(
  source: Source,
  fields: Record<string, unknown>,
  id: string,
  eventUrl: string,
  point = M2,
) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "club_night",
      styles: [],
      venue: { name: "Club M2 Miami", address: "1235 Washington Ave, Miami Beach, FL 33139" },
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: id,
    eventUrl,
    tz: null,
    venueLocation: point,
    recurrence: null,
    provenance: { sourceUrl: `${source.url}#${id}`, fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(source: Source, list: ReturnType<typeof event>[]) {
  return writeEvents(db, {
    metro,
    source,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

async function live() {
  return (await db.select().from(events).where(eq(events.nightDate, NIGHT))).filter(
    (r) => r.status === "active",
  );
}

const M2_LIST = "https://www.m2miami.com/events";
const CANAL_TICKET = "https://www.m2miami.com/events/canal-zero-mineu";
const LINDY_PAGE = "https://www.ourphilly.org/events/balletx-lindy-hop-101-2026-11-06-1845";

describeDb("dedupe: one source, one event page, one night (D-766)", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_one_source_one_page");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "miami",
      name: "Miami",
      countryCode: "US",
      center: { lat: 25.7617, lng: -80.1918 },
      radiusKm: 60,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "miami"))!;
    m2 = await upsertSource(db, metro.id, {
      url: M2_LIST,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    ourphilly = await upsertSource(db, metro.id, {
      url: "https://www.ourphilly.org/tags/dance",
      kind: "html",
      trustTier: "unofficial",
      discoveredBy: "seed_list",
    });
  });

  it("merges two untimed titles with one ticket page (Canal Zero)", async () => {
    await write(m2, [
      event(m2, { title: "Canal Zero", ticket_url: CANAL_TICKET }, "c1", M2_LIST),
      event(m2, { title: "Canal Zero Anniversary", ticket_url: CANAL_TICKET }, "c2", M2_LIST),
    ]);
    expect(await live()).toHaveLength(2);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
  });

  it("merges two titles at one start with one event page (BalletX Lindy Hop 101)", async () => {
    const venue = {
      name: "BalletX Studio",
      address: "1923 Washington Ave, Philadelphia, PA 19146",
    };
    await write(ourphilly, [
      event(
        ourphilly,
        {
          title: "BalletX Studio Lindy Hop 101",
          listing_type: "class",
          venue,
          dancing_time: "18:45",
        },
        "l1",
        LINDY_PAGE,
      ),
      event(
        ourphilly,
        { title: "Lindy Hop 101", listing_type: "class", venue, dancing_time: "18:45" },
        "l2",
        LINDY_PAGE,
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(1);
    expect(await live()).toHaveLength(1);
  });

  it("keeps two listings that share only the source's list page", async () => {
    await write(m2, [
      event(m2, { title: "Canal Zero" }, "c3", M2_LIST),
      event(m2, { title: "Latin Fridays" }, "c4", M2_LIST),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });

  it("keeps one page's two starts apart", async () => {
    await write(m2, [
      event(
        m2,
        { title: "Canal Zero", ticket_url: CANAL_TICKET, dancing_time: "20:00" },
        "c5",
        M2_LIST,
      ),
      event(
        m2,
        { title: "Canal Zero Late", ticket_url: CANAL_TICKET, dancing_time: "23:00" },
        "c6",
        M2_LIST,
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });

  it("keeps one page at two venues apart", async () => {
    await write(m2, [
      event(m2, { title: "Canal Zero", ticket_url: CANAL_TICKET }, "c7", M2_LIST),
      event(
        m2,
        {
          title: "Canal Zero Anniversary",
          ticket_url: CANAL_TICKET,
          venue: { name: "Ball & Chain", address: "1513 SW 8th St, Miami, FL 33135" },
        },
        "c8",
        M2_LIST,
        FAR,
      ),
    ]);
    const report = await dedupeMetro(db, metro, [NIGHT]);
    expect(report.merged).toBe(0);
    expect(await live()).toHaveLength(2);
  });
});
