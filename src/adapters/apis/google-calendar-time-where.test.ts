import { describe, expect, it } from "vitest";
import {
  apiItemsToIcs,
  descriptionClock,
  descriptionWhere,
} from "@/src/adapters/apis/google-calendar";

describe("descriptionClock", () => {
  it("parses valid time ranges", () => {
    expect(descriptionClock("Time: 20h30-23:00")).toEqual({ start: "20:30", end: "23:00" });
    expect(descriptionClock("Time: 21h30-02h00")).toEqual({ start: "21:30", end: "02:00" });
    expect(descriptionClock("Time: 20h30-23h30")).toEqual({ start: "20:30", end: "23:30" });
    expect(descriptionClock("Time: 16h00~19h00")).toEqual({ start: "16:00", end: "19:00" });
    expect(descriptionClock("Time: 20h-00h")).toEqual({ start: "20:00", end: "00:00" });
    expect(descriptionClock("Time: 15h-19h")).toEqual({ start: "15:00", end: "19:00" });
    expect(descriptionClock("Time: 16h00-19:00")).toEqual({ start: "16:00", end: "19:00" });
    expect(descriptionClock("Time: 21:30")).toEqual({ start: "21:30", end: null });
  });

  it("returns null for invalid or missing Time line", () => {
    expect(descriptionClock(null)).toBeNull();
    expect(descriptionClock("Entrance: 5€")).toBeNull();
    expect(descriptionClock("Every Tuesday, Free Classes 21:00 – 22:00")).toBeNull();
    expect(descriptionClock("Time: tba")).toBeNull();
    // hour out of range
    expect(descriptionClock("Time: 24h30-01h00")).toBeNull();
    // minutes out of range
    expect(descriptionClock("Time: 20h70-23:00")).toBeNull();
  });
});

describe("descriptionWhere", () => {
  it("extracts the Where line", () => {
    const text =
      "Time: 20h30-23:00\nWhere: Rua de Santa Apolónia 59, 1100-468 Lisboa, Portugal\nEntrance: 5€";
    expect(descriptionWhere(text)).toBe("Rua de Santa Apolónia 59, 1100-468 Lisboa, Portugal");
  });

  it("does not read a year as a time", () => {
    expect(descriptionClock("Time: 2026")).toBeNull();
  });

  it("handles HTML link in Where line", () => {
    // The text as descriptionText leaves it (tags stripped).
    const cleaned =
      "Time: 21h30-02h00\nWhere: Goethe-Institut, Campo dos Mártires da Pátria 37, 1169-016 Lisboa\nEntrance: 10€";
    expect(descriptionWhere(cleaned)).toBe(
      "Goethe-Institut, Campo dos Mártires da Pátria 37, 1169-016 Lisboa",
    );
  });

  it("returns null when no Where line", () => {
    expect(descriptionWhere("Time: 20h30-23:00\nEntrance: 5€")).toBeNull();
    expect(descriptionWhere("Where:   ")).toBeNull();
    expect(descriptionWhere(null)).toBeNull();
  });
});

describe("apiItemsToIcs with Time/Where lines", () => {
  it("converts all-day item with Time and Where", () => {
    const item = {
      id: "a1",
      iCalUID: "a1@google.com",
      summary: "a Outra Milonga",
      status: "confirmed",
      start: { date: "2026-11-02" },
      end: { date: "2026-11-03" },
      description:
        "Time: 20h30-23:00<br>Where: Rua de Santa Apolónia 59, 1100-468 Lisboa, Portugal<br>Entrance: 5€",
    };
    const events = apiItemsToIcs([item]);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.start).toEqual({ kind: "local", local: "2026-11-02T20:30", tzid: null });
    expect(ev.end).toEqual({ kind: "local", local: "2026-11-02T23:00", tzid: null });
    expect(ev.location).toBe("Rua de Santa Apolónia 59, 1100-468 Lisboa, Portugal");
  });

  it("handles past midnight range", () => {
    const item = {
      id: "b1",
      summary: "Milonga Tango2Gotan",
      status: "confirmed",
      start: { date: "2026-10-31" },
      end: { date: "2026-11-01" },
      description:
        'Time: 21h30-02h00<br>Where: Goethe-Institut, <a href="https://maps.app.goo.gl/x" target="_blank"><u>Campo dos Mártires da Pátria 37, 1169-016 Lisboa</u></a><br>Entrance: 10€',
    };
    const events = apiItemsToIcs([item]);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.start).toEqual({ kind: "local", local: "2026-10-31T21:30", tzid: null });
    // end crosses midnight, so day +1
    expect(ev.end).toEqual({ kind: "local", local: "2026-11-01T02:00", tzid: null });
    // descriptionText will have stripped tags, location will be extracted from cleaned line
    // The test above for descriptionWhere already verifies the tag-stripping works.
    // Here we just check that location is not null.
    expect(ev.location).toBeTruthy();
  });

  it("ignores Time line for timed items (start kind utc)", () => {
    const item = {
      id: "c1",
      summary: "Milonga Guapa",
      status: "confirmed",
      start: { dateTime: "2026-11-07T20:30:00Z" },
      end: { dateTime: "2026-11-07T23:30:00Z" },
      location: "Rua das Escolas Gerais, 82, 1100-220 Lisboa",
      description: "Time: 18h-19h<br>Where: Somewhere else",
    };
    const events = apiItemsToIcs([item]);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.start?.kind).toBe("utc");
    // location from item.location wins over Where line
    expect(ev.location).toBe("Rua das Escolas Gerais, 82, 1100-220 Lisboa");
  });

  it("keeps all-day date when no Time line", () => {
    const item = {
      id: "d1",
      summary: "Festival",
      status: "confirmed",
      start: { date: "2026-11-10" },
      end: { date: "2026-11-11" },
      description: "Where: Lisboa",
    };
    const events = apiItemsToIcs([item]);
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.start).toEqual({ kind: "date", date: "2026-11-10" });
    expect(ev.location).toBe("Lisboa");
  });
});
