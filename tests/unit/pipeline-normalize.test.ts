import { describe, expect, it } from "vitest";

import { UNTIMED_RULE_ANCHOR, type HarvestedListing, type Metro } from "@/src/adapters/types";
import { familiesOf, rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";
import {
  dropUntimedWithTimedSibling,
  expandRecurrence,
  nightTimeToInstant,
  normalizeListing,
  sentenceCase,
  typeFromTitle,
  withoutPlaceholderTimes,
  withoutStartTimes,
  type NormalizeContext,
  type NormalizeOutcome,
} from "@/src/pipeline/normalize";

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

const NOW = new Date("2026-09-23T16:00:00Z");

function harvested(
  fields: Record<string, unknown>,
  extra: Partial<HarvestedListing> = {},
): HarvestedListing {
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
    ...extra,
  };
}

function ok(outcome: NormalizeOutcome) {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
  return outcome.event;
}

const ctx = { metro: NYC, source: { styles: [] as string[] }, now: NOW };

describe("night times", () => {
  it("puts a time before 06:00 on the next calendar day of the same night", () => {
    expect(nightTimeToInstant("2026-09-25", "22:00", "America/New_York").toISOString()).toBe(
      "2026-09-26T02:00:00.000Z",
    );
    expect(nightTimeToInstant("2026-09-25", "01:30", "America/New_York").toISOString()).toBe(
      "2026-09-26T05:30:00.000Z",
    );
  });

  it("follows the zone across a DST change", () => {
    // New York falls back on 2026-11-01 at 02:00; 23:00 on the night of Oct 31 is still EDT.
    expect(nightTimeToInstant("2026-10-31", "23:00", "America/New_York").toISOString()).toBe(
      "2026-11-01T03:00:00.000Z",
    );
    // 03:00 the same night is after the change, so EST.
    expect(nightTimeToInstant("2026-10-31", "03:00", "America/New_York").toISOString()).toBe(
      "2026-11-01T08:00:00.000Z",
    );
  });
});

describe("normalizeListing", () => {
  it("builds instants, the night date and the key from a dated listing", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Salsa Social",
          local_date: "2026-09-25",
          lesson_time: "20:00",
          dancing_time: "21:00",
          end_time: "02:00",
        }),
        ctx,
      ),
    );
    expect(event.startsAt?.toISOString()).toBe("2026-09-26T01:00:00.000Z");
    expect(event.lessonAt?.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(event.endsAt?.toISOString()).toBe("2026-09-26T06:00:00.000Z");
    expect(event.nightDate).toBe("2026-09-25");
    expect(event.styles).toEqual(["salsa"]);
    expect(event.stylesFrom).toBe("title");
    expect(event.confirmation).toBe("confirmed_today");
    expect(event.key).toBe("2026-09-25|2026-09-26T01:00:00.000Z|salsa social");
  });

  it("keys on the source's own id when there is one", () => {
    const event = ok(
      normalizeListing(
        harvested(
          { title: "X", local_date: "2026-09-25", dancing_time: "21:00" },
          { externalId: "tm:123" },
        ),
        ctx,
      ),
    );
    expect(event.key).toBe("tm:123");
  });

  it("moves an end at or before the first time to the next morning", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "All nighter",
          local_date: "2026-09-25",
          doors_time: "21:00",
          end_time: "07:00",
        }),
        ctx,
      ),
    );
    expect(event.endsAt?.toISOString()).toBe("2026-09-26T11:00:00.000Z");
  });

  it("rejects, with the reason, a listing with no date", () => {
    expect(normalizeListing(harvested({ title: "No date", dancing_time: "21:00" }), ctx)).toEqual({
      ok: false,
      kind: "rejected",
      reason: "no date listed",
      title: "No date",
    });
  });

  it("fills a missing price currency from the metro's country, and says free only when stated", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Milonga",
          local_date: "2026-09-25",
          dancing_time: "21:00",
          prices: [{ label: "Entry", amount: 20 }],
        }),
        ctx,
      ),
    );
    expect(event.prices).toEqual([{ label: "Entry", amount: 20, currency: "USD", includes: null }]);
    expect(event.isFree).toBe(false);
  });

  it("takes the source's style only when the listing names none and the source has exactly one", () => {
    const one = ok(
      normalizeListing(
        harvested({ title: "Thursday night", local_date: "2026-09-25", dancing_time: "21:00" }),
        {
          ...ctx,
          source: { styles: ["west_coast_swing"] },
        },
      ),
    );
    expect(one.styles).toEqual(["west_coast_swing"]);
    expect(one.stylesFrom).toBe("source_hint");
    const two = ok(
      normalizeListing(
        harvested({ title: "Thursday night", local_date: "2026-09-25", dancing_time: "21:00" }),
        {
          ...ctx,
          source: { styles: ["salsa", "bachata"] },
        },
      ),
    );
    expect(two.styles).toEqual([]);
    expect(two.stylesFrom).toBe("none");
  });

  it("marks a cancelled listing cancelled", () => {
    const event = ok(
      normalizeListing(
        harvested({
          title: "Salsa",
          local_date: "2026-09-25",
          dancing_time: "21:00",
          cancelled: true,
        }),
        ctx,
      ),
    );
    expect(event.cancelled).toBe(true);
    expect(event.confirmation).toBe("cancelled");
  });

  it("uses the listing's own zone when it states a valid one", () => {
    const event = ok(
      normalizeListing(
        harvested(
          { title: "X", local_date: "2026-09-25", dancing_time: "21:00" },
          { tz: "America/Chicago" },
        ),
        ctx,
      ),
    );
    expect(event.tz).toBe("America/Chicago");
    expect(event.startsAt?.toISOString()).toBe("2026-09-26T02:00:00.000Z");
  });
});

