import { describe, expect, it } from "vitest";

import { rawListingSchema } from "@/src/domain/listing";
import { normalizeListing } from "@/src/pipeline/normalize";

const NYC = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

const NOW = new Date("2026-10-15T16:00:00Z");

function harvested(fields: Record<string, unknown>) {
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
    provenance: { sourceUrl: "https://example.org/cal", fetchedAt: NOW, method: "feed" as const },
  };
}

const ctx = { metro: NYC, source: { styles: [] as string[] }, now: NOW };

function ok(outcome: ReturnType<typeof normalizeListing>) {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
  return outcome.event;
}

describe("end times that equal the start, or make a night over 12 hours long, are not listed", () => {
  it("doors 20:00, end 20:00 -> endsAt null", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Live Salsa Wednesdays",
          local_date: "2026-10-15",
          doors_time: "20:00",
          end_time: "20:00",
        }),
        ctx,
      ),
    );
    expect(event.endsAt).toBeNull();
  });

  // A 07:40 start with a 20:40 end is now an am/pm slip read as 19:40 (D-812, am-pm-slip.test.ts).
  it("lesson 10:40, end 23:40 -> endsAt null (13 h)", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Salsa & Bachata Classes",
          local_date: "2026-10-15",
          lesson_time: "10:40",
          end_time: "23:40",
        }),
        ctx,
      ),
    );
    expect(event.endsAt).toBeNull();
  });

  it("doors 21:00, end 07:00 -> 07:00 next morning kept (10 h)", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Night to Morning",
          local_date: "2026-10-15",
          doors_time: "21:00",
          end_time: "07:00",
        }),
        ctx,
      ),
    );
    // 07:00 next morning in UTC: 2026-10-16T11:00:00.000Z
    expect(event.endsAt?.toISOString()).toBe("2026-10-16T11:00:00.000Z");
  });

  it("doors 22:00, end 04:00 -> 04:00 next day kept (06:00 rule; 6 h)", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Late Night",
          local_date: "2026-10-15",
          doors_time: "22:00",
          end_time: "04:00",
        }),
        ctx,
      ),
    );
    // 04:00 next morning in UTC: 2026-10-16T08:00:00.000Z
    expect(event.endsAt?.toISOString()).toBe("2026-10-16T08:00:00.000Z");
  });

  it("doors 10:00, end 22:00 -> kept (exactly 12 h)", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Day Event",
          local_date: "2026-10-15",
          doors_time: "10:00",
          end_time: "22:00",
        }),
        ctx,
      ),
    );
    // 22:00 same day in UTC: 2026-10-16T02:00:00.000Z
    expect(event.endsAt?.toISOString()).toBe("2026-10-16T02:00:00.000Z");
  });

  it("doors 20:00, end 19:00 -> +24 h gives 23 h -> null", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Backwards Time",
          local_date: "2026-10-15",
          doors_time: "20:00",
          end_time: "19:00",
        }),
        ctx,
      ),
    );
    expect(event.endsAt).toBeNull();
  });

  it("no stated times, end 23:00 -> unchanged", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "No Start",
          local_date: "2026-10-15",
          end_time: "23:00",
        }),
        ctx,
      ),
    );
    // 23:00 same day in UTC: 2026-10-16T03:00:00.000Z
    expect(event.endsAt?.toISOString()).toBe("2026-10-16T03:00:00.000Z");
  });

  it("dancing 21:00, end 21:00 -> endsAt null", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Dancing Same",
          local_date: "2026-10-15",
          dancing_time: "21:00",
          end_time: "21:00",
        }),
        ctx,
      ),
    );
    expect(event.endsAt).toBeNull();
  });

  it("lesson 18:00, dancing 20:00, end 20:00 -> endsAt null (equal to dancing)", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Multiple Starts",
          local_date: "2026-10-15",
          lesson_time: "18:00",
          dancing_time: "20:00",
          end_time: "20:00",
        }),
        ctx,
      ),
    );
    expect(event.endsAt).toBeNull();
  });

  it("doors 08:00, end 21:00 -> am/pm slip moves start to 20:00, span 1h, end kept", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Long Day",
          local_date: "2026-10-15",
          doors_time: "08:00",
          end_time: "21:00",
        }),
        ctx,
      ),
    );
    // 08:00 to 21:00 is 13 hours, which is an am/pm slip; start moves to 20:00, span becomes 1h
    expect(event.endsAt?.toISOString()).toBe("2026-10-16T01:00:00.000Z");
  });
});
