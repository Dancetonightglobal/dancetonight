// The mock seed's links out (D-073): what the end-to-end suite and a dancer in mock mode see.
// Every night the day picker shows has a card of each kind (tickets, event page, listed on), no
// seeded ticket or event page is a home page or a list of nights, one cancelled night keeps a
// ticket page, and one host is long enough for the 320px checks to see a line wrap.

import { describe, expect, it } from "vitest";

import { listingsFromSeed } from "@/src/data/mock-repository";
import { seedNyc } from "@/src/db/seed/nyc";
import { SERIES } from "@/src/db/seed/nyc-data";
import { isSeriesLink } from "@/src/domain/event-link-matcher";
import { looksLikeEventPage } from "@/src/domain/event-links";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate, pickerLength } from "@/src/domain/tonight";
import { eventLink } from "@/src/ui/links";

const NY = "America/New_York";

/** Seven evenings, one per weekday, so each picker window starts on a different night. */
const EVENINGS = Array.from(
  { length: 7 },
  (_, i) => new Date(Date.UTC(2026, 9, 5 + i, 22)), // 6pm EDT, Mon Oct 5 to Sun Oct 11
);

describe("the seed's links out (D-073)", () => {
  it.each(EVENINGS.map((now) => [now.toISOString(), now] as const))(
    "gives every picker night a tickets, an event page and a listed card (%s)",
    (_label, now) => {
      const listings = listingsFromSeed(seedNyc(now));
      const tonight = currentNightDate(now, NY);
      for (let i = 0; i < pickerLength(tonight); i++) {
        const night = addCalendarDays(tonight, i);
        const kinds = new Set(
          listings.filter((l) => l.nightDate === night).map((l) => eventLink(l)?.kind),
        );
        expect([...kinds].sort(), night).toEqual(["event", "listed", "tickets"]);
      }
    },
  );

  it("seeds no ticket page or event page that is a home page, a list or an organiser page", () => {
    const seed = seedNyc(EVENINGS[0] ?? new Date());
    const tickets = new Set(seed.events.map((e) => e.ticketUrl).filter((u) => u !== null));
    const pages = new Set(
      seed.eventSources.map((s) => s.eventUrl ?? null).filter((u) => u !== null),
    );
    expect(tickets.size).toBeGreaterThan(5);
    expect(pages.size).toBeGreaterThan(5);
    for (const url of [...tickets, ...pages]) expect(looksLikeEventPage(url), url).toBe(true);
  });

  it("gives a weekly series only links every night may share, as expandRecurrence does (review #21)", () => {
    // In production a rule's nights keep no link that carries one night's date and no ticket
    // seller's or event platform's page for one night; the seed shows what the store produces.
    for (const series of SERIES) {
      const links = [series.ticketUrl, ...Object.values(series.eventUrls ?? {})].filter(
        (u): u is string => typeof u === "string",
      );
      for (const url of links) expect(isSeriesLink(url), `${series.slug}: ${url}`).toBe(true);
    }
  });

  it("keeps the page the listing was read from as its canonical URL, as the store does", () => {
    const seed = seedNyc(EVENINGS[0] ?? new Date());
    const primaryUrl = new Map(
      seed.eventSources.filter((s) => s.role === "primary").map((s) => [s.eventId, s.sourceUrl]),
    );
    for (const event of seed.events) expect(event.canonicalUrl).toBe(primaryUrl.get(event.id));
  });

  it("has a cancelled night that keeps its ticket page, shown as its event page", () => {
    const listings = listingsFromSeed(seedNyc(EVENINGS[0] ?? new Date()));
    const cancelled = listings.filter(
      (l) => l.confirmation === "cancelled" && l.ticketUrl !== null,
    );
    expect(cancelled.length).toBeGreaterThan(0);
    for (const listing of cancelled) expect(eventLink(listing)?.kind).toBe("event");
  });

  it("has a host of 30 characters or more within the picker, for the 320px wrap", () => {
    const now = EVENINGS[0] ?? new Date();
    const tonight = currentNightDate(now, NY);
    const last = addCalendarDays(tonight, pickerLength(tonight) - 1);
    const sites = listingsFromSeed(seedNyc(now))
      .filter((l) => l.nightDate >= tonight && l.nightDate <= last)
      .map((l) => eventLink(l)?.site ?? "");
    expect(Math.max(...sites.map((s) => s.length))).toBeGreaterThanOrEqual(30);
  });
});
