import { describe, expect, it } from "vitest";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const NEWHAM = `Newham's Tea Dances
Newham's grand tea dances - an opportunity to salsa, waltz, rumba and socialise the afternoon away. Refreshments included in the admission price.
Please contact Stratford Library 02033730826
Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026
Monday 11 January 2027
*Time:
Dance Lessons start from 12.30noon – 1.30pm
*Tea Dance Time starts from: 1.30pm – 4.30pm
Date:
17 Mar 2026.
Location:
Old Town Hall Stratford 29 The Broadway, E15 4BQ
Cost:
£3 Newham Residents`;

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "Old Town Hall Stratford" },
      organizer: {},
      ...l,
    })),
  });
}

describe("one event's dates list with one shared time block (D-270)", () => {
  it("keeps times for multiple listings with same title when no own part writes a time", () => {
    const result = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-11-11",
          dancing_time: "13:30",
          end_time: "16:30",
        },
        {
          title: "Newham's Tea Dances",
          local_date: "2026-12-07",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://www.newham.gov.uk/events/event/73/newham-s-tea-dances",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    expect(result.listings).toHaveLength(2);
    // Both listings should keep their dancing_time and end_time
    expect(result.listings[0]?.listing.dancing_time).toBe("13:30");
    expect(result.listings[0]?.listing.end_time).toBe("16:30");
    expect(result.listings[1]?.listing.dancing_time).toBe("13:30");
    expect(result.listings[1]?.listing.end_time).toBe("16:30");
    // timesWithdrawn should not be set
    expect(result.listings[0]?.timesWithdrawn).toBeUndefined();
    expect(result.listings[1]?.timesWithdrawn).toBeUndefined();
  });

  it("drops times for single listing with same title (no shared time block logic)", () => {
    const result = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-11-11",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://www.newham.gov.uk/events/event/73/newham-s-tea-dances",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    expect(result.listings).toHaveLength(1);
    // With only one listing, the shared time block logic doesn't apply
    // The listing's own part has no time, so times should be dropped
    expect(result.listings[0]?.listing.dancing_time).toBeNull();
    expect(result.listings[0]?.listing.end_time).toBeNull();
    // timesWithdrawn should be set
    expect(result.listings[0]?.timesWithdrawn).toBeDefined();
  });

  it("leaves a listing whose own part writes its start as it is", () => {
    const page = `Event Title
Monday 9 November 2026, 2pm
Monday 16 November 2026, 2pm
Later that night: 11pm`;

    const result = extractionToHarvested(
      reply([
        { title: "Event Title", local_date: "2026-11-09", dancing_time: "14:00" },
        { title: "Event Title", local_date: "2026-11-16", dancing_time: "23:00" },
      ]),
      {
        pageUrl: "https://example.com/event",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: page,
        countryCode: "GB",
      },
    );

    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]?.listing.dancing_time).toBe("14:00");
  });

  it("does not apply shared time block for different titles", () => {
    const page = `Opening hours: 2pm-4pm
Event A
Monday 9 November 2026
Event B
Monday 16 November 2026`;

    const result = extractionToHarvested(
      reply([
        {
          title: "Event A",
          local_date: "2026-11-09",
          dancing_time: "14:00",
        },
        {
          title: "Event B",
          local_date: "2026-11-16",
          dancing_time: "14:00",
        },
      ]),
      {
        pageUrl: "https://example.com/events",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: page,
        countryCode: "GB",
      },
    );

    // Different titles, so shared time block logic shouldn't apply
    // The time is above both titles, in neither listing's own part: dropped
    expect(result.listings[0]?.listing.dancing_time).toBeNull();
    expect(result.listings[1]?.listing.dancing_time).toBeNull();
  });
});