describe("expandRecurrence", () => {
  it("materialises a weekly rule into one listing per night, minus EXDATEs, marked from a rule", () => {
    const rule = harvested(
      { title: "Thursday Lindy", styles: ["lindy_hop"] },
      {
        externalId: "uid-1",
        recurrence: {
          rrule: "FREQ=WEEKLY;BYDAY=TH",
          dtstartLocal: "2026-01-01T20:30",
          exdates: ["2026-10-01"],
        },
      },
    );
    const { listings, error } = expandRecurrence(rule, "2026-09-23", "America/New_York", 14);
    expect(error).toBeNull();
    expect(listings.map((l) => l.listing.local_date)).toEqual(["2026-09-24"]);
    expect(listings[0]?.externalId).toBe("uid-1@2026-09-24");
    expect(listings[0]?.listing.dancing_time).toBe("20:30");
    const event = ok(normalizeListing(listings[0]!, ctx));
    expect(event.confirmation).toBe("recurring_unconfirmed");
    expect(event.fromRule).toBe(true);
  });

  it("reports a rule it cannot read instead of guessing", () => {
    const bad = harvested(
      { title: "Odd" },
      { recurrence: { rrule: "FREQ=SOMETIMES", dtstartLocal: "2026-01-01T20:30", exdates: [] } },
    );
    const { listings, error } = expandRecurrence(bad, "2026-09-23", "America/New_York");
    expect(listings).toEqual([]);
    expect(error).toMatch(/^rule not readable/);
  });

  it("passes a listing without a rule through unchanged", () => {
    const plain = harvested({ title: "One off", local_date: "2026-09-25", dancing_time: "21:00" });
    expect(expandRecurrence(plain, "2026-09-23", "America/New_York").listings).toEqual([plain]);
  });
});

