// D-518 (the owner, 2026-10-31 "A and B"): the home page in the early hours (local 00:00-05:59).
// (a) Once nothing from last night is still on, the page opens the coming night (today's calendar
//     date) by default and calls it "Tonight".
// (b) In the early hours the labels follow the calendar: the coming night is "Tonight", the night
//     after it "Tomorrow", and last night (still openable while things are on) is "Last night".
// The night boundary itself (NIGHT_BOUNDARY_HOUR, nightDate, currentNightDate) does not move.

import { describe, expect, it, vi } from "vitest";

import type { ListNightQuery, ListNightResult, ListingsRepository } from "@/src/data/repository";
import {
  currentNightDate,
  dayPicker,
  formatDayLabel,
  homeDefaultNight,
  isEarlyHours,
  labelFlags,
  labelledTonight,
} from "@/src/domain/tonight";
import { t } from "@/src/i18n";
import { resolveHomeQuery } from "@/src/ui/home/home-query";
import { parseHomeParams } from "@/src/ui/home/params";
import { describeInProcessZones } from "./processZone";

const NY = "America/New_York";
const KOL = "Asia/Kolkata";
const utc = (iso: string) => new Date(iso);

const SAT_0400 = utc("2026-10-31T08:00:00Z"); // Sat 04:00 EDT: Friday night's window
const SAT_0200 = utc("2026-10-31T06:00:00Z"); // Sat 02:00 EDT
const SAT_0700 = utc("2026-10-31T11:00:00Z"); // Sat 07:00 EDT: Saturday night
const SUN_0400_EST = utc("2026-11-01T09:00:00Z"); // Sun 04:00 EST, the fall-back night
const KOL_1330 = utc("2026-10-31T08:00:00Z"); // Sat 13:30 IST

describeInProcessZones("D-518 early hours: the night boundary does not move", () => {
  it("currentNightDate is still last night before 06:00", () => {
    expect(currentNightDate(SAT_0400, NY)).toBe("2026-10-30");
    expect(currentNightDate(SAT_0700, NY)).toBe("2026-10-31");
  });
});

describeInProcessZones("D-518 isEarlyHours and labelledTonight", () => {
  it("is early hours from local 00:00 to 05:59 only", () => {
    expect(isEarlyHours(SAT_0400, NY)).toBe(true);
    expect(isEarlyHours(SAT_0200, NY)).toBe(true);
    expect(isEarlyHours(utc("2026-10-31T04:00:00Z"), NY)).toBe(true); // 00:00 EDT
    expect(isEarlyHours(utc("2026-10-31T09:59:00Z"), NY)).toBe(true); // 05:59 EDT
    expect(isEarlyHours(utc("2026-10-31T10:00:00Z"), NY)).toBe(false); // 06:00 EDT
    expect(isEarlyHours(SAT_0700, NY)).toBe(false);
    expect(isEarlyHours(utc("2026-10-31T03:30:00Z"), NY)).toBe(false); // Fri 23:30 EDT
    expect(isEarlyHours(KOL_1330, KOL)).toBe(false);
  });

  it("the night called Tonight is the local calendar date", () => {
    expect(labelledTonight(SAT_0400, NY)).toBe("2026-10-31");
    expect(labelledTonight(SAT_0700, NY)).toBe("2026-10-31");
    expect(labelledTonight(utc("2026-10-31T03:30:00Z"), NY)).toBe("2026-10-30"); // Fri 23:30
    expect(labelledTonight(SUN_0400_EST, NY)).toBe("2026-11-01");
    expect(labelledTonight(KOL_1330, KOL)).toBe("2026-10-31");
  });
});

