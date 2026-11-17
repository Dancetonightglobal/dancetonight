import { describe, expect, it } from "vitest";
import { withZuluAsLocal } from "@/src/domain/zulu-local";
import type { HarvestedListing } from "@/src/adapters/types";
import { BEIRUT_SOURCES } from "@/config/sources/beirut";

// Salsa Vida's Beirut guide writes 9:30pm Beirut as "2026-11-08T21:30:00-08:00" (read 42338571510, 2026-11-07).
// Read as an instant that is 07:30 on 11-09 in Beirut; the wall clock the page means is 21:30 on 11-08.
function listing(
  start: string,
  end: string | null,
  overrides: Record<string, unknown> = {},
): HarvestedListing {
  return {
    listing: {
      title: "SBK Night at Suzana",
      listing_type: "social",
      styles: [],
      venue: { name: "Suzana" },
      organizer: {},
      doors_time: "07:30",
      lesson_time: null,
      dancing_time: null,
      end_time: "12:00",
      local_date: "2026-11-09",
      evidence: { start: `startDate ${start}`, ...(end ? { end_time: `endDate ${end}` } : {}) },
      ...overrides,
    },
    externalId: null,
    provenance: {
      method: "feed",
      sourceUrl: "https://www.salsavida.com/guides/lebanon/beirut/",
      fetchedAt: new Date(),
    },
    tz: "Asia/Beirut",
  } as unknown as HarvestedListing;
}

describe("withZuluAsLocal with a wrong offset", () => {
  it("re-reads a -08:00 start and end as Beirut wall clock", () => {
    const r = withZuluAsLocal(
      listing("2026-11-08T21:30:00-08:00", "2026-11-09T02:00:00-08:00"),
      "-08:00",
      "Asia/Beirut",
    );
    expect(r.applied).toBe(true);
    expect(r.listing.listing.local_date).toBe("2026-11-08");
    expect(r.listing.listing.doors_time).toBe("21:30");
    expect(r.listing.listing.end_time).toBe("02:00");
  });

  it("leaves a start with another offset alone", () => {
    const l = listing("2026-11-08T21:30:00+02:00", null, {
      doors_time: "21:30",
      local_date: "2026-11-08",
    });
    const r = withZuluAsLocal(l, "-08:00", "Asia/Beirut");
    expect(r.applied).toBe(false);
    expect(r.listing.listing.doors_time).toBe("21:30");
  });

  it("does not treat Z as the configured offset", () => {
    const r = withZuluAsLocal(listing("2026-11-08T21:30:00Z", null), "-08:00", "Asia/Beirut");
    expect(r.applied).toBe(false);
  });

  it("ignores a malformed offset string", () => {
    const r = withZuluAsLocal(listing("2026-11-08T21:30:00-08:00", null), "PST", "Asia/Beirut");
    expect(r.applied).toBe(false);
  });

  it("handles a + offset", () => {
    const l = listing("2026-11-08T21:30:00+05:30", null, {
      doors_time: "18:00",
      local_date: "2026-11-08",
    });
    const r = withZuluAsLocal(l, "+05:30", "Asia/Beirut");
    expect(r.applied).toBe(true);
    expect(r.listing.listing.doors_time).toBe("21:30");
  });

  it("Beirut's Salsa Vida source is not screened as a mixed calendar", () => {
    const sv = BEIRUT_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/lebanon/beirut/",
    );
    expect(sv?.mixedCalendar).toBe(false);
  });
});
