// D-812: a morning start whose own end is more than 12 hours later is an am/pm slip (daily check 2026-11-09).
// golatindance printed "7:40 am - 8:40 pm" for a Thursday evening class (card showed 7am); district.in printed
// "8:00 AM - Sat 14 Nov 1:30 AM" for Bombay Velvet 2.0, an 8pm club night (an 8am copy beside the real one).
import { describe, expect, it } from "vitest";

import { amPmSlip } from "@/src/domain/am-pm-slip";
import { rawListingSchema } from "@/src/domain/listing";
import { normalizeListing } from "@/src/pipeline/normalize";

const metro = (slug: string, tz: string, countryCode: string) => ({
  id: "m",
  slug,
  name: slug,
  countryCode,
  center: { lat: 0, lng: 0 },
  radiusKm: 50,
  tz,
  languages: ["en"],
});
const NYC = metro("nyc", "America/New_York", "US");
const MUMBAI = metro("mumbai", "Asia/Kolkata", "IN");
const NOW = new Date("2026-11-09T16:00:00Z");

function normalize(m: typeof NYC, fields: Record<string, unknown>) {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: [],
        venue: {},
        organizer: {},
        local_date: "2026-11-12",
        title: "Salsa Night at Dragonfly",
        ...fields,
      }),
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: { sourceUrl: "https://example.org/cal", fetchedAt: NOW, method: "feed" as const },
    },
    { metro: m, source: { styles: [] as string[] }, now: NOW },
  );
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.reason}`);
  return outcome.event;
}

/** "YYYY-MM-DD HH:MM" of an instant in a zone. */
function local(d: Date | null, tz: string): string | null {
  if (!d) return null;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

describe("amPmSlip", () => {
  it("moves a 07:40 start with a 20:40 end to 19:40", () => {
    expect(amPmSlip({ doors: null, lesson: "07:40", dancing: null, end: "20:40" })).toEqual({
      doors: null,
      lesson: "19:40",
      dancing: null,
    });
  });

  it("moves an 08:00 start with a 01:30 (next morning) end to 20:00", () => {
    expect(amPmSlip({ doors: null, lesson: null, dancing: "08:00", end: "01:30" })).toEqual({
      doors: null,
      lesson: null,
      dancing: "20:00",
    });
  });

  it("moves every stated morning time of the night, not only the first", () => {
    expect(amPmSlip({ doors: "07:30", lesson: null, dancing: "08:00", end: "21:00" })).toEqual({
      doors: "19:30",
      lesson: null,
      dancing: "20:00",
    });
  });

  it("returns null when nothing slipped", () => {
    // A real morning: 6 hours.
    expect(amPmSlip({ doors: null, lesson: null, dancing: "08:00", end: "14:00" })).toBeNull();
    // Exactly 12 hours is not more than 12.
    expect(amPmSlip({ doors: null, lesson: null, dancing: "08:00", end: "20:00" })).toBeNull();
    // A start from 09:00 is not read as a slip.
    expect(amPmSlip({ doors: null, lesson: null, dancing: "09:00", end: "23:00" })).toBeNull();
    // No end, no evidence.
    expect(amPmSlip({ doors: null, lesson: null, dancing: "07:00", end: null })).toBeNull();
    // No start.
    expect(amPmSlip({ doors: null, lesson: null, dancing: null, end: "20:00" })).toBeNull();
    // Before 06:00 is the night's small hours, never a morning slip.
    expect(amPmSlip({ doors: null, lesson: null, dancing: "02:00", end: "20:00" })).toBeNull();
    // An afternoon time on the night is never moved, so a 07:00 doors with a 14:00 lesson is left alone.
    expect(amPmSlip({ doors: "07:00", lesson: "14:00", dancing: null, end: "22:00" })).toBeNull();
  });
});

describe("normalizeListing reads an am/pm slip as the evening (D-812)", () => {
  it("golatindance 7:40 am - 8:40 pm class is 19:40-20:40 on its night", () => {
    const e = normalize(NYC, { listing_type: "class", lesson_time: "07:40", end_time: "20:40" });
    expect(local(e.startsAt, NYC.tz)).toBe("2026-11-12 19:40");
    expect(local(e.endsAt, NYC.tz)).toBe("2026-11-12 20:40");
    expect(e.nightDate).toBe("2026-11-12");
  });

  it("district.in 8:00 AM - next day 1:30 AM is 20:00 to 01:30", () => {
    const e = normalize(MUMBAI, {
      listing_type: "club_night",
      local_date: "2026-11-13",
      dancing_time: "08:00",
      end_time: "01:30",
    });
    expect(local(e.startsAt, MUMBAI.tz)).toBe("2026-11-13 20:00");
    expect(local(e.endsAt, MUMBAI.tz)).toBe("2026-11-14 01:30");
    expect(e.nightDate).toBe("2026-11-13");
  });

  it("leaves a real morning and a long day as they were", () => {
    const morning = normalize(NYC, { dancing_time: "08:00", end_time: "14:00" });
    expect(local(morning.startsAt, NYC.tz)).toBe("2026-11-12 08:00");
    expect(local(morning.endsAt, NYC.tz)).toBe("2026-11-12 14:00");
    const day = normalize(NYC, { dancing_time: "10:00", end_time: "23:00" });
    expect(local(day.startsAt, NYC.tz)).toBe("2026-11-12 10:00");
    expect(day.endsAt).toBeNull();
  });
});

// D-816 (Tokyo-6 gap report 11-10): Salsa Vida's "Latin Night at Egoland, Starts at 8am until 8pm" is an 8pm night.
describe("an exactly 12-hour morning start on a night title (D-816)", () => {
  const TOKYO = metro("tokyo", "Asia/Tokyo", "JP");

  it("amPmSlip moves it and drops the end only with nightTitle", () => {
    expect(
      amPmSlip({ doors: null, lesson: null, dancing: "08:00", end: "20:00", nightTitle: true }),
    ).toEqual({ doors: null, lesson: null, dancing: "20:00", dropEnd: true });
    expect(amPmSlip({ doors: null, lesson: null, dancing: "08:00", end: "20:00" })).toBeNull();
    expect(
      amPmSlip({ doors: null, lesson: null, dancing: "08:00", end: "19:00", nightTitle: true }),
    ).toBeNull();
  });

  it("Latin Night at Egoland 8am-8pm is 20:00 with no end", () => {
    const e = normalize(TOKYO, {
      title: "Latin Night at Egoland",
      local_date: "2026-11-13",
      dancing_time: "08:00",
      end_time: "20:00",
    });
    expect(local(e.startsAt, TOKYO.tz)).toBe("2026-11-13 20:00");
    expect(e.endsAt).toBeNull();
    expect(e.nightDate).toBe("2026-11-13");
  });

  it("a day workshop 8am-8pm is left as it was", () => {
    const e = normalize(NYC, {
      title: "Salsa Workshop Day",
      listing_type: "class",
      dancing_time: "08:00",
      end_time: "20:00",
    });
    expect(local(e.startsAt, NYC.tz)).toBe("2026-11-12 08:00");
    expect(local(e.endsAt, NYC.tz)).toBe("2026-11-12 20:00");
  });
});

// D-883 (daily check 2026-11-13, London): londonsalsaevents.uk gave "Bailando Thursdays" 07:00-11:30 beside
// social-dance.today's 19:30-23:30, so the two never paired.
describe("a weekly or night-titled social printed wholly in the morning (D-883)", () => {
  it("amPmSlip moves start and end with eveningTitle only", () => {
    const t = { doors: null, lesson: null, dancing: "07:00", end: "11:30" };
    expect(amPmSlip({ ...t, eveningTitle: true })).toEqual({
      doors: null,
      lesson: null,
      dancing: "19:00",
      end: "23:30",
    });
    expect(amPmSlip(t)).toBeNull();
  });

  it("a 3-hour day-break party and a party ending after noon stay as they are", () => {
    expect(
      amPmSlip({ doors: null, lesson: null, dancing: "06:00", end: "09:00", eveningTitle: true }),
    ).toBeNull();
    expect(
      amPmSlip({ doors: null, lesson: null, dancing: "08:00", end: "12:30", eveningTitle: true }),
    ).toBeNull();
  });

  it("Bailando Thursdays 07:00-11:30 is 19:00-23:30", () => {
    const e = normalize(NYC, {
      title: "Bailando Thursdays",
      listing_type: "social",
      dancing_time: "07:00",
      end_time: "11:30",
    });
    expect(local(e.startsAt, NYC.tz)).toBe("2026-11-12 19:00");
    expect(local(e.endsAt, NYC.tz)).toBe("2026-11-12 23:30");
  });

  it("a weekly morning class is left as it was", () => {
    const e = normalize(NYC, {
      title: "Salsa Thursdays",
      listing_type: "class",
      dancing_time: "07:00",
      end_time: "11:30",
    });
    expect(local(e.startsAt, NYC.tz)).toBe("2026-11-12 07:00");
  });
});
