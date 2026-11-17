// Where an event address leads (D-092): a merged listing's address goes to the listing that
// stands, page and calendar file alike; a listing that is gone, or never ours, answers 404 with
// the full missing-listing page.

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DbListingsRepository } from "@/src/data/db-repository";
import { MockListingsRepository } from "@/src/data/mock-repository";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { mergedDuplicateSlug, seedNyc } from "@/src/db/seed/nyc";
import { currentNightDate } from "@/src/domain/tonight";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";
import { config, MISSING_LISTING_HEADER, proxy } from "@/proxy";

requireDbInCi();

type EventInsert = typeof events.$inferInsert;
const row = (slug: string, fields: Partial<EventInsert> = {}): EventInsert => ({
  slug,
  title: slug,
  titleNormalized: slug,
  listingType: "social",
  styles: ["salsa"],
  nightDate: "2026-10-06",
  tz: "America/New_York",
  confirmation: "recurring_unconfirmed",
  ...fields,
});

let db: Db;
let repo: DbListingsRepository;

describeDb("DbListingsRepository.resolveSlug", () => {
  beforeAll(async () => {
    db = await testDb("event_address");
    repo = new DbListingsRepository(() => db);
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
  });

  async function insert(slug: string, fields: Partial<EventInsert> = {}): Promise<string> {
    const [r] = await db.insert(events).values(row(slug, fields)).returning({ id: events.id });
    return r!.id;
  }

  it("answers listed for an active or cancelled listing", async () => {
    await insert("english-tuesdays");
    await insert("called-off", { status: "cancelled", confirmation: "cancelled" });
    expect(await repo.resolveSlug("english-tuesdays")).toEqual({ kind: "listed" });
    expect(await repo.resolveSlug("called-off")).toEqual({ kind: "listed" });
  });

  it("follows a merged listing to the one that stands, through a chain of merges", async () => {
    const top = await insert("english-tuesdays");
    const mid = await insert("english-country-dancing", { status: "merged", mergedIntoId: top });
    await insert("english-dance-cdny", { status: "merged", mergedIntoId: mid });
    expect(await repo.resolveSlug("english-country-dancing")).toEqual({
      kind: "moved",
      slug: "english-tuesdays",
    });
    expect(await repo.resolveSlug("english-dance-cdny")).toEqual({
      kind: "moved",
      slug: "english-tuesdays",
    });
  });

  it("answers gone for an unknown slug, a removed listing, and a merge whose survivor is gone", async () => {
    const removed = await insert("taken-off", { status: "removed" });
    await insert("merged-into-removed", { status: "merged", mergedIntoId: removed });
    expect(await repo.resolveSlug("no-such-listing")).toEqual({ kind: "gone" });
    expect(await repo.resolveSlug("taken-off")).toEqual({ kind: "gone" });
    expect(await repo.resolveSlug("merged-into-removed")).toEqual({ kind: "gone" });
  });

  it("follows a listing retired into the one that replaced it, and a merge into such a listing", async () => {
    const untimed = await insert("milonga-untimed");
    const timed = await insert("milonga-9pm", { status: "removed", mergedIntoId: untimed });
    await insert("milonga-elsewhere", { status: "merged", mergedIntoId: timed });
    expect(await repo.resolveSlug("milonga-9pm")).toEqual({
      kind: "moved",
      slug: "milonga-untimed",
    });
    expect(await repo.resolveSlug("milonga-elsewhere")).toEqual({
      kind: "moved",
      slug: "milonga-untimed",
    });
  });

  it("stops after three merges rather than following a loop", async () => {
    const a = await insert("loop-a", { status: "merged" });
    const b = await insert("loop-b", { status: "merged", mergedIntoId: a });
    await db.update(events).set({ mergedIntoId: b }).where(eq(events.id, a));
    expect(await repo.resolveSlug("loop-a")).toEqual({ kind: "gone" });
  });
});

describe("MockListingsRepository.resolveSlug and the proxy", () => {
  const now = new Date();
  const tonight = currentNightDate(now, "America/New_York");
  const seed = seedNyc(now);
  const duplicate = seed.events.find((e) => e.slug === mergedDuplicateSlug(tonight))!;
  const survivor = seed.events.find((e) => e.id === duplicate.mergedIntoId)!;
  const mock = new MockListingsRepository();

  it("seeds one merged duplicate of a listing tonight, never listed itself", () => {
    expect(duplicate.status).toBe("merged");
    expect(survivor.status).toBe("active");
  });

  it("sends the duplicate's address to the listing that stands", async () => {
    expect(await mock.resolveSlug(duplicate.slug)).toEqual({ kind: "moved", slug: survivor.slug });
    expect(await mock.resolveSlug(survivor.slug)).toEqual({ kind: "listed" });
    expect(await mock.resolveSlug("no-such-listing")).toEqual({ kind: "gone" });
  });

  const call = (path: string) => proxy(new NextRequest(new URL(path, "https://dancetonight.test")));

  it("redirects a merged listing's page and calendar file to the survivor's, temporarily", async () => {
    const page = await call(`/e/${duplicate.slug}`);
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get("location")!).pathname).toBe(`/e/${survivor.slug}`);
    const ics = await call(`/e/${duplicate.slug}/calendar.ics`);
    expect(ics.status).toBe(307);
    expect(new URL(ics.headers.get("location")!).pathname).toBe(`/e/${survivor.slug}/calendar.ics`);
  });

  it("lets a listed listing through", async () => {
    const res = await call(`/e/${survivor.slug}`);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("answers a gone listing's calendar file with a 404", async () => {
    const res = await call("/e/no-such-listing/calendar.ics");
    expect(res.status).toBe(404);
  });

  it("serves a gone listing's page from an address no route matches, marked as a listing", async () => {
    const res = await call("/e/no-such-listing");
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite!).pathname).toBe("/_listing-gone");
    expect(res.headers.get(`x-middleware-request-${MISSING_LISTING_HEADER}`)).toBe("listing");
  });

  it("answers a malformed address with a 404, not an error", async () => {
    expect((await call("/e/%E0%A4%A/calendar.ics")).status).toBe(404);
    const page = await call("/e/%E0%A4%A");
    expect(new URL(page.headers.get("x-middleware-rewrite")!).pathname).toBe("/_listing-gone");
  });

  it("runs only on event addresses and single-segment city paths (D-567)", async () => {
    expect(config.matcher).toEqual(["/e/:slug", "/e/:slug/calendar.ics", "/:city"]);
    expect((await call("/bot")).headers.get("x-middleware-next")).toBe("1");
  });
});
