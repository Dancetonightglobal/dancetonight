import { describe, expect, it } from "vitest";

import {
  MATERIALIZE_DAYS,
  RecurrenceError,
  importExdates,
  materialize,
  nightDate,
  parseRecurrenceText,
  parseRule,
  parseStoredRule,
  recurrenceText,
  type Occurrence,
} from "@/src/domain/recurrence";
import { nightDate as tonightNightDate } from "@/src/domain/tonight";

const NY = "America/New_York";
const PARIS = "Europe/Paris";
const SYDNEY = "Australia/Sydney";

/** "Thu 20:00": the wall clock of an instant in a zone, built from parts so ICU punctuation cannot vary. */
function localClock(t: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")}`;
}

function nights(occurrences: readonly Occurrence[]): string[] {
  return occurrences.map((o) => o.nightDate);
}

describe("nightDate (local helper, D-004)", () => {
  it("puts a 1am Saturday start on Friday's night date", () => {
    // 2026-10-03 is a Saturday; 01:00 EDT is 05:00Z.
    expect(nightDate(new Date("2026-10-03T05:00:00Z"), NY)).toBe("2026-10-02");
  });

  it("keeps a 6am start on its own date and a 5:59 start on the night before", () => {
    expect(nightDate(new Date("2026-10-03T10:00:00Z"), NY)).toBe("2026-10-03");
    expect(nightDate(new Date("2026-10-03T09:59:00Z"), NY)).toBe("2026-10-02");
  });

  it("works in a half-hour zone", () => {
    // 05:30 IST on 2026-11-02 is 2026-11-02T00:00Z; the local clock reads before 6am, so the 1st.
    expect(nightDate(new Date("2026-11-02T00:00:00Z"), "Asia/Kolkata")).toBe("2026-11-01");
  });

  // Instants inside the hour a DST transition shifts, where "local date of (start minus 6 h)"
  // and the wall-clock rule disagree. The wall clock wins (D-004 as amended).
  const shiftedHour: readonly [zone: string, iso: string, clock: string, night: string][] = [
    [NY, "2026-03-08T10:30:00Z", "Sun 06:30", "2026-03-08"], // EDT, clocks went forward
    [NY, "2026-11-01T10:30:00Z", "Sun 05:30", "2026-10-31"], // EST, clocks went back
    [PARIS, "2026-03-29T04:30:00Z", "Sun 06:30", "2026-03-29"], // CEST, spring forward
    [PARIS, "2026-10-25T04:30:00Z", "Sun 05:30", "2026-10-24"], // CET, fall back
    [SYDNEY, "2026-04-04T19:30:00Z", "Sun 05:30", "2026-04-04"], // AEST, DST ended
    [SYDNEY, "2026-10-03T19:30:00Z", "Sun 06:30", "2026-10-04"], // AEDT, DST began
  ];

  it.each(shiftedHour)("agrees with tonight.ts in %s at %s (%s)", (zone, iso, clock, night) => {
    const t = new Date(iso);
    expect(localClock(t, zone)).toBe(clock);
    expect(nightDate(t, zone)).toBe(night);
    expect(tonightNightDate(t, zone)).toBe(night);
  });

  it.each([
    ["8pm Thursday stays on Thursday", "2026-10-02T00:00:00Z", "2026-10-01"],
    ["1am Saturday is Friday's night", "2026-10-03T05:00:00Z", "2026-10-02"],
    ["05:59 belongs to the previous day", "2026-10-03T09:59:00Z", "2026-10-02"],
    ["06:00 belongs to its own day", "2026-10-03T10:00:00Z", "2026-10-03"],
  ])("agrees with tonight.ts in the plain case: %s", (_label, iso, night) => {
    const t = new Date(iso);
    expect(nightDate(t, NY)).toBe(night);
    expect(tonightNightDate(t, NY)).toBe(night);
  });
});

