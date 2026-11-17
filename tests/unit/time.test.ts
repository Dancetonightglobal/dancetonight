import { describe, expect, it } from "vitest";

import {
  HOUR_MS,
  addCalendarDays,
  calendarDaysBetween,
  formatCalendarDate,
  formatDurationShort,
  formatTime,
  formatTimeRange,
  isValidZone,
  isoDateSchema,
  localDateOf,
  localInstant,
  toIsoDate,
  zoneSchema,
} from "@/src/domain/time";
import { t } from "@/src/i18n";
import { describeInProcessZones } from "./processZone";

const NY = "America/New_York";
const KOL = "Asia/Kolkata";
const utc = (iso: string) => new Date(iso);

describe("isoDateSchema", () => {
  it("accepts real ISO calendar dates only", () => {
    expect(isoDateSchema.parse("2026-09-21")).toBe("2026-09-21");
    expect(isoDateSchema.parse("2028-02-29")).toBe("2028-02-29"); // leap day
    expect(isoDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-13-01").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-9-1").success).toBe(false);
    expect(isoDateSchema.safeParse("2026-09-21T00:00:00Z").success).toBe(false);
  });
});

describe("zoneSchema and isValidZone", () => {
  it("accepts IANA zones and rejects made-up ones", () => {
    expect(zoneSchema.parse("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(isValidZone("America/Phoenix")).toBe(true);
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(zoneSchema.safeParse("").success).toBe(false);
    expect(zoneSchema.safeParse("Mars/Olympus").success).toBe(false);
  });
});

describe("calendar arithmetic", () => {
  it("toIsoDate zero-pads", () => {
    expect(toIsoDate(2026, 3, 7)).toBe("2026-03-07");
  });

  it("addCalendarDays crosses month and year ends and leap days", () => {
    expect(addCalendarDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addCalendarDays("2026-09-21", 0)).toBe("2026-09-21");
  });

  it("calendarDaysBetween is signed", () => {
    expect(calendarDaysBetween("2026-09-21", "2026-09-27")).toBe(6);
    expect(calendarDaysBetween("2026-09-27", "2026-09-21")).toBe(-6);
    expect(calendarDaysBetween("2026-03-07", "2026-03-09")).toBe(2);
  });
});

describeInProcessZones("localDateOf and localInstant", () => {
  it("localDateOf is the calendar date in the zone", () => {
    const t = utc("2026-09-22T02:30:00Z");
    expect(localDateOf(t, NY)).toBe("2026-09-21"); // 22:30 EDT
    expect(localDateOf(t, KOL)).toBe("2026-09-22"); // 08:00 IST
    expect(localDateOf(t, "UTC")).toBe("2026-09-22");
    expect(localDateOf(t.getTime(), NY)).toBe("2026-09-21");
  });

  it("localInstant maps a wall-clock time to the right instant", () => {
    expect(localInstant("2026-09-21", NY, 6).toISOString()).toBe("2026-09-21T10:00:00.000Z");
    expect(localInstant("2026-09-21", KOL, 6, 30).toISOString()).toBe("2026-09-21T01:00:00.000Z");
    expect(localInstant("2026-09-21", NY).toISOString()).toBe("2026-09-21T04:00:00.000Z");
    expect(localInstant("2026-09-21", NY, 23, 59, 59, 999).toISOString()).toBe(
      "2026-09-22T03:59:59.999Z",
    );
  });

  it("resolves a spring-forward gap forward and a fall-back repeat to its first occurrence", () => {
    expect(localInstant("2026-03-08", NY, 2, 30).toISOString()).toBe("2026-03-08T07:30:00.000Z"); // 03:30 EDT
    expect(localInstant("2026-11-01", NY, 1, 30).toISOString()).toBe("2026-11-01T05:30:00.000Z"); // EDT
  });

  it("returns a plain Date, not a zoned subclass", () => {
    expect(localInstant("2026-09-21", NY, 6).constructor).toBe(Date);
  });
});

describeInProcessZones("formatTime", () => {
  const t = utc("2026-09-21T23:42:00Z"); // 19:42 EDT

  it("en-US: 12-hour, lowercase, no space", () => {
    expect(formatTime(t, NY)).toBe("7:42pm");
    expect(formatTime(t, NY, "en-US")).toBe("7:42pm");
  });

  it("en-US drops :00 on the hour", () => {
    expect(formatTime(utc("2026-09-22T05:00:00Z"), NY)).toBe("1am");
    expect(formatTime(utc("2026-09-22T04:30:00Z"), NY)).toBe("12:30am");
    expect(formatTime(utc("2026-09-22T04:00:00Z"), NY)).toBe("12am");
    expect(formatTime(utc("2026-09-21T16:00:00Z"), NY)).toBe("12pm");
  });

  it("en-GB and fr-FR: 24-hour with a two-digit hour", () => {
    expect(formatTime(t, NY, "en-GB")).toBe("19:42");
    expect(formatTime(t, NY, "fr-FR")).toBe("19:42");
    expect(formatTime(utc("2026-09-22T05:00:00Z"), NY, "fr-FR")).toBe("01:00");
    expect(formatTime(utc("2026-09-22T04:00:00Z"), NY, "en-GB")).toBe("00:00");
  });

  it("uses the event's zone, whatever the process zone", () => {
    expect(formatTime(t, KOL)).toBe("5:12am"); // 05:12 IST next day
    expect(formatTime(t, "Australia/Sydney", "en-GB")).toBe("09:42");
    expect(formatTime(t, "UTC")).toBe("11:42pm");
  });

  it("always uses Latin figures: fa-IR, ne-NP and my-MM never mix their digits with the pad", () => {
    expect(formatTime(utc("2026-09-22T05:00:00Z"), NY, "fa-IR")).toBe("01:00");
    expect(formatTime(t, NY, "fa-IR")).toBe("19:42");
    expect(formatTime(utc("2026-09-22T05:00:00Z"), NY, "ne-NP")).toBe("01:00");
    expect(formatTime(utc("2026-09-22T05:00:00Z"), NY, "my-MM")).toBe("01:00");
    for (const locale of ["en-US", "en-GB", "fr-FR", "de-DE", "ja-JP", "fa-IR", "zh-TW", "el-GR"]) {
      expect(formatTime(t, NY, locale), locale).toMatch(/^[\x20-\x7E\u0370-\u03FF\u4E00-\u9FFF]+$/);
    }
  });

  it("never carries a narrow or no-break space into the copy", () => {
    for (const locale of ["en-US", "en-GB", "fr-FR", "de-DE", "ja-JP", "zh-TW", "el-GR", "am-ET"]) {
      const text = formatTime(t, NY, locale);
      expect(text, locale).not.toMatch(/\u202F/);
      expect(text, locale).not.toMatch(/\u00A0/);
    }
  });

  it("compacts only a Latin am/pm marker; other 12-hour locales keep Intl's own form", () => {
    // zh-TW writes the period first: "下午7:42", never "7:42下午".
    const zh = formatTime(t, NY, "zh-TW");
    expect(zh).toContain("下午");
    expect(zh).toContain("7:42");
    expect(zh.endsWith("下午")).toBe(false);
    // el-GR keeps its dotted "μ.μ." with a plain space, not a glued "μμ".
    const el = formatTime(t, NY, "el-GR");
    expect(el).toBe("7:42 μ.μ.");
    // The unchanged locales.
    expect(formatTime(t, NY, "en-US")).toBe("7:42pm");
    expect(formatTime(t, NY, "en-GB")).toBe("19:42");
    expect(formatTime(t, NY, "fr-FR")).toBe("19:42");
    expect(formatTime(t, NY, "de-DE")).toBe("19:42");
    expect(formatTime(t, NY, "ja-JP")).toBe("19:42");
  });
});

describeInProcessZones("formatTimeRange", () => {
  const start = utc("2026-09-22T01:30:00Z");
  const end = utc("2026-09-22T05:00:00Z");

  it("joins start and end with 'to'", () => {
    expect(formatTimeRange(start, end, NY)).toBe("9:30pm to 1am");
    expect(formatTimeRange(start, end, NY, "fr-FR")).toBe("21:30 to 01:00");
  });

  it("says the end is not listed instead of inventing one", () => {
    expect(formatTimeRange(start, null, NY)).toBe("9:30pm, end not listed");
  });

  it("composes its copy from detail.when in en.ts", () => {
    expect(formatTimeRange(start, end, NY)).toBe(
      t("detail.when.range", { from: "9:30pm", to: "1am" }),
    );
    expect(formatTimeRange(start, null, NY)).toBe(
      t("detail.when.rangeEndNotListed", { from: "9:30pm" }),
    );
  });
});

describe("formatCalendarDate", () => {
  it("is US order by default: weekday, month, day, as Intl writes en-US (D-072)", () => {
    expect(formatCalendarDate("2026-09-23")).toBe("Wed, Sep 23");
    expect(formatCalendarDate("2026-09-29", "en-US")).toBe("Tue, Sep 29");
  });

  it("keeps another locale's own order and words", () => {
    expect(formatCalendarDate("2026-03-08", "en-GB")).toBe("Sun 8 Mar");
    expect(formatCalendarDate("2026-09-23", "fr-FR")).toBe("mer. 23 sept.");
    expect(formatCalendarDate("2026-09-23", "de-DE")).toBe("Mi., 23. Sept.");
  });

  it("is a calendar date, unaffected by zones", () => {
    expect(formatCalendarDate("2026-12-31")).toBe("Thu, Dec 31");
    expect(formatCalendarDate("2027-01-01")).toBe("Fri, Jan 1");
  });
});

describe("formatDurationShort", () => {
  it("minutes under an hour, then h and m", () => {
    expect(formatDurationShort(40 * 60_000)).toBe("40 min");
    expect(formatDurationShort(59 * 60_000)).toBe("59 min");
    expect(formatDurationShort(60 * 60_000)).toBe("1h");
    expect(formatDurationShort(2 * HOUR_MS + 18 * 60_000)).toBe("2h 18m");
    expect(formatDurationShort(7 * HOUR_MS)).toBe("7h");
  });

  it("rounds up to the next minute and never goes below 0", () => {
    expect(formatDurationShort(39 * 60_000 + 1)).toBe("40 min");
    expect(formatDurationShort(1)).toBe("1 min");
    expect(formatDurationShort(0)).toBe("0 min");
    expect(formatDurationShort(-5000)).toBe("0 min");
  });
});
