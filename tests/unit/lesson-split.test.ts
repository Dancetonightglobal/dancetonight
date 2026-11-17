import { describe, expect, it } from "vitest";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { splitLessonBeforeDancing } from "@/src/pipeline/lesson-split";

// D-754 (daily check 11-05, the owner 11-06): nycwcs "WCS Level 2 with Sophie" lists doors 7pm, dancing 9pm, ends 8pm,
// shown "9pm, until 8pm". The end is the lesson's: the owner wants two events, the lesson 7 to 8pm and the dancing from 9pm.

function listing(
  fields: Record<string, unknown>,
  externalId: string | null = "wcs-1",
): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      title: "WCS Level 2 with Sophie",
      listing_type: "social",
      styles: ["west_coast_swing"],
      venue: { name: "Dance Manhattan" },
      organizer: {},
      local_date: "2026-11-10",
      ...fields,
    }),
    externalId,
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://nycwcs.com/events", fetchedAt: new Date(), method: "feed" },
  };
}

describe("splitLessonBeforeDancing (D-754)", () => {
  it("splits doors 7pm, dancing 9pm, end 8pm into a 7-8pm class and a 9pm night", () => {
    const out = splitLessonBeforeDancing(
      listing({ doors_time: "19:00", dancing_time: "21:00", end_time: "20:00" }),
    );
    expect(out).toHaveLength(2);
    const [lesson, dancing] = out;
    expect(lesson!.listing.listing_type).toBe("class");
    expect(lesson!.listing.lesson_time).toBe("19:00");
    expect(lesson!.listing.doors_time).toBeNull();
    expect(lesson!.listing.dancing_time).toBeNull();
    expect(lesson!.listing.end_time).toBe("20:00");
    expect(lesson!.externalId).toBe("wcs-1:lesson");
    expect(dancing!.listing.listing_type).toBe("social");
    expect(dancing!.listing.dancing_time).toBe("21:00");
    expect(dancing!.listing.doors_time).toBeNull();
    expect(dancing!.listing.lesson_time).toBeNull();
    expect(dancing!.listing.end_time).toBeNull();
    expect(dancing!.externalId).toBe("wcs-1:dancing");
    for (const one of out) {
      expect(one.listing.title).toBe("WCS Level 2 with Sophie");
      expect(one.listing.local_date).toBe("2026-11-10");
      expect(one.provenance.sourceUrl).toBe("https://nycwcs.com/events");
    }
  });

  it("uses the lesson time over doors when both are listed", () => {
    const out = splitLessonBeforeDancing(
      listing({
        doors_time: "18:30",
        lesson_time: "19:00",
        dancing_time: "21:00",
        end_time: "20:00",
      }),
    );
    expect(out[0]!.listing.lesson_time).toBe("19:00");
  });

  it("splits an end equal to the dancing start (lesson 7 to 9, dancing 9)", () => {
    const out = splitLessonBeforeDancing(
      listing({ lesson_time: "19:00", dancing_time: "21:00", end_time: "21:00" }),
    );
    expect(out).toHaveLength(2);
  });

  it("keeps a source's null id null on both halves", () => {
    const out = splitLessonBeforeDancing(
      listing({ doors_time: "19:00", dancing_time: "21:00", end_time: "20:00" }, null),
    );
    expect(out.map((o) => o.externalId)).toEqual([null, null]);
  });

  it("makes the dancing half a social when the listing was typed class", () => {
    const out = splitLessonBeforeDancing(
      listing({
        listing_type: "class",
        lesson_time: "19:00",
        dancing_time: "21:00",
        end_time: "20:00",
      }),
    );
    expect(out[1]!.listing.listing_type).toBe("social");
  });

  it("leaves an end after the dancing start alone (doors 7, dancing 9, end 11:30pm)", () => {
    const one = listing({ doors_time: "19:00", dancing_time: "21:00", end_time: "23:30" });
    expect(splitLessonBeforeDancing(one)).toEqual([one]);
  });

  it("leaves an after-midnight end alone (doors 10pm, dancing 11pm, end 2am)", () => {
    const one = listing({ doors_time: "22:00", dancing_time: "23:00", end_time: "02:00" });
    expect(splitLessonBeforeDancing(one)).toEqual([one]);
  });

  it("leaves a night with no dancing time, no end, or no earlier time alone", () => {
    for (const fields of [
      { doors_time: "19:00", end_time: "20:00" },
      { doors_time: "19:00", dancing_time: "21:00" },
      { dancing_time: "21:00", end_time: "20:00" },
    ]) {
      const one = listing(fields);
      expect(splitLessonBeforeDancing(one)).toEqual([one]);
    }
  });

  it("leaves an end at or before the earliest time alone (that is the 06:00 / next-morning rule's)", () => {
    const one = listing({ doors_time: "19:00", dancing_time: "21:00", end_time: "19:00" });
    expect(splitLessonBeforeDancing(one)).toEqual([one]);
  });

  it("does not change the listing it was given", () => {
    const one = listing({ doors_time: "19:00", dancing_time: "21:00", end_time: "20:00" });
    const before = JSON.stringify(one);
    splitLessonBeforeDancing(one);
    expect(JSON.stringify(one)).toBe(before);
  });
});
