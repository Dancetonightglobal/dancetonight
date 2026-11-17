import { describe, expect, it } from "vitest";
import { storedRowRejectReason } from "@/src/pipeline/ingest";

describe("storedRowRejectReason", () => {
  const tz = "America/Chicago";
  const night = "2026-11-02";
  const sourceFlags = {
    mixedCalendar: true,
    styles: [] as readonly string[],
  };

  it("keeps a row this run listed, though the source's flags would screen it (WWOZ's Maple Leaf)", () => {
    const row = {
      id: "e1",
      title: "George Porter Jr. Trio ft. Chris Adkins",
      styles: [],
      startsAt: new Date("2026-11-03T01:00:00Z"),
      nightDate: night,
      tz,
    };
    const result = storedRowRejectReason(row, {
      outside: [],
      listed: new Set(["e1"]),
      metroName: "New Orleans",
      flags: sourceFlags,
    });
    expect(result).toBeNull();
  });

  it("still screens a stale row the run did not list, by the source's flags", () => {
    const row = {
      id: "e2",
      title: "George Porter Jr. Trio ft. Chris Adkins",
      styles: [],
      startsAt: new Date("2026-11-03T01:00:00Z"),
      nightDate: night,
      tz,
    };
    const result = storedRowRejectReason(row, {
      outside: [],
      listed: new Set(["e1"]), // e2 is not listed
      metroName: "New Orleans",
      flags: sourceFlags,
    });
    expect(result).not.toBeNull();
    // screenStoredRow returns a string for this title under mixedCalendar with no bandsForDancers
    // (it's a band on a mixed calendar, not a dance night)
    expect(typeof result).toBe("string");
  });

  it("takes a listed row out when a read left it out as outside the metro", () => {
    const row = {
      id: "e1",
      title: "George Porter Jr. Trio ft. Chris Adkins",
      styles: [],
      startsAt: new Date("2026-11-03T01:00:00Z"),
      nightDate: night,
      tz,
    };
    const result = storedRowRejectReason(row, {
      outside: [{ title: "George Porter Jr. Trio ft. Chris Adkins", night }],
      listed: new Set(["e1"]),
      metroName: "New Orleans",
      flags: sourceFlags,
    });
    expect(result).toBe("not in New Orleans");
  });

  it("keeps a stale row the source's flags keep", () => {
    const row = {
      id: "e3",
      title: "Salsa Night",
      styles: ["salsa"],
      startsAt: new Date("2026-11-03T02:00:00Z"),
      nightDate: night,
      tz,
    };
    const result = storedRowRejectReason(row, {
      outside: [],
      listed: new Set(),
      metroName: "New Orleans",
      flags: sourceFlags,
    });
    expect(result).toBeNull();
  });
});