describeInProcessZones("D-518 (b) labels follow the calendar in the early hours", () => {
  it("at 04:00 Sat: Friday is Last night, Saturday Tonight, Sunday Tomorrow", () => {
    expect(formatDayLabel("2026-10-30", SAT_0400, NY)).toBe("Last night");
    expect(formatDayLabel("2026-10-31", SAT_0400, NY)).toBe("Tonight");
    expect(formatDayLabel("2026-11-01", SAT_0400, NY)).toBe("Tomorrow");
    expect(formatDayLabel("2026-11-02", SAT_0400, NY)).toBe("Mon, Nov 2");
  });

  it("at 07:00 the labels are unchanged: Saturday Tonight, Sunday Tomorrow", () => {
    expect(formatDayLabel("2026-10-31", SAT_0700, NY)).toBe("Tonight");
    expect(formatDayLabel("2026-11-01", SAT_0700, NY)).toBe("Tomorrow");
    expect(formatDayLabel("2026-11-02", SAT_0700, NY)).toBe("Mon, Nov 2");
  });

  it("the day picker keeps its nights and relabels them", () => {
    const days = dayPicker(SAT_0400, NY);
    expect(days.map((d) => d.nightDate)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect(days[0]).toEqual({ nightDate: "2026-10-30", label: "Last night" });
    expect(days[1]).toEqual({ nightDate: "2026-10-31", label: "Tonight" });
    expect(days[2]).toEqual({ nightDate: "2026-11-01", label: "Tomorrow" });
    expect(days[3]).toEqual({ nightDate: "2026-11-02", label: "Mon, Nov 2" });
    // The picker's length still follows the night in progress (Friday: 7 nights).
    expect(days).toHaveLength(7);
  });

  it("on the fall-back night, at 04:00 EST", () => {
    expect(formatDayLabel("2026-10-31", SUN_0400_EST, NY)).toBe("Last night");
    expect(formatDayLabel("2026-11-01", SUN_0400_EST, NY)).toBe("Tonight");
    expect(formatDayLabel("2026-11-02", SUN_0400_EST, NY)).toBe("Tomorrow");
  });

  it("Kolkata in the afternoon is unaffected", () => {
    expect(formatDayLabel("2026-10-31", KOL_1330, KOL)).toBe("Tonight");
    expect(formatDayLabel("2026-11-01", KOL_1330, KOL)).toBe("Tomorrow");
    expect(dayPicker(KOL_1330, KOL)[0]).toEqual({ nightDate: "2026-10-31", label: "Tonight" });
  });

  it("other locales localise dates but keep the copy", () => {
    const labels = dayPicker(SAT_0400, NY, "fr-FR").map((d) => d.label);
    expect(labels.slice(0, 3)).toEqual(["Last night", "Tonight", "Tomorrow"]);
  });

  it("Last night is UI copy in en.ts", () => {
    expect(t("home.day.lastNight")).toBe("Last night");
  });

  it("labelFlags names the headline's night by the labels, not the night in progress", () => {
    expect(labelFlags("2026-10-30", SAT_0400, NY)).toEqual({ isTonight: false, isTomorrow: false });
    expect(labelFlags("2026-10-31", SAT_0400, NY)).toEqual({ isTonight: true, isTomorrow: false });
    expect(labelFlags("2026-11-01", SAT_0400, NY)).toEqual({ isTonight: false, isTomorrow: true });
    expect(labelFlags("2026-10-31", SAT_0700, NY)).toEqual({ isTonight: true, isTomorrow: false });
    expect(labelFlags("2026-11-01", SAT_0700, NY)).toEqual({ isTonight: false, isTomorrow: true });
  });
});

describeInProcessZones("D-518 (a) homeDefaultNight", () => {
  it("at 04:00 with nothing from last night on now, opens the coming night", () => {
    expect(homeDefaultNight(SAT_0400, NY, 0)).toBe("2026-10-31");
  });

  it("at 02:00 with 3 still on, stays on last night", () => {
    expect(homeDefaultNight(SAT_0200, NY, 3)).toBe("2026-10-30");
  });

  it("after 06:00 it is the night in progress whatever the count", () => {
    expect(homeDefaultNight(SAT_0700, NY, 0)).toBe("2026-10-31");
    expect(homeDefaultNight(SAT_0700, NY, 4)).toBe("2026-10-31");
    expect(homeDefaultNight(KOL_1330, KOL, 0)).toBe("2026-10-31");
  });

  it("on the fall-back night", () => {
    expect(homeDefaultNight(SUN_0400_EST, NY, 0)).toBe("2026-11-01");
    expect(homeDefaultNight(SUN_0400_EST, NY, 1)).toBe("2026-10-31");
  });
});

describeInProcessZones("D-518 parseHomeParams with a default night", () => {
  it("opens the default night when no day is asked for", () => {
    const q = parseHomeParams({}, SAT_0400, NY, undefined, "2026-10-31");
    expect(q.nightDate).toBe("2026-10-31");
    // isTonight keeps its meaning: the night in progress, the only night with a now.
    expect(q.isTonight).toBe(false);
    expect(q.unopenedDay).toBeNull();
  });

  it("without a default night it behaves as before", () => {
    const q = parseHomeParams({}, SAT_0400, NY);
    expect(q.nightDate).toBe("2026-10-30");
    expect(q.isTonight).toBe(true);
  });

  it("an explicit openable day wins over the default", () => {
    const q = parseHomeParams({ day: "2026-10-30" }, SAT_0400, NY, undefined, "2026-10-31");
    expect(q.nightDate).toBe("2026-10-30");
    expect(q.isTonight).toBe(true);
    const r = parseHomeParams({ day: "2026-11-03" }, SAT_0400, NY, undefined, "2026-10-31");
    expect(r.nightDate).toBe("2026-11-03");
  });

  it("an unopenable day opens the default night and still says why", () => {
    const q = parseHomeParams({ day: "nope" }, SAT_0400, NY, undefined, "2026-10-31");
    expect(q.nightDate).toBe("2026-10-31");
    expect(q.unopenedDay).toEqual({ reason: "not_a_date" });
    const over = parseHomeParams({ day: "2026-10-29" }, SAT_0400, NY, undefined, "2026-10-31");
    expect(over.nightDate).toBe("2026-10-31");
    expect(over.unopenedDay).toEqual({ reason: "over", date: "2026-10-29" });
  });

  it("On now is dropped on a night that is not in progress", () => {
    const q = parseHomeParams({ now: "1" }, SAT_0400, NY, undefined, "2026-10-31");
    expect(q.filters.onNow).toBeUndefined();
  });
});

function fakeRepository(onNow: number) {
  const listNight = vi.fn<(query: ListNightQuery) => Promise<ListNightResult>>(
    async () =>
      ({
        listings: Array.from({ length: onNow }, (_, i) => ({ slug: `on-${i}` })),
        counts: { night: onNow },
      }) as unknown as ListNightResult,
  );
  return {
    repository: { listNight } as unknown as Pick<ListingsRepository, "listNight">,
    listNight,
  };
}

describe("D-518 resolveHomeQuery", () => {
  it("at 04:00 with nothing on now, opens the coming night", async () => {
    const { repository, listNight } = fakeRepository(0);
    const q = await resolveHomeQuery({}, SAT_0400, NY, 25, repository);
    expect(q.nightDate).toBe("2026-10-31");
    expect(listNight).toHaveBeenCalledTimes(1);
    const asked = listNight.mock.calls[0]![0];
    expect(asked.nightDate).toBe("2026-10-30");
    expect(asked.filters).toEqual({ onNow: true });
    expect(asked.now).toBe(SAT_0400);
    expect(asked.radiusKm).toBe(25);
  });

  it("at 02:00 with listings on now, stays on last night", async () => {
    const { repository } = fakeRepository(3);
    const q = await resolveHomeQuery({}, SAT_0200, NY, 25, repository);
    expect(q.nightDate).toBe("2026-10-30");
    expect(q.isTonight).toBe(true);
  });

  it("after 06:00 it asks nothing and opens the night in progress", async () => {
    const { repository, listNight } = fakeRepository(0);
    const q = await resolveHomeQuery({}, SAT_0700, NY, 25, repository);
    expect(q.nightDate).toBe("2026-10-31");
    expect(listNight).not.toHaveBeenCalled();
  });

  it("an explicit openable day asks nothing and opens that day", async () => {
    const { repository, listNight } = fakeRepository(0);
    const q = await resolveHomeQuery({ day: "2026-10-30" }, SAT_0400, NY, 25, repository);
    expect(q.nightDate).toBe("2026-10-30");
    expect(listNight).not.toHaveBeenCalled();
  });

  it("an unopenable day in the early hours still gets the coming night and its notice", async () => {
    const { repository } = fakeRepository(0);
    const q = await resolveHomeQuery({ day: "nope" }, SAT_0400, NY, 25, repository);
    expect(q.nightDate).toBe("2026-10-31");
    expect(q.unopenedDay).toEqual({ reason: "not_a_date" });
  });

  it("uses the metro's radius when one is given and the URL's centre", async () => {
    const { repository, listNight } = fakeRepository(0);
    await resolveHomeQuery({ lat: "35.78", lng: "-78.64", r: "10" }, SAT_0400, NY, 40, repository);
    const asked = listNight.mock.calls[0]![0];
    expect(asked.center).toEqual({ lat: 35.78, lng: -78.64 });
    expect(asked.radiusKm).toBe(10);
  });
});
