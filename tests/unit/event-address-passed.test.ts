// Maintenance M1 (the owner 2026-11-16 "1a"): a past night the retention job deleted keeps its address. Its slug is in
// archived_events, so the address answers "passed" (title, night, venue, city) and the not-found page says the
// night has passed; the calendar file answers 410 Gone. A slug still in events answers as before (D-092).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getProxyRepository } from "@/src/data";
import { DbListingsRepository } from "@/src/data/db-repository";
import type { Db } from "@/src/db/client";
import { archivedEvents, events, metros } from "@/src/db/schema";
import { PassedPage } from "@/src/ui/detail/passed-page";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";
import { MISSING_LISTING_HEADER, MISSING_SLUG_HEADER, proxy } from "@/proxy";

requireDbInCi();

const PASSED = {
  kind: "passed" as const,
  title: "Salsa Under the Stars",
  nightDate: "2026-09-12",
  venueName: "Lincoln Center Plaza",
  metroSlug: "nyc",
};

let db: Db;
let repo: DbListingsRepository;

describeDb("DbListingsRepository.resolveSlug for an archived night", () => {
  beforeAll(async () => {
    db = await testDb("event_address_passed");
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

  const archive = (slug: string, venueName: string | null = PASSED.venueName) =>
    db.insert(archivedEvents).values({
      slug,
      eventId: "00000000-0000-4000-8000-000000000001",
      title: PASSED.title,
      nightDate: PASSED.nightDate,
      metroSlug: PASSED.metroSlug,
      venueName,
    });

  it("answers passed with the night's facts for an archived slug", async () => {
    await archive("salsa-under-the-stars-2026-09-12-ab12");
    expect(await repo.resolveSlug("salsa-under-the-stars-2026-09-12-ab12")).toEqual(PASSED);
  });

  it("keeps a missing venue as null", async () => {
    await archive("no-venue-night", null);
    expect(await repo.resolveSlug("no-venue-night")).toEqual({ ...PASSED, venueName: null });
  });

  it("answers listed when the slug is still an event, archived or not", async () => {
    await db.insert(events).values({
      slug: "still-here",
      title: "still-here",
      titleNormalized: "still-here",
      listingType: "social",
      styles: ["salsa"],
      nightDate: "2026-10-06",
      tz: "America/New_York",
      confirmation: "recurring_unconfirmed",
      metroId: (await db.select({ id: metros.id }).from(metros))[0]!.id,
    });
    await archive("still-here");
    expect(await repo.resolveSlug("still-here")).toEqual({ kind: "listed" });
  });

  it("answers gone for a slug in neither table", async () => {
    expect(await repo.resolveSlug("never-ours")).toEqual({ kind: "gone" });
  });
});

describe("the proxy for an archived night", () => {
  const call = (path: string) => proxy(new NextRequest(new URL(path, "https://dancetonight.test")));

  beforeEach(() => {
    vi.spyOn(getProxyRepository(), "resolveSlug").mockResolvedValue(PASSED);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves the page from the not-found address, marked passed, with the slug", async () => {
    const res = await call("/e/salsa-under-the-stars-2026-09-12-ab12");
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).not.toBeNull();
    expect(new URL(rewrite!).pathname).toBe("/_listing-gone");
    expect(res.headers.get(`x-middleware-request-${MISSING_LISTING_HEADER}`)).toBe("passed");
    expect(res.headers.get(`x-middleware-request-${MISSING_SLUG_HEADER}`)).toBe(
      "salsa-under-the-stars-2026-09-12-ab12",
    );
  });

  it("answers the calendar file with 410 Gone", async () => {
    const res = await call("/e/salsa-under-the-stars-2026-09-12-ab12/calendar.ics");
    expect(res.status).toBe(410);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("This night has passed.");
  });
});

describe("PassedPage", () => {
  it("says the night has passed and names it, with a way to tonight in its city", () => {
    const html = renderToStaticMarkup(createElement(PassedPage, { night: PASSED }));
    expect(html).toContain("This night has passed.");
    expect(html).toContain("Salsa Under the Stars");
    expect(html).toContain("Sat, Sep 12, 2026");
    expect(html).toContain("Lincoln Center Plaza");
    expect(html).toContain('href="/nyc"');
    expect(html).toContain("See what&#x27;s on tonight");
  });

  it("leaves out the venue when there is none and escapes the title", () => {
    const html = renderToStaticMarkup(
      createElement(PassedPage, {
        night: { ...PASSED, title: "<b>Bold</b> Night", venueName: null },
      }),
    );
    expect(html).not.toContain("<b>Bold</b>");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; Night");
    expect(html).not.toContain("Lincoln Center Plaza");
  });
});