describe("Turkish phrases (D-683)", () => {
  it("parses weekly phrases", () => {
    expect(parseRecurrenceText("her Salı", "tr")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("HER SALI", "tr")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("her Cuma akşamı", "tr")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("her hafta Çarşamba", "tr")).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(parseRecurrenceText("Perşembe günleri", "tr")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("Cuma ve Cumartesi geceleri", "tr")).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(parseRecurrenceText("Salıları", "tr")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("Pazarları", "tr")).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(parseRecurrenceText("Pazartesileri", "tr")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(parseRecurrenceText("Cumartesileri", "tr")).toBe("FREQ=WEEKLY;BYDAY=SA");
    expect(parseRecurrenceText("Perşembeleri ve Cumaları", "tr")).toBe("FREQ=WEEKLY;BYDAY=TH,FR");
    expect(parseRecurrenceText("iki haftada bir Cuma", "tr")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    );
  });

  it("parses monthly phrases", () => {
    expect(parseRecurrenceText("ayın ilk Cuması", "tr")).toBe("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1");
    expect(parseRecurrenceText("her ayın son Cumartesisi", "tr")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=-1",
    );
    expect(parseRecurrenceText("ayın ilk Perşembesi", "tr")).toBe(
      "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=1",
    );
    expect(parseRecurrenceText("ayın ikinci ve dördüncü Pazartesisi", "tr")).toBe(
      "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2,4",
    );
  });

  it("parses weekday range and frequency phrases", () => {
    expect(parseRecurrenceText("hafta içi", "tr")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("her gün", "tr")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("her hafta", "tr")).toBe("FREQ=WEEKLY");
    expect(parseRecurrenceText("aylık", "tr")).toBe("FREQ=MONTHLY");
  });

  it("returns null for ambiguous or one-off phrases", () => {
    expect(parseRecurrenceText("Salı", "tr")).toBeNull();
    expect(parseRecurrenceText("bu Cuma", "tr")).toBeNull();
    expect(parseRecurrenceText("Cuma akşamı", "tr")).toBeNull();
    expect(parseRecurrenceText("genellikle Cuma", "tr")).toBeNull();
  });

  it("works without explicit lang", () => {
    expect(parseRecurrenceText("her Salı")).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("does not break other languages", () => {
    expect(parseRecurrenceText("todos los viernes", "es")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("every Thursday", "en")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("todas as sextas", "pt")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("1st and 3rd Saturdays", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1,3",
    );
    expect(parseRecurrenceText("todos los viernes")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });
});

describe("Portuguese and Catalan phrases (D-232)", () => {
  it("parses Portuguese weekly phrases", () => {
    expect(parseRecurrenceText("todas as sextas", "pt")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("Às quintas-feiras", "pt")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("toda quinta", "pt")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("aos sábados e domingos", "pt")).toBe("FREQ=WEEKLY;BYDAY=SA,SU");
    expect(parseRecurrenceText("todas as terças-feiras à noite", "pt")).toBe(
      "FREQ=WEEKLY;BYDAY=TU",
    );
    // Note: the comma in "a cada duas semanas, às sextas" is normalized to space, so we test without comma
    expect(parseRecurrenceText("a cada duas semanas às sextas", "pt")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    );
    expect(parseRecurrenceText("de segunda a sexta", "pt")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(parseRecurrenceText("a sexta", "pt")).toBeNull();
  });

  it("parses Portuguese monthly phrases", () => {
    expect(parseRecurrenceText("segunda quinta-feira do mês", "pt")).toBe(
      "FREQ=MONTHLY;BYDAY=TH;BYSETPOS=2",
    );
    expect(parseRecurrenceText("último sábado do mês", "pt")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=-1",
    );
  });

  it("parses Catalan weekly phrases", () => {
    expect(parseRecurrenceText("cada divendres", "ca")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("tots els dijous", "ca")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("els dimarts", "ca")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("cada dues setmanes els divendres", "ca")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    );
    expect(parseRecurrenceText("de dilluns a divendres", "ca")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
  });

  it("parses Catalan monthly phrases", () => {
    expect(parseRecurrenceText("el primer dissabte de cada mes", "ca")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1",
    );
    // "de mes" makes it the 2nd Sunday of the month, as es reads "cada segundo domingo del mes".
    expect(parseRecurrenceText("cada segon diumenge de mes", "ca")).toBe(
      "FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2",
    );
  });

  it("parses no-lang fallback with pt and ca", () => {
    // A bare list of singular days names dates, not a habit (as "jueves y viernes" in es).
    expect(parseRecurrenceText("dijous i divendres")).toBeNull();
    expect(parseRecurrenceText("divendres 31 d'octubre", "ca")).toBeNull();
    expect(parseRecurrenceText("quinta 30 de outubro", "pt")).toBeNull();
    expect(parseRecurrenceText("todos os sábados", "pt")).toBe("FREQ=WEEKLY;BYDAY=SA");
    // Portuguese phrase without lang
    expect(parseRecurrenceText("todas as sextas")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });
});

describe("parseRule", () => {
  it("builds a stored string whose DTSTART carries TZID and the wall time", () => {
    const rule = parseRule("FREQ=WEEKLY;BYDAY=TH", "2026-10-01T20:00", NY);
    expect(rule.rruleString).toBe(
      "DTSTART;TZID=America/New_York:20261001T200000\nRRULE:FREQ=WEEKLY;BYDAY=TH",
    );
    expect(rule.tz).toBe(NY);
    expect(rule.dtstartLocal).toBe("2026-10-01T20:00:00");
    expect(rule.dtstart.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.interval).toBe(1);
    expect(rule.byDay).toEqual(["TH"]);
    expect(rule.count).toBeNull();
    expect(rule.until).toBeNull();
  });

  it("accepts an RRULE: prefix, seconds in the wall time and a set position rule", () => {
    const rule = parseRule(
      "RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2,4;COUNT=6",
      "2026-10-10T22:00:30",
      NY,
    );
    expect(rule.rruleString.endsWith("RRULE:FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2,4;COUNT=6")).toBe(
      true,
    );
    expect(rule.bySetPos).toEqual([2, 4]);
    expect(rule.count).toBe(6);
  });

  it("reads UNTIL back as an instant", () => {
    const rule = parseRule("FREQ=WEEKLY;BYDAY=TH;UNTIL=20261231T235959Z", "2026-10-01T20:00", NY);
    expect(rule.until?.toISOString()).toBe("2026-12-31T23:59:59.000Z");
  });

  it("rejects an unknown zone, a bad wall time, a bad rule and an inline DTSTART", () => {
    expect(() => parseRule("FREQ=WEEKLY", "2026-10-01T20:00", "Mars/Olympus")).toThrow(
      RecurrenceError,
    );
    expect(() => parseRule("FREQ=WEEKLY", "2026-10-01 20:00", NY)).toThrow(RecurrenceError);
    expect(() => parseRule("FREQ=WEEKLY", "2026-02-30T20:00", NY)).toThrow(RecurrenceError);
    expect(() => parseRule("FREQ=WEEKLY", "2026-10-01T25:00", NY)).toThrow(RecurrenceError);
    expect(() => parseRule("FREQ=SOMETIMES", "2026-10-01T20:00", NY)).toThrow(
      /Invalid recurrence rule/,
    );
    expect(() => parseRule("BYDAY=TH", "2026-10-01T20:00", NY)).toThrow(RecurrenceError);
    expect(() =>
      parseRule(
        "DTSTART;TZID=America/New_York:20261001T200000\nRRULE:FREQ=WEEKLY",
        "2026-10-01T20:00",
        NY,
      ),
    ).toThrow(/single RRULE body/);
    expect(() => parseRule("", "2026-10-01T20:00", NY)).toThrow(RecurrenceError);
  });

  it("parseStoredRule refuses a DTSTART without TZID", () => {
    expect(() => parseStoredRule("DTSTART:20261001T200000Z\nRRULE:FREQ=WEEKLY")).toThrow(/TZID/);
    expect(() => parseStoredRule("RRULE:FREQ=WEEKLY")).toThrow(/DTSTART/);
    expect(() => parseStoredRule("DTSTART;TZID=America/New_York:20261001T200000")).toThrow(/RRULE/);
  });

  it("parseStoredRule round-trips what parseRule stored", () => {
    const stored = parseRule("FREQ=WEEKLY;BYDAY=TH", "2026-10-01T20:00", NY).rruleString;
    const again = parseStoredRule(stored);
    expect(again.rruleString).toBe(stored);
    expect(again.dtstartLocal).toBe("2026-10-01T20:00:00");
  });
});

describe("materialize", () => {
  const thursday8pm = parseRule("FREQ=WEEKLY;BYDAY=TH", "2026-10-01T20:00", NY);
  const series = {
    rrule: thursday8pm.rruleString,
    tz: NY,
    durationMinutes: 240,
    venueId: "venue-1",
  };

  it("keeps 8pm local on both sides of the 2026-11-01 New York fall-back", () => {
    const occurrences = materialize(series, "2026-10-25", 14);
    expect(nights(occurrences)).toEqual(["2026-10-29", "2026-11-05"]);
    const [before, after] = occurrences;
    expect(localClock(before!.startsAt, NY)).toBe("Thu 20:00");
    expect(localClock(after!.startsAt, NY)).toBe("Thu 20:00");
    // The UTC instants differ by 25 hours less a week: EDT then EST.
    expect(before!.startsAt.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(after!.startsAt.toISOString()).toBe("2026-11-06T01:00:00.000Z");
  });

  it("cancels a 6:30am occurrence on the spring-forward morning by the wall-clock night date", () => {
    // 2026-03-08 06:30 EDT is 10:30Z; six real hours earlier the local clock read 03:30 EST on the
    // 7th, so the old reading keyed this occurrence "2026-03-07" and tonight.ts's "2026-03-08"
    // exception could not cancel it.
    const sunday630 = parseRule("FREQ=WEEKLY;BYDAY=SU", "2026-02-22T06:30", NY);
    const plain = materialize({ rrule: sunday630.rruleString, tz: NY }, "2026-03-01", 14);
    expect(nights(plain)).toEqual(["2026-03-01", "2026-03-08"]);
    const shifted = plain[1]!;
    expect(shifted.startsAt.toISOString()).toBe("2026-03-08T10:30:00.000Z");
    expect(localClock(shifted.startsAt, NY)).toBe("Sun 06:30");
    expect(shifted.nightDate).toBe(tonightNightDate(shifted.startsAt, NY));

    const cancelled = materialize(
      {
        rrule: sunday630.rruleString,
        tz: NY,
        exceptions: [{ nightDate: "2026-03-08", action: "cancel" }],
      },
      "2026-03-01",
      14,
    );
    expect(nights(cancelled)).toEqual(["2026-03-01"]);
  });

  it("keeps the wall time across the 2026-03-08 spring-forward too", () => {
    const rule = parseRule("FREQ=WEEKLY;BYDAY=TH", "2026-02-26T20:00", NY);
    const occurrences = materialize({ rrule: rule.rruleString, tz: NY }, "2026-03-01", 14);
    expect(nights(occurrences)).toEqual(["2026-03-05", "2026-03-12"]);
    expect(occurrences.map((o) => localClock(o.startsAt, NY))).toEqual(["Thu 20:00", "Thu 20:00"]);
    expect(occurrences[0]!.startsAt.toISOString()).toBe("2026-03-06T01:00:00.000Z");
    expect(occurrences[1]!.startsAt.toISOString()).toBe("2026-03-13T00:00:00.000Z");
  });

  it("marks every occurrence recurring_unconfirmed and carries the series venue and duration", () => {
    const occurrences = materialize(series, "2026-10-25", 14);
    for (const o of occurrences) {
      expect(o.confirmation).toBe("recurring_unconfirmed");
      expect(o.venueId).toBe("venue-1");
      expect(o.overridden).toBe(false);
      expect(o.endsAt!.getTime() - o.startsAt.getTime()).toBe(240 * 60_000);
    }
  });

  it("leaves endsAt null when the series has no duration (end not listed)", () => {
    const occurrences = materialize({ rrule: thursday8pm.rruleString, tz: NY }, "2026-10-25", 14);
    expect(occurrences.every((o) => o.endsAt === null)).toBe(true);
    expect(occurrences.every((o) => o.venueId === null)).toBe(true);
  });

  it("omits a cancelled night", () => {
    const occurrences = materialize(
      { ...series, exceptions: [{ nightDate: "2026-11-05", action: "cancel" }] },
      "2026-10-25",
      14,
    );
    expect(nights(occurrences)).toEqual(["2026-10-29"]);
  });

  it("moves the time for an override and recomputes the end from the duration", () => {
    const moved = new Date("2026-11-06T02:00:00.000Z"); // 9pm EST instead of 8pm
    const occurrences = materialize(
      {
        ...series,
        exceptions: [
          { nightDate: "2026-11-05", action: "override", override: { startsAt: moved } },
        ],
      },
      "2026-10-25",
      14,
    );
    expect(nights(occurrences)).toEqual(["2026-10-29", "2026-11-05"]);
    const night = occurrences[1]!;
    expect(night.startsAt.toISOString()).toBe(moved.toISOString());
    expect(night.endsAt?.toISOString()).toBe("2026-11-06T06:00:00.000Z");
    expect(night.overridden).toBe(true);
    expect(night.venueId).toBe("venue-1");
  });

  it("overrides the venue, an explicit end, or an end of null (not listed) without touching the start", () => {
    const occurrences = materialize(
      {
        ...series,
        exceptions: [
          { nightDate: "2026-10-29", action: "override", override: { venueId: "venue-2" } },
          {
            nightDate: "2026-11-05",
            action: "override",
            override: { endsAt: new Date("2026-11-06T03:30:00.000Z") },
          },
          { nightDate: "2026-11-12", action: "override", override: { endsAt: null } },
        ],
      },
      "2026-10-25",
      21,
    );
    expect(nights(occurrences)).toEqual(["2026-10-29", "2026-11-05", "2026-11-12"]);
    expect(occurrences[0]!.venueId).toBe("venue-2");
    expect(occurrences[0]!.startsAt.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(occurrences[1]!.endsAt?.toISOString()).toBe("2026-11-06T03:30:00.000Z");
    expect(occurrences[2]!.endsAt).toBeNull();
  });

  it("lets a cancel win over an override on the same night", () => {
    const occurrences = materialize(
      {
        ...series,
        exceptions: [
          { nightDate: "2026-11-05", action: "override", override: { venueId: "venue-2" } },
          { nightDate: "2026-11-05", action: "cancel" },
        ],
      },
      "2026-10-25",
      14,
    );
    expect(nights(occurrences)).toEqual(["2026-10-29"]);
  });

  it("adds a night from an override with a start that the rule does not produce (imported RDATE)", () => {
    const extra = new Date("2026-11-01T01:00:00.000Z"); // Saturday 2026-10-31, 9pm EDT
    const occurrences = materialize(
      {
        ...series,
        exceptions: [
          { nightDate: "2026-10-31", action: "override", override: { startsAt: extra } },
        ],
      },
      "2026-10-25",
      14,
    );
    expect(nights(occurrences)).toEqual(["2026-10-29", "2026-10-31", "2026-11-05"]);
    expect(occurrences[1]!.overridden).toBe(true);
    expect(occurrences[1]!.endsAt?.toISOString()).toBe("2026-11-01T05:00:00.000Z");
  });

  it("ignores exceptions outside the window and overrides with nothing to add", () => {
    const occurrences = materialize(
      {
        ...series,
        exceptions: [
          { nightDate: "2026-12-24", action: "cancel" },
          { nightDate: "2026-10-27", action: "override", override: { venueId: "venue-9" } },
        ],
      },
      "2026-10-25",
      14,
    );
    expect(nights(occurrences)).toEqual(["2026-10-29", "2026-11-05"]);
  });

  it("puts a 1am Saturday start on Friday's night date", () => {
    const rule = parseRule("FREQ=WEEKLY;BYDAY=SA", "2026-10-03T01:00", NY);
    const occurrences = materialize({ rrule: rule.rruleString, tz: NY }, "2026-10-01", 14);
    expect(nights(occurrences)).toEqual(["2026-10-02", "2026-10-09"]);
    expect(localClock(occurrences[0]!.startsAt, NY)).toBe("Sat 01:00");
  });

  it("includes a night whose 1am start falls just after the window's last calendar date", () => {
    // Window of 7 nights from Fri 2026-10-02: Friday 2026-10-09 is the last night, and its 1am
    // Saturday set on 2026-10-10 belongs to it.
    const rule = parseRule("FREQ=WEEKLY;BYDAY=SA", "2026-10-03T01:00", NY);
    expect(nights(materialize({ rrule: rule.rruleString, tz: NY }, "2026-10-03", 7))).toEqual([
      "2026-10-09",
    ]);
    expect(nights(materialize({ rrule: rule.rruleString, tz: NY }, "2026-10-03", 6))).toEqual([]);
  });

  it("yields the right count for 14 days: two of a weekly rule, fourteen of a daily one", () => {
    expect(materialize(series, "2026-10-25")).toHaveLength(2);
    expect(MATERIALIZE_DAYS).toBe(14);
    const daily = parseRule("FREQ=DAILY", "2026-10-01T21:00", NY);
    const occurrences = materialize({ rrule: daily.rruleString, tz: NY }, "2026-10-25", 14);
    expect(occurrences).toHaveLength(14);
    expect(occurrences[0]!.nightDate).toBe("2026-10-25");
    expect(occurrences[13]!.nightDate).toBe("2026-11-07");
    // A weekly rule with the window starting on its own weekday gets both ends.
    expect(nights(materialize(series, "2026-10-29", 14))).toEqual(["2026-10-29", "2026-11-05"]);
    expect(nights(materialize(series, "2026-10-30", 14))).toEqual(["2026-11-05", "2026-11-12"]);
  });

  it("materializes a monthly rule by set position", () => {
    const rule = parseRule("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2,4", "2026-10-10T22:00", NY);
    const occurrences = materialize({ rrule: rule.rruleString, tz: NY }, "2026-10-01", 61);
    expect(nights(occurrences)).toEqual(["2026-10-10", "2026-10-24", "2026-11-14", "2026-11-28"]);
    expect(occurrences.map((o) => localClock(o.startsAt, NY))).toEqual(Array(4).fill("Sat 22:00"));
    const last = parseRule("FREQ=MONTHLY;BYDAY=-1FR", "2026-10-30T21:00", NY);
    expect(nights(materialize({ rrule: last.rruleString, tz: NY }, "2026-10-01", 61))).toEqual([
      "2026-10-30",
      "2026-11-27",
    ]);
  });

  it("stops at COUNT and UNTIL, and starts at DTSTART", () => {
    const counted = parseRule("FREQ=WEEKLY;BYDAY=TH;COUNT=2", "2026-10-01T20:00", NY);
    expect(nights(materialize({ rrule: counted.rruleString, tz: NY }, "2026-09-28", 30))).toEqual([
      "2026-10-01",
      "2026-10-08",
    ]);
    const until = parseRule("FREQ=WEEKLY;BYDAY=TH;UNTIL=20261009T000000Z", "2026-10-01T20:00", NY);
    expect(nights(materialize({ rrule: until.rruleString, tz: NY }, "2026-09-28", 30))).toEqual([
      "2026-10-01",
      "2026-10-08",
    ]);
  });

  it("accepts a caller-supplied night-date function", () => {
    const calendar = (t: Date, zone: string) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(t);
    const rule = parseRule("FREQ=WEEKLY;BYDAY=SA", "2026-10-03T01:00", NY);
    const occurrences = materialize({ rrule: rule.rruleString, tz: NY }, "2026-10-01", 14, NY, {
      nightDate: calendar,
    });
    expect(nights(occurrences)).toEqual(["2026-10-03", "2026-10-10"]);
  });

  it("validates its boundary", () => {
    expect(() => materialize(series, "2026-13-01")).toThrow(RecurrenceError);
    expect(() => materialize(series, "2026-10-25", 0)).toThrow(RecurrenceError);
    expect(() => materialize(series, "2026-10-25", 14, "Nowhere/Town")).toThrow(RecurrenceError);
    expect(() => materialize({ rrule: "RRULE:FREQ=WEEKLY", tz: NY }, "2026-10-25")).toThrow(
      RecurrenceError,
    );
    expect(() =>
      materialize(
        {
          ...series,
          exceptions: [{ nightDate: "2026-11-05", action: "override", override: { venueId: "" } }],
        },
        "2026-10-25",
      ),
    ).toThrow(RecurrenceError);
  });
});

describe("importExdates", () => {
  const rule = parseRule("FREQ=WEEKLY;BYDAY=TH", "2026-10-01T20:00", NY);

  it("turns EXDATE values with TZID into cancel rows keyed by night date", () => {
    expect(
      importExdates("EXDATE;TZID=America/New_York:20261105T200000,20261112T200000", rule),
    ).toEqual([
      { nightDate: "2026-11-05", action: "cancel" },
      { nightDate: "2026-11-12", action: "cancel" },
    ]);
  });

  it("reads DATE values with the rule's start time, UTC values, and floating values in the rule's zone", () => {
    const rows = importExdates(
      ["EXDATE;VALUE=DATE:20261119", "EXDATE:20261127T010000Z", "EXDATE:20261203T200000"],
      rule,
    );
    expect(rows).toEqual([
      { nightDate: "2026-11-19", action: "cancel" },
      { nightDate: "2026-11-26", action: "cancel" },
      { nightDate: "2026-12-03", action: "cancel" },
    ]);
  });

  it("puts a DATE exception for a 1am series on the night before", () => {
    const late = parseRule("FREQ=WEEKLY;BYDAY=SA", "2026-10-03T01:00", NY);
    expect(importExdates("EXDATE;VALUE=DATE:20261010", late)).toEqual([
      { nightDate: "2026-10-09", action: "cancel" },
    ]);
  });

  it("keys an EXDATE in the spring-forward morning by the wall-clock night date", () => {
    const sunday630 = parseRule("FREQ=WEEKLY;BYDAY=SU", "2026-02-22T06:30", NY);
    expect(importExdates("EXDATE;TZID=America/New_York:20260308T063000", sunday630)).toEqual([
      { nightDate: "2026-03-08", action: "cancel" },
    ]);
  });

  it("turns RDATE into an override that carries the start", () => {
    const rows = importExdates("RDATE;TZID=America/New_York:20261107T210000", rule);
    expect(rows).toEqual([
      {
        nightDate: "2026-11-07",
        action: "override",
        override: { startsAt: new Date("2026-11-08T02:00:00.000Z") },
      },
    ]);
    const occurrences = materialize(
      { rrule: rule.rruleString, tz: NY, exceptions: rows },
      "2026-11-01",
      14,
    );
    expect(nights(occurrences)).toEqual(["2026-11-05", "2026-11-07", "2026-11-12"]);
  });

  it("feeds cancels straight into materialize", () => {
    const rows = importExdates("EXDATE;TZID=America/New_York:20261105T200000", rule);
    const occurrences = materialize(
      { rrule: rule.rruleString, tz: NY, exceptions: rows },
      "2026-10-25",
      14,
    );
    expect(nights(occurrences)).toEqual(["2026-10-29"]);
  });

  it("dedupes repeated values, skips blank lines and lower-cases nothing it should not", () => {
    const rows = importExdates(
      "\nexdate;tzid=America/New_York:20261105T200000\nEXDATE;TZID=America/New_York:20261105T200000\n",
      rule,
    );
    expect(rows).toEqual([{ nightDate: "2026-11-05", action: "cancel" }]);
  });

  it("throws on lines and values it cannot read rather than dropping them", () => {
    expect(() => importExdates("DTSTART;TZID=America/New_York:20261105T200000", rule)).toThrow(
      RecurrenceError,
    );
    expect(() => importExdates("EXDATE:next thursday", rule)).toThrow(RecurrenceError);
    expect(() => importExdates("RDATE;VALUE=PERIOD:20261105T200000Z/PT4H", rule)).toThrow(
      RecurrenceError,
    );
    expect(() => importExdates("EXDATE;TZID=Mars/Olympus:20261105T200000", rule)).toThrow(
      RecurrenceError,
    );
  });
});

describe("recurrenceText", () => {
  const text = (rrule: string, locale: string, start = "2026-10-01T20:00") =>
    recurrenceText(parseRule(rrule, start, NY), locale);

  it("describes weekly rules", () => {
    expect(text("FREQ=WEEKLY;BYDAY=TH", "en")).toBe("Every Thursday");
    expect(text("FREQ=WEEKLY;BYDAY=TH", "fr")).toBe("Tous les jeudis");
    expect(text("FREQ=WEEKLY;BYDAY=TU,TH", "en")).toBe("Every Tuesday and Thursday");
    expect(text("FREQ=WEEKLY;BYDAY=MO,WE,FR", "en")).toBe("Every Monday, Wednesday and Friday");
    expect(text("FREQ=WEEKLY;BYDAY=MO,WE,FR", "fr")).toBe(
      "Tous les lundis, mercredis et vendredis",
    );
    // No BYDAY: the weekday comes from DTSTART (2026-10-01 is a Thursday).
    expect(text("FREQ=WEEKLY", "en")).toBe("Every Thursday");
    expect(text("FREQ=WEEKLY", "fr-FR")).toBe("Tous les jeudis");
  });

  it("describes weekdays, every-other and every-N-weeks", () => {
    expect(text("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "en")).toBe("Every weekday");
    expect(text("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "fr")).toBe("Du lundi au vendredi");
    expect(text("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", "en")).toBe("Every weekday");
    expect(text("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU", "en")).toBe("Every other Sunday");
    expect(text("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU", "fr")).toBe("Un dimanche sur deux");
    expect(text("FREQ=WEEKLY;INTERVAL=3;BYDAY=TU", "en")).toBe("Every 3 weeks on Tuesday");
    expect(text("FREQ=WEEKLY;INTERVAL=3;BYDAY=TU", "fr")).toBe("Toutes les 3 semaines, le mardi");
  });

  it("describes monthly rules by set position or ordinal BYDAY", () => {
    expect(text("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2,4", "en")).toBe("Every 2nd and 4th Saturday");
    expect(text("FREQ=MONTHLY;BYDAY=2SA,4SA", "en")).toBe("Every 2nd and 4th Saturday");
    expect(text("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2,4", "fr")).toBe("Les 2e et 4e samedis du mois");
    expect(text("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1", "en")).toBe("Every 1st Saturday");
    expect(text("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1", "fr")).toBe("Le 1er samedi du mois");
    expect(text("FREQ=MONTHLY;BYDAY=3SA", "en")).toBe("Every 3rd Saturday");
    expect(text("FREQ=MONTHLY;BYDAY=-1FR", "en")).toBe("Last Friday of the month");
    expect(text("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1", "fr")).toBe("Le dernier vendredi du mois");
    expect(text("FREQ=MONTHLY;BYDAY=1SA,-1SA", "en")).toBe("Every 1st and last Saturday");
    expect(text("FREQ=MONTHLY", "en")).toBe("Monthly");
    expect(text("FREQ=MONTHLY", "fr")).toBe("Tous les mois");
    expect(text("FREQ=MONTHLY;BYMONTHDAY=15", "en")).toBe("Monthly");
    expect(text("FREQ=MONTHLY;INTERVAL=2;BYDAY=1SA", "en")).toBe("Every 2 months");
  });

  it("describes daily and yearly rules and falls back to English for other locales", () => {
    expect(text("FREQ=DAILY", "en")).toBe("Every day");
    expect(text("FREQ=DAILY", "fr")).toBe("Tous les jours");
    expect(text("FREQ=YEARLY", "en")).toBe("Yearly");
    expect(text("FREQ=YEARLY", "fr")).toBe("Tous les ans");
    expect(text("FREQ=WEEKLY;BYDAY=TH", "de")).toBe("Every Thursday");
    expect(text("FREQ=WEEKLY;BYDAY=TH", "en-US")).toBe("Every Thursday");
  });

  it("returns null for sub-daily rules and accepts the stored string form", () => {
    expect(text("FREQ=HOURLY", "en")).toBeNull();
    expect(
      recurrenceText("DTSTART;TZID=Europe/Paris:20261001T210000\nRRULE:FREQ=WEEKLY;BYDAY=TH", "fr"),
    ).toBe("Tous les jeudis");
  });
});

describe("parseRecurrenceText", () => {
  it("reads a list with a comma before its last item, and a 5th that may not come (Stepping Out)", () => {
    // Jimmy Anton Salsa Social, run 27: "Every 1st, 3rd, and 5th Sunday (if there is one) of the
    // month" read as extra words, and the listing was dropped rather than listed on its Sundays.
    expect(
      parseRecurrenceText("Every 1st, 3rd, and 5th Sunday (if there is one) of the month", "en"),
    ).toBe("FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1,3,5");
    expect(parseRecurrenceText("Tuesdays, Thursdays, and Saturdays", "en")).toBe(
      "FREQ=WEEKLY;BYDAY=TU,TH,SA",
    );
    // Only that aside is dropped: any other may hedge the schedule, which is not ours to guess.
    expect(
      parseRecurrenceText("Every 1st, 3rd, and 5th Sunday (except holidays) of the month", "en"),
    ).toBeNull();
  });

  it("parses the deterministic English phrases", () => {
    expect(parseRecurrenceText("every Thursday", "en")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("Thursdays", "en")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("weekly on Fridays", "en")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("1st and 3rd Saturdays", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1,3",
    );
    expect(parseRecurrenceText("second Saturday of the month", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2",
    );
    expect(parseRecurrenceText("last Friday", "en")).toBe("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1");
    expect(parseRecurrenceText("every other Sunday", "en")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU");
    expect(parseRecurrenceText("Every 2nd & 4th Saturday", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2,4",
    );
    expect(parseRecurrenceText("every weekday", "en")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("Monday to Friday", "en")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("Mondays, Wednesdays and Fridays", "en")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,WE,FR",
    );
    expect(parseRecurrenceText("Every Tuesday and Thursday night", "en")).toBe(
      "FREQ=WEEKLY;BYDAY=TU,TH",
    );
    expect(parseRecurrenceText("fortnightly on Fridays", "en")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    );
    expect(parseRecurrenceText("every 3 weeks on Tuesday", "en")).toBe(
      "FREQ=WEEKLY;INTERVAL=3;BYDAY=TU",
    );
    expect(parseRecurrenceText("every first Saturday", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1",
    );
    expect(parseRecurrenceText("every 2nd Saturday of the month", "en")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2",
    );
    expect(parseRecurrenceText("monthly", "en")).toBe("FREQ=MONTHLY");
    expect(parseRecurrenceText("daily", "en")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("  Every  Thursday. ", "en")).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("parses French, Spanish and German phrases", () => {
    expect(parseRecurrenceText("tous les mardis", "fr")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("chaque jeudi", "fr")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("un jeudi sur deux", "fr")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH");
    expect(parseRecurrenceText("le dernier vendredi du mois", "fr")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1",
    );
    expect(parseRecurrenceText("les 1er et 3e samedis du mois", "fr")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1,3",
    );
    expect(parseRecurrenceText("en semaine", "fr")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("todos los viernes", "es")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("cada dos jueves", "es")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TH");
    expect(parseRecurrenceText("el último viernes del mes", "es")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1",
    );
    expect(parseRecurrenceText("primer sábado de cada mes", "es")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1",
    );
    expect(parseRecurrenceText("jeden Freitag", "de")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("freitags", "de")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("jeden 1. und 3. Samstag im Monat", "de")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1,3",
    );
    expect(parseRecurrenceText("am letzten Freitag im Monat", "de")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1",
    );
    expect(parseRecurrenceText("alle zwei Wochen freitags", "de")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
    );
    expect(parseRecurrenceText("wöchentlich", "de")).toBe("FREQ=WEEKLY");
  });

  it("tries every language when none is given and rejects unsupported ones", () => {
    expect(parseRecurrenceText("every Thursday")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("tous les mardis")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("jeden Freitag")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("every Thursday", "it")).toBeNull();
    expect(parseRecurrenceText("every Thursday", "en-GB")).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("returns null for hedged or ambiguous phrases", () => {
    expect(parseRecurrenceText("most weeks", "en")).toBeNull();
    expect(parseRecurrenceText("usually Fridays", "en")).toBeNull();
    expect(parseRecurrenceText("Fridays (most weeks)", "en")).toBeNull();
    expect(parseRecurrenceText("every Friday except holidays", "en")).toBeNull();
    expect(parseRecurrenceText("biweekly", "en")).toBeNull();
    expect(parseRecurrenceText("every second Saturday", "en")).toBeNull();
    expect(parseRecurrenceText("cada segundo sábado", "es")).toBeNull();
    expect(parseRecurrenceText("jeden zweiten Sonntag", "de")).toBeNull();
    expect(parseRecurrenceText("twice a month", "en")).toBeNull();
    expect(parseRecurrenceText("every weekend", "en")).toBeNull();
  });

  it("never turns a date or a one-off day into a rule", () => {
    expect(parseRecurrenceText("Thursday", "en")).toBeNull();
    expect(parseRecurrenceText("Thursday 12 March", "en")).toBeNull();
    expect(parseRecurrenceText("12/03/2026", "en")).toBeNull();
    expect(parseRecurrenceText("every Thursday at 8pm", "en")).toBeNull();
    expect(parseRecurrenceText("le jeudi 12 mars", "fr")).toBeNull();
    expect(parseRecurrenceText("", "en")).toBeNull();
    expect(parseRecurrenceText("   ", "en")).toBeNull();
    expect(parseRecurrenceText("every Thursday ".repeat(20), "en")).toBeNull();
  });

  it("round-trips through parseRule and recurrenceText", () => {
    const body = parseRecurrenceText("1st and 3rd Saturdays", "en");
    expect(body).not.toBeNull();
    const rule = parseRule(body!, "2026-10-03T21:00", NY);
    expect(recurrenceText(rule, "en")).toBe("Every 1st and 3rd Saturday");
    expect(nights(materialize({ rrule: rule.rruleString, tz: NY }, "2026-10-01", 31))).toEqual([
      "2026-10-03",
      "2026-10-17",
    ]);
  });
});