describe("a listing with a night and no time (D-060)", () => {
  it("is kept with every time null, on the listed night, keyed night|untimed|title", () => {
    const outcome = normalizeListing(
      harvested({ title: "Brooklyn Social", local_date: "2026-09-25" }),
      ctx,
    );
    expect(outcome).toMatchObject({ ok: true, untimed: true });
    const event = ok(outcome);
    expect(event).toMatchObject({
      startsAt: null,
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      nightDate: "2026-09-25",
      key: "2026-09-25|untimed|brooklyn social",
      confirmation: "confirmed_today",
    });
  });

  it("says a timed listing is not untimed", () => {
    expect(
      normalizeListing(
        harvested({ title: "Salsa", local_date: "2026-09-25", dancing_time: "21:00" }),
        ctx,
      ),
    ).toMatchObject({ ok: true, untimed: false });
  });

  it("keeps a listed end where the 06:00 rule puts it, with no start to push it a day later", () => {
    // A listed end past midnight is the next calendar day of the same night.
    const late = ok(
      normalizeListing(
        harvested({ title: "Brooklyn Social", local_date: "2026-09-25", end_time: "02:00" }),
        ctx,
      ),
    );
    expect(late.startsAt).toBeNull();
    expect(late.endsAt?.toISOString()).toBe("2026-09-26T06:00:00.000Z");
    // Before midnight: the same evening. Math.min() of no start times is Infinity, which would
    // push every end a day later; with no start there is nothing to compare, so nothing moves.
    const evening = ok(
      normalizeListing(
        harvested({ title: "Brooklyn Social", local_date: "2026-09-25", end_time: "23:00" }),
        ctx,
      ),
    );
    expect(evening.endsAt?.toISOString()).toBe("2026-09-26T03:00:00.000Z");
    expect(evening.nightDate).toBe("2026-09-25");
  });

  it("keeps the listed night across a DST change", () => {
    // New York falls back at 02:00 on 2026-11-01: an end at 03:00 that night is EST.
    const fallBack = ok(
      normalizeListing(
        harvested({ title: "Halloween Social", local_date: "2026-10-31", end_time: "03:00" }),
        ctx,
      ),
    );
    expect(fallBack).toMatchObject({
      nightDate: "2026-10-31",
      startsAt: null,
      key: "2026-10-31|untimed|halloween social",
    });
    expect(fallBack.endsAt?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    // New York springs forward at 02:00 on 2026-03-08; the night is still the listed date.
    const springForward = ok(
      normalizeListing(harvested({ title: "Milonga", local_date: "2026-03-07" }), ctx),
    );
    expect(springForward).toMatchObject({ nightDate: "2026-03-07", startsAt: null });
  });

  it("keeps a cancelled untimed listing, marked cancelled", () => {
    const event = ok(
      normalizeListing(
        harvested({ title: "Brooklyn Social", local_date: "2026-09-25", cancelled: true }),
        ctx,
      ),
    );
    expect(event).toMatchObject({ cancelled: true, confirmation: "cancelled", startsAt: null });
  });

  it("keys on the source's own id when there is one, so a later time updates the same row", () => {
    const event = ok(
      normalizeListing(
        harvested({ title: "Bachata Night", local_date: "2026-09-26" }, { externalId: "tm:A6" }),
        ctx,
      ),
    );
    expect(event).toMatchObject({ key: "tm:A6", startsAt: null, nightDate: "2026-09-26" });
  });
});

describe("the not-an-event screen in normalize", () => {
  it("reports a title that is only a date or a closure notice as not an event, apart from a reject", () => {
    expect(
      normalizeListing(harvested({ title: "October 1, 2026", local_date: "2026-10-01" }), ctx),
    ).toEqual({
      ok: false,
      kind: "not_an_event",
      reason: "only a date or a heading",
      title: "October 1, 2026",
    });
    expect(
      normalizeListing(
        harvested({ title: "Studio closed", local_date: "2026-09-25", dancing_time: "19:00" }),
        ctx,
      ),
    ).toMatchObject({ ok: false, kind: "not_an_event", reason: "a closure notice" });
  });
});

describe("one source's run: a night with and without a time", () => {
  const event = (fields: Record<string, unknown>) => ok(normalizeListing(harvested(fields), ctx));

  it("drops the untimed listing that has a timed sibling, with a note, and keeps the rest", () => {
    const timed = event({ title: "Salsa Social", local_date: "2026-09-25", dancing_time: "21:00" });
    const sibling = event({ title: "Salsa Social!", local_date: "2026-09-25" });
    const otherNight = event({ title: "Salsa Social", local_date: "2026-09-26" });
    const otherTitle = event({ title: "Bachata Social", local_date: "2026-09-25" });
    const { kept, notes } = dropUntimedWithTimedSibling([sibling, timed, otherNight, otherTitle]);
    expect(kept).toEqual([timed, otherNight, otherTitle]);
    expect(notes).toEqual([
      "Salsa Social!: listed on 2026-09-25 with no time and again with one; kept the one with the time",
    ]);
  });

  it("keeps an untimed listing that has an id of its own, whatever shares its title", () => {
    // A metro-wide API (Ticketmaster) is one source: its "time TBA" event is a listing in its own
    // right even when another event that night has the same title (review, 2026-09-28).
    const keyed = (id: string, fields: Record<string, unknown>) =>
      ok(normalizeListing(harvested(fields, { externalId: id }), ctx));
    const tba = keyed("tm:B2", { title: "Salsa Social", local_date: "2026-09-25" });
    const timed = keyed("tm:A1", {
      title: "Salsa Social",
      local_date: "2026-09-25",
      dancing_time: "21:00",
    });
    expect(tba.startsAt).toBeNull();
    expect(dropUntimedWithTimedSibling([tba, timed])).toEqual({ kept: [tba, timed], notes: [] });
  });

  it("keeps every listing of a night whose listings all lack a time", () => {
    const a = event({ title: "Brooklyn Social", local_date: "2026-09-25" });
    const b = event({ title: "Frim Fram Jam", local_date: "2026-09-25" });
    expect(dropUntimedWithTimedSibling([a, b])).toEqual({ kept: [a, b], notes: [] });
  });
});

describe("a rule whose time is not listed (D-060)", () => {
  const tuesdays = (dtstartLocal: string, fields: Record<string, unknown> = {}) =>
    harvested(
      { title: "English - Tuesdays", listing_type: "class", ...fields },
      {
        recurrence: {
          rrule: "FREQ=WEEKLY;BYDAY=TU",
          dtstartLocal,
          exdates: [],
          timeListed: false,
        },
      },
    );

  it("lists each night on the rule's own day, with no time", () => {
    // 2026-09-28 is a Monday.
    const { listings, error } = expandRecurrence(
      tuesdays(`2026-09-28T${UNTIMED_RULE_ANCHOR}`),
      "2026-09-28",
      "America/New_York",
      14,
    );
    expect(error).toBeNull();
    expect(listings.map((l) => l.listing.local_date)).toEqual(["2026-09-29", "2026-10-06"]);
    for (const l of listings) {
      expect([l.listing.doors_time, l.listing.lesson_time, l.listing.dancing_time]).toEqual([
        null,
        null,
        null,
      ]);
    }
    const first = ok(normalizeListing(listings[0]!, ctx));
    expect(first).toMatchObject({
      startsAt: null,
      nightDate: "2026-09-29",
      key: "2026-09-29|untimed|english tuesdays",
      confirmation: "recurring_unconfirmed",
      fromRule: true,
    });
  });

  it("anchors at noon whatever time the harvester wrote, so no night moves to the day before", () => {
    const { listings } = expandRecurrence(
      tuesdays("2026-09-28T00:00"),
      "2026-09-28",
      "America/New_York",
      14,
    );
    expect(listings.map((l) => l.listing.local_date)).toEqual(["2026-09-29", "2026-10-06"]);
    expect(listings.every((l) => l.listing.dancing_time === null)).toBe(true);
  });

  it("stays on its day across a DST change", () => {
    const saturdays = harvested(
      { title: "Saturday Milonga" },
      {
        recurrence: {
          rrule: "FREQ=WEEKLY;BYDAY=SA",
          dtstartLocal: "2026-10-24T12:00",
          exdates: ["2026-10-31"],
          timeListed: false,
        },
      },
    );
    const { listings } = expandRecurrence(saturdays, "2026-10-24", "America/New_York", 21);
    expect(listings.map((l) => l.listing.local_date)).toEqual(["2026-10-24", "2026-11-07"]);
  });

  it("keeps a time the listing itself states (an all-day rule whose words give the dancing)", () => {
    const { listings } = expandRecurrence(
      tuesdays("2026-09-28T12:00", { dancing_time: "19:30" }),
      "2026-09-28",
      "America/New_York",
      7,
    );
    expect(listings.map((l) => l.listing.dancing_time)).toEqual(["19:30"]);
    expect(ok(normalizeListing(listings[0]!, ctx)).startsAt?.toISOString()).toBe(
      "2026-09-29T23:30:00.000Z",
    );
  });

  it("comes from a model read with no stated time, instead of an invented midnight", () => {
    // Before D-060 this row became dancing at 00:00 on 2026-09-29, on the night of the 28th.
    const extraction = rawExtractionSchema.parse({
      page_kind: "class_schedule",
      language: "en",
      listings: [
        {
          title: "English - Tuesdays",
          listing_type: "class",
          styles: [],
          recurrence_text: "every Tuesday",
          venue: {},
          organizer: {},
        },
        {
          title: "Thursday Swing",
          listing_type: "social",
          styles: [],
          recurrence_text: "every Thursday",
          dancing_time: "20:00",
          venue: {},
          organizer: {},
        },
      ],
    });
    const [untimed, timed] = extractionToHarvested(extraction, {
      pageUrl: "https://school.example/",
      fetchedAt: NOW,
      today: "2026-09-28",
    }).listings;
    expect(untimed?.recurrence).toMatchObject({
      dtstartLocal: "2026-09-28T12:00",
      timeListed: false,
    });
    expect(untimed?.recurrence?.rrule).toContain("BYDAY=TU");
    expect(timed?.recurrence).toMatchObject({ dtstartLocal: "2026-09-28T20:00" });
    expect(timed?.recurrence?.timeListed).toBeUndefined();

    const nights = expandRecurrence(untimed!, "2026-09-28", "America/New_York", 7).listings;
    const event = ok(normalizeListing(nights[0]!, ctx));
    expect(event).toMatchObject({ nightDate: "2026-09-29", startsAt: null, dancingAt: null });
  });
});

describe("placeholder times a site prints on every event (D-063)", () => {
  const base = {
    title: "Milonga Bienvenida",
    listing_type: "social",
    local_date: "2026-09-28",
  } as const;

  it("reads a placeholder as not listed, in every time field, and keeps real times", () => {
    const listing = harvested({
      ...base,
      doors_time: "15:00",
      lesson_time: "18:30",
      end_time: "15:00",
    });
    const { harvested: cleaned, dropped } = withoutPlaceholderTimes(listing, ["15:00"]);
    expect(dropped).toBe(2);
    expect(cleaned.listing.doors_time).toBeNull();
    expect(cleaned.listing.end_time).toBeNull();
    expect(cleaned.listing.lesson_time).toBe("18:30");
    // The input is not mutated: the harvest result is reported elsewhere as it came.
    expect(listing.listing.doors_time).toBe("15:00");
  });

  it("leaves a listing alone when its source has no placeholders or none matches", () => {
    const listing = harvested({ ...base, doors_time: "15:00" });
    expect(withoutPlaceholderTimes(listing, []).harvested).toBe(listing);
    expect(withoutPlaceholderTimes(listing, ["21:00"])).toEqual({ harvested: listing, dropped: 0 });
  });

  it("turns a rule anchored at the placeholder into a rule with no time (D-065)", () => {
    // "Every Monday", read beside "3:00 PM": the rule is anchored at the listing's first time, and
    // its nights would take 15:00 back as their dancing time once the listing's own time is gone.
    const [monday] = extractionToHarvested(
      rawExtractionSchema.parse({
        page_kind: "event_list",
        language: "en",
        listings: [
          {
            title: "Mondays Milongueros",
            listing_type: "social",
            styles: ["milonga"],
            local_date: null,
            recurrence_text: "every Monday",
            doors_time: "15:00",
            venue: {},
            organizer: {},
          },
        ],
      }),
      { pageUrl: "https://theronda.example/nyc", fetchedAt: NOW, today: "2026-09-28" },
    ).listings;
    expect(monday?.recurrence).toMatchObject({ dtstartLocal: "2026-09-28T15:00" });
    const { harvested: cleaned, dropped } = withoutPlaceholderTimes(monday!, ["15:00"]);
    expect(dropped).toBe(2);
    expect(cleaned.recurrence).toMatchObject({
      dtstartLocal: "2026-09-28T12:00",
      timeListed: false,
    });
    const nights = expandRecurrence(cleaned, "2026-09-28", "America/New_York", 8).listings;
    expect(nights.map((n) => n.listing.local_date)).toEqual(["2026-09-28", "2026-10-05"]);
    for (const night of nights)
      expect(ok(normalizeListing(night, ctx))).toMatchObject({ startsAt: null, dancingAt: null });
    // A rule at a real time is left alone.
    const { harvested: evening } = withoutPlaceholderTimes(
      { ...monday!, recurrence: { ...monday!.recurrence!, dtstartLocal: "2026-09-28T20:00" } },
      ["15:00"],
    );
    expect(evening.recurrence).toMatchObject({ dtstartLocal: "2026-09-28T20:00" });
    expect(evening.recurrence?.timeListed).toBeUndefined();
  });

  it("turns a listing whose only time was the placeholder into one with no time", () => {
    const { harvested: cleaned2 } = withoutPlaceholderTimes(
      harvested({ ...base, doors_time: "15:00" }),
      ["15:00"],
    );
    const outcome = normalizeListing(cleaned2, ctx);
    expect(outcome.ok && outcome.event.startsAt).toBeNull();
  });
});

describe("withoutStartTimes", () => {
  const base = {
    title: "Milonga Bienvenida",
    listing_type: "social",
    local_date: "2026-09-28",
  } as const;

  it("drops doors and dancing times, keeps lesson and end times", () => {
    const listing = harvested({
      ...base,
      doors_time: "16:00",
      dancing_time: "16:00",
      lesson_time: "19:00",
      end_time: "23:00",
    });
    const { harvested: cleaned, dropped } = withoutStartTimes(listing);
    expect(dropped).toBe(2);
    expect(cleaned.listing.doors_time).toBeNull();
    expect(cleaned.listing.dancing_time).toBeNull();
    expect(cleaned.listing.lesson_time).toBe("19:00");
    expect(cleaned.listing.end_time).toBe("23:00");
    expect(cleaned.timesWithdrawn).toEqual({ pageStarts: [], pageEnds: [] });
    // Input not mutated
    expect(listing.listing.doors_time).toBe("16:00");
    expect(listing.listing.dancing_time).toBe("16:00");
  });

  it("returns same object and dropped 0 when no doors/dancing time", () => {
    const listing = harvested({
      ...base,
      lesson_time: "19:00",
      end_time: "23:00",
    });
    const { harvested: cleaned, dropped } = withoutStartTimes(listing);
    expect(cleaned).toBe(listing);
    expect(dropped).toBe(0);
  });

  it("turns a rule anchored at a time into timeListed false", () => {
    const [monday] = extractionToHarvested(
      rawExtractionSchema.parse({
        page_kind: "event_list",
        language: "en",
        listings: [
          {
            title: "Mondays Milongueros",
            listing_type: "social",
            styles: ["milonga"],
            local_date: null,
            recurrence_text: "every Monday",
            doors_time: "16:00",
            venue: {},
            organizer: {},
          },
        ],
      }),
      { pageUrl: "https://theronda.example/nyc", fetchedAt: NOW, today: "2026-09-28" },
    ).listings;
    expect(monday?.recurrence).toMatchObject({ dtstartLocal: "2026-09-28T16:00" });
    const { harvested: cleaned, dropped } = withoutStartTimes(monday!);
    expect(dropped).toBe(2); // doors_time + recurrence
    expect(cleaned.recurrence).toMatchObject({
      dtstartLocal: "2026-09-28T12:00",
      timeListed: false,
    });
  });
});

describe("a class whose own title names another kind of night (D-063)", () => {
  it("keeps the title's word when the model read a milonga or a practica as a class", () => {
    expect(typeFromTitle("Milonga Bienvenida", "class")).toBe("social");
    // Milongueros are the people at a milonga: the title names a milonga (D-070).
    expect(typeFromTitle("Mondays Milongueros", "class")).toBe("social");
    expect(typeFromTitle("Robins Argentine Tango Practica", "class")).toBe("practica");
    expect(typeFromTitle("Bachata Social", "class")).toBe("social");
  });

  it("gives a listing read as 'other' the kind its title names (D-070)", () => {
    // The Ronda's milongas were stored as "Tango · Other".
    expect(typeFromTitle("Esa! Milonga", "other")).toBe("social");
    expect(typeFromTitle("Los Tres Amigos Milonga", "other")).toBe("social");
    expect(typeFromTitle("Pasion Milonguera", "other")).toBe("social");
    expect(typeFromTitle("Victoria's Practica", "other")).toBe("practica");
    expect(typeFromTitle("Salsa class for beginners", "other")).toBe("class");
    // A title that names no kind leaves "other" as it was: nothing is invented.
    expect(typeFromTitle("Tango Cafe", "other")).toBe("other");
  });

  it("leaves a real class, an unnamed title, and every other reading alone", () => {
    expect(typeFromTitle("Milonga class for beginners", "class")).toBe("class");
    expect(typeFromTitle("Tango y Te", "class")).toBe("class");
    expect(typeFromTitle("West Coast Swing with Jes Ann Nail", "class")).toBe("class");
    expect(typeFromTitle("Salsa Social", "club_night")).toBe("club_night");
    expect(typeFromTitle("Practica", "social")).toBe("social");
  });
});

describe("a family the title names, and a club night with no style (D-070)", () => {
  const stylesOf = (fields: Record<string, unknown>, sourceStyles: string[] = []) => {
    const e = ok(
      normalizeListing(harvested({ local_date: "2026-09-29", ...fields }), {
        ...ctx,
        source: { styles: sourceStyles },
      }),
    );
    return { styles: e.styles, families: familiesOf(e.styles), from: e.stylesFrom };
  };

  it("keeps a title that names only the family, so the family's chip counts it", () => {
    // Stepping Out's "Tango Y Te" was stored with no style, so no Tango chip counted it.
    expect(stylesOf({ title: "Tango Y Te" })).toEqual({
      styles: ["tango"],
      families: ["tango"],
      from: "title",
    });
    expect(stylesOf({ title: "Swing night at the Loft" }).families).toEqual(["swing"]);
    // A title that names a style keeps the style alone.
    expect(stylesOf({ title: "Milonga Bienvenida" }).styles).toEqual(["milonga"]);
    // The source's one style stands in for the family when it is of that family.
    expect(stylesOf({ title: "Tango Cafe" }, ["milonga"])).toEqual({
      styles: ["milonga"],
      families: ["tango"],
      from: "source_hint",
    });
    expect(stylesOf({ title: "Tango Cafe" }, ["lindy_hop"]).styles).toEqual(["tango"]);
    // What a listing states itself is left alone.
    expect(stylesOf({ title: "Tango Y Te", styles: ["practica"] }).styles).toEqual(["practica"]);
  });

  it("puts a club night that names no style in the club family, and invents nothing else", () => {
    expect(stylesOf({ title: "Earlybirds Club", listing_type: "club_night" })).toEqual({
      styles: ["club"],
      families: ["club"],
      from: "listing_type",
    });
    expect(stylesOf({ title: "Supertall", listing_type: "club_night" }).families).toEqual(["club"]);
    expect(stylesOf({ title: "Dancehall at 9AM", listing_type: "club_night" }).styles).toEqual([
      "dancehall",
    ]);
    expect(stylesOf({ title: "Supertall", listing_type: "social" }).styles).toEqual([]);
  });

  it("reads milongueros as a milonga", () => {
    expect(stylesOf({ title: "Mondays Milongueros" }).styles).toEqual(["milonga"]);
  });
});

describe("links: a ticket link is a ticket link (D-070)", () => {
  it("stores an event page the source links as the canonical URL, apart from tickets", () => {
    const e = ok(
      normalizeListing(
        harvested(
          { title: "Tango Cafe", local_date: "2026-09-30", ticket_url: null },
          { eventUrl: "https://www.theronda.us/event/tango-cafe-2026-09-30-74420121" },
        ),
        ctx,
      ),
    );
    expect(e.ticketUrl).toBeNull();
    expect(e.canonicalUrl).toBe("https://www.theronda.us/event/tango-cafe-2026-09-30-74420121");
    expect(
      ok(normalizeListing(harvested({ title: "X", local_date: "2026-09-30" }), ctx)),
    ).toMatchObject({ canonicalUrl: null });
  });
});

describe("an organiser the read took from a neighbouring listing (D-105)", () => {
  it("is withdrawn, so the stored row stops pointing at it", () => {
    const out = ok(
      normalizeListing(
        harvested(
          { title: "Ballroom and Smooth Practice", local_date: "2026-09-29" },
          { organizerWithdrawn: true },
        ),
        ctx,
      ),
    );
    expect(out.organizer).toEqual({ name: null, url: null });
    expect(out.withdrawn).toEqual(["organizer_name"]);
  });

  it("is left alone when the check withdrew nothing", () => {
    const out = ok(
      normalizeListing(
        harvested({
          title: "Tango Y Te",
          local_date: "2026-10-04",
          organizer: { name: "Maria Jose Sosa" },
        }),
        ctx,
      ),
    );
    expect(out.organizer.name).toBe("Maria Jose Sosa");
    expect(out.withdrawn).toEqual([]);
  });
});

describe("facts a directory's page gets wrong (D-070)", () => {
  const ronda = { styles: [], url: "https://theronda.us/nyc", trustTier: "directory" as const };
  const swing = {
    styles: [],
    url: "https://thisweekinswingnyc.com/",
    trustTier: "directory" as const,
  };
  const event = (fields: Record<string, unknown>, source: NormalizeContext["source"]) =>
    ok(
      normalizeListing(harvested({ title: "Tango Cafe", local_date: "2026-09-30", ...fields }), {
        ...ctx,
        source,
      }),
    );

  it("withdraws a directory named as the organiser, by its name or its own link", () => {
    const byName = event({ organizer: { name: "Theronda", url: null } }, ronda);
    expect(byName.organizer).toEqual({ name: null, url: null });
    expect(byName.withdrawn).toEqual(["organizer_name"]);
    expect(event({ organizer: { name: "The Ronda", url: null } }, ronda).organizer.name).toBeNull();
    const byLink = event(
      { organizer: { name: "Eileen", url: "https://thisweekinswingnyc.com/author/eileen/" } },
      swing,
    );
    expect(byLink.organizer).toEqual({ name: null, url: null });
    expect(
      event({ organizer: { name: "This Week in Swing", url: null } }, swing).organizer.name,
    ).toBeNull();
  });

  it("keeps a real organiser, and an organiser on a first-party site", () => {
    const host = event(
      { organizer: { name: "Jon Tariq", url: "https://www.tangoschool.nyc/" } },
      ronda,
    );
    expect(host.organizer).toEqual({ name: "Jon Tariq", url: "https://www.tangoschool.nyc/" });
    expect(host.withdrawn).toEqual([]);
    const studio = event(
      {
        organizer: {
          name: "Stepping Out Studios",
          url: "https://www.steppingoutstudios.com/",
        },
      },
      {
        styles: [],
        url: "https://steppingoutstudios.com/social-events1",
        trustTier: "first_party",
      },
    );
    expect(studio.organizer.name).toBe("Stepping Out Studios");
  });

  it("drops a door code read as a dress code, and keeps a real one", () => {
    const door = event({ dress_code: "Door code: 9035#" }, ronda);
    expect(door.dressCode).toBeNull();
    expect(door.withdrawn).toEqual(["dress_code"]);
    for (const code of ["Passcode 4471", "Buzz #4471", "buzzer 12", "Gate code 1234"]) {
      expect(event({ dress_code: code }, ronda).dressCode, code).toBeNull();
    }
    for (const dress of ["Dress code: all black", "Dress to impress, 1920s"]) {
      expect(event({ dress_code: dress }, ronda).dressCode, dress).toBe(dress);
    }
    expect(event({ dress_code: "Smart casual, dance shoes" }, ronda).dressCode).toBe(
      "Smart casual, dance shoes",
    );
  });

  it("stores a level in sentence case", () => {
    expect(event({ level: "beginner" }, ronda).level).toBe("Beginner");
    expect(event({ level: "ALL LEVELS" }, ronda).level).toBe("All levels");
    expect(event({ level: "Int/Adv" }, ronda).level).toBe("Int/Adv");
    expect(event({ level: " " }, ronda).level).toBeNull();
    expect(sentenceCase(null)).toBeNull();
  });
});
