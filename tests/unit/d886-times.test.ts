import { describe, expect, it } from "vitest";

import type { HarvestedListing, Metro } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { normalizeListing, staleHalloween, type NormalizeOutcome } from "@/src/pipeline/normalize";

const TOKYO: Metro = {
  id: "m",
  slug: "tokyo",
  name: "Tokyo",
  countryCode: "JP",
  center: { lat: 35.68, lng: 139.76 },
  radiusKm: 50,
  tz: "Asia/Tokyo",
  languages: ["ja", "en"],
};
const NOW = new Date("2026-11-16T03:00:00Z");
const ctx = { metro: TOKYO, source: { styles: [] as string[] }, now: NOW };

function harvested(fields: Record<string, unknown>): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      ...fields,
    }),
    externalId: null,
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://example.org/cal", fetchedAt: NOW, method: "feed" },
  };
}

function ok(outcome: NormalizeOutcome) {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
  return outcome.event;
}

describe("D-886 an end after the doors but before the start", () => {
  it("drops the end (Tokyo Salud: doors 11am, start 2pm, until 12:30pm)", () => {
    const e = ok(
      normalizeListing(
        harvested({
          title: "Salsa Lesson at Salsa Club Nippori Salud",
          local_date: "2026-11-22",
          doors_time: "11:00",
          lesson_time: "14:00",
          end_time: "12:30",
        }),
        ctx,
      ),
    );
    expect(e.startsAt?.toISOString()).toBe("2026-11-22T05:00:00.000Z");
    expect(e.endsAt).toBeNull();
  });

  it("keeps an end after the start, and a next-morning end", () => {
    const later = ok(
      normalizeListing(
        harvested({
          title: "Salsa Social",
          local_date: "2026-11-22",
          doors_time: "19:00",
          dancing_time: "20:00",
          end_time: "23:30",
        }),
        ctx,
      ),
    );
    expect(later.endsAt?.toISOString()).toBe("2026-11-22T14:30:00.000Z");
    const morning = ok(
      normalizeListing(
        harvested({
          title: "Salsa Social",
          local_date: "2026-11-22",
          dancing_time: "21:00",
          end_time: "02:00",
        }),
        ctx,
      ),
    );
    expect(morning.endsAt?.toISOString()).toBe("2026-11-22T17:00:00.000Z");
  });
});

describe("D-886 stale Halloween titles", () => {
  it("screens a Halloween title in late November", () => {
    expect(staleHalloween("STUDIO 666: Halloween Party", "2026-11-19")).toBe(true);
    expect(staleHalloween("Halloween Party", "2027-03-05")).toBe(true);
    const out = normalizeListing(
      harvested({ title: "Halloween Party", local_date: "2026-11-19", dancing_time: "21:00" }),
      ctx,
    );
    expect(out).toMatchObject({ ok: false, kind: "not_an_event" });
  });

  it("keeps Halloween in season and other titles", () => {
    expect(staleHalloween("Halloween Salsa Social", "2026-10-31")).toBe(false);
    expect(staleHalloween("Halloween Weekend Swing", "2026-10-01")).toBe(false);
    expect(staleHalloween("Post-Halloween Bachata", "2026-11-07")).toBe(false);
    expect(staleHalloween("Halloweenie Social", "2026-11-20")).toBe(false);
    expect(staleHalloween("Salsa Social", "2026-11-19")).toBe(false);
  });
});
