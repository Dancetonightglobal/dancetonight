import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import type { Db } from "@/src/db/client";
import { linkChecks } from "@/src/db/schema/ops";
import { listingSchema } from "@/src/domain/listing";
import { attachLinkFlags } from "@/src/data/link-flags";
import { linkNotWorkingText } from "@/src/ui/link-status";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

describe("linkNotWorkingText", () => {
  it("returns null when linkBrokenAt is absent", () => {
    const listing = listingSchema.parse({
      id: "test",
      slug: "test",
      title: "Test",
      listingType: "social",
      styles: ["salsa"],
      families: ["salsa"],
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: "2026-11-06",
      tz: "America/New_York",
      venue: null,
      organizer: null,
      prices: [],
      isFree: null,
      ticketUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      recurrenceText: null,
      confirmation: "confirmed_today",
      confidence: 1,
      summary: null,
      sources: [],
      status: "active",
      canonicalUrl: null,
      distanceKm: null,
      liveStatus: null,
    });
    expect(linkNotWorkingText(listing, new Date())).toBeNull();
  });

  it('returns "Link not working (checked today)" when checked earlier the same local day', () => {
    const listing = listingSchema.parse({
      id: "test",
      slug: "test",
      title: "Test",
      listingType: "social",
      styles: ["salsa"],
      families: ["salsa"],
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: "2026-11-06",
      tz: "America/New_York",
      venue: null,
      organizer: null,
      prices: [],
      isFree: null,
      ticketUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      recurrenceText: null,
      confirmation: "confirmed_today",
      confidence: 1,
      summary: null,
      sources: [],
      status: "active",
      canonicalUrl: null,
      distanceKm: null,
      liveStatus: null,
      linkBrokenAt: "2026-11-06T10:00:00Z", // 10:00 UTC = 05:00 EST (same day)
    });
    const now = new Date("2026-11-06T15:00:00Z"); // 10:00 EST
    expect(linkNotWorkingText(listing, now)).toBe("Link not working (checked today)");
  });

  it('returns "Link not working (checked Thu, Nov 5)" when check is previous local day', () => {
    const listing = listingSchema.parse({
      id: "test",
      slug: "test",
      title: "Test",
      listingType: "social",
      styles: ["salsa"],
      families: ["salsa"],
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: "2026-11-06",
      tz: "America/New_York",
      venue: null,
      organizer: null,
      prices: [],
      isFree: null,
      ticketUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      recurrenceText: null,
      confirmation: "confirmed_today",
      confidence: 1,
      summary: null,
      sources: [],
      status: "active",
      canonicalUrl: null,
      distanceKm: null,
      liveStatus: null,
      linkBrokenAt: "2026-11-06T03:00:00Z", // 03:00 UTC = 22:00 EST previous day (Nov 5)
    });
    const now = new Date("2026-11-06T15:00:00Z"); // 10:00 EST
    expect(linkNotWorkingText(listing, now)).toBe("Link not working (checked Thu, Nov 5)");
  });
});

describeDb("attachLinkFlags", () => {
  let db: Db;

  beforeAll(async () => {
    db = await testDb("link_flags");
    await resetDb();
  });

  afterAll(closeTestDb);

  beforeEach(async () => {
    // Clear link_checks before each test to avoid duplicate key errors
    await db.execute(sql`truncate table ${linkChecks} restart identity cascade`);
  });

  it("sets linkBrokenAt when a broken row exists for the card link", async () => {
    // Build a minimal listing with a source URL that will be the "listed" link
    const sourceUrl = "https://example.com/list";
    const listing = listingSchema.parse({
      id: "test1",
      slug: "test1",
      title: "Test Event",
      listingType: "social",
      styles: ["salsa"],
      families: ["salsa"],
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: "2026-11-06",
      tz: "America/New_York",
      venue: null,
      organizer: null,
      prices: [],
      isFree: null,
      ticketUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      recurrenceText: null,
      confirmation: "confirmed_today",
      confidence: 1,
      summary: null,
      sources: [
        {
          url: sourceUrl,
          label: "example.com",
          checkedAt: new Date(),
          byOrganiser: false,
          tier: "listing",
          eventUrl: null,
        },
      ],
      status: "active",
      canonicalUrl: null,
      distanceKm: null,
      liveStatus: null,
    });

    // Insert a broken link check for the URL (without fragment)
    const checkedAt = new Date("2026-11-06T10:00:00Z");
    await db.insert(linkChecks).values({
      url: sourceUrl,
      checkedAt,
      broken: true,
      failures: 1,
      reason: "http 404",
    });

    const result = await attachLinkFlags(db, [listing]);
    expect(result).toHaveLength(1);
    expect(result[0]?.linkBrokenAt).toBe(checkedAt.toISOString());
  });

  it("ignores fragment when matching link key", async () => {
    const baseUrl = "https://example.com/list";
    const fragmentUrl = `${baseUrl}#:~:text=Test%20Event`;
    const listing = listingSchema.parse({
      id: "test2",
      slug: "test2",
      title: "Test Event",
      listingType: "social",
      styles: ["salsa"],
      families: ["salsa"],
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: "2026-11-06",
      tz: "America/New_York",
      venue: null,
      organizer: null,
      prices: [],
      isFree: null,
      ticketUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      recurrenceText: null,
      confirmation: "confirmed_today",
      confidence: 1,
      summary: null,
      sources: [
        {
          url: fragmentUrl,
          label: "example.com",
          checkedAt: new Date(),
          byOrganiser: false,
          tier: "listing",
          eventUrl: null,
        },
      ],
      status: "active",
      canonicalUrl: null,
      distanceKm: null,
      liveStatus: null,
    });

    const checkedAt = new Date("2026-11-06T10:00:00Z");
    await db.insert(linkChecks).values({
      url: baseUrl, // stored without fragment
      checkedAt,
      broken: true,
      failures: 1,
      reason: "http 404",
    });

    const result = await attachLinkFlags(db, [listing]);
    expect(result[0]?.linkBrokenAt).toBe(checkedAt.toISOString());
  });

  it("does not set linkBrokenAt when broken=false", async () => {
    const sourceUrl = "https://example.com/ok";
    const listing = listingSchema.parse({
      id: "test3",
      slug: "test3",
      title: "Test Event",
      listingType: "social",
      styles: ["salsa"],
      families: ["salsa"],
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: "2026-11-06",
      tz: "America/New_York",
      venue: null,
      organizer: null,
      prices: [],
      isFree: null,
      ticketUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      recurrenceText: null,
      confirmation: "confirmed_today",
      confidence: 1,
      summary: null,
      sources: [
        {
          url: sourceUrl,
          label: "example.com",
          checkedAt: new Date(),
          byOrganiser: false,
          tier: "listing",
          eventUrl: null,
        },
      ],
      status: "active",
      canonicalUrl: null,
      distanceKm: null,
      liveStatus: null,
    });

    await db.insert(linkChecks).values({
      url: sourceUrl,
      checkedAt: new Date(),
      broken: false,
      failures: 0,
      reason: null,
    });

    const result = await attachLinkFlags(db, [listing]);
    expect(result[0]?.linkBrokenAt).toBeUndefined();
  });

  it("returns same object when no matching broken row", async () => {
    const listing = listingSchema.parse({
      id: "test4",
      slug: "test4",
      title: "Test Event",
      listingType: "social",
      styles: ["salsa"],
      families: ["salsa"],
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      startsAt: null,
      nightDate: "2026-11-06",
      tz: "America/New_York",
      venue: null,
      organizer: null,
      prices: [],
      isFree: null,
      ticketUrl: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      recurrenceText: null,
      confirmation: "confirmed_today",
      confidence: 1,
      summary: null,
      sources: [
        {
          url: "https://example.com/no-check",
          label: "example.com",
          checkedAt: new Date(),
          byOrganiser: false,
          tier: "listing",
          eventUrl: null,
        },
      ],
      status: "active",
      canonicalUrl: null,
      distanceKm: null,
      liveStatus: null,
    });

    const result = await attachLinkFlags(db, [listing]);
    expect(result[0]).toBe(listing); // same object
    expect(result[0]?.linkBrokenAt).toBeUndefined();
  });

  it("handles empty input", async () => {
    const result = await attachLinkFlags(db, []);
    expect(result).toEqual([]);
  });
});
