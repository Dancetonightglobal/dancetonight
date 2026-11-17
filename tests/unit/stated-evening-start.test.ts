import { describe, expect, it } from "vitest";

import { buildListing } from "@/src/adapters/structured";
import { statedEveningStart } from "@/src/domain/stated-evening-start";

// D-867: a structured morning start its own description contradicts with a stated evening
// opening is a placeholder, not the night's time (London incognitodance "Tuesdays at FULHAM
// SALSA & BACHATA CLUB": iCal DTSTART 09:00-10:00, DESCRIPTION "Open 7:00pm ... till 10pm",
// daily site check 2026-11-11).

const FULHAM =
  "Tuesdays at FULHAM SALSA & BACHATA CLUB\nOpen 7:00pm, 3 levels BACHATA at 7:20-8:20, then 3  levels SALSA at 8:30- 9:30pm, then FREE social dancing till 10pm, join us for a great night.\nFulham Salsa & Bachata Club, St. Dionis Church, 18A Parsons Green, FULHAM SW6 4UH";

describe("statedEveningStart (D-867)", () => {
  it("takes the description's stated evening opening over a morning start", () => {
    const got = statedEveningStart("09:00", FULHAM);
    expect(got?.time).toBe("19:00");
    expect(got?.quote).toContain("Open 7:00pm");
  });

  it("reads doors / starts / from phrases and 24-hour clocks", () => {
    expect(statedEveningStart("10:00", "Doors open 20:30, social till late")?.time).toBe("20:30");
    expect(statedEveningStart("08:00", "Doors 9pm. Bachata and kizomba.")?.time).toBe("21:00");
    expect(statedEveningStart("11:00", "Party starts at 10.30 p.m. sharp")?.time).toBe("22:30");
    expect(statedEveningStart("09:30", "Salsa night from 8pm until late")?.time).toBe("20:00");
  });

  it("leaves an evening, after-midnight or noon start alone", () => {
    expect(statedEveningStart("19:00", FULHAM)).toBeNull();
    expect(statedEveningStart("00:30", FULHAM)).toBeNull();
    expect(statedEveningStart("04:00", FULHAM)).toBeNull();
    expect(statedEveningStart("12:00", FULHAM)).toBeNull();
  });

  it("needs a time and a description", () => {
    expect(statedEveningStart(null, FULHAM)).toBeNull();
    expect(statedEveningStart("09:00", null)).toBeNull();
    expect(statedEveningStart("09:00", "")).toBeNull();
  });

  it("needs an opening word and an explicit evening clock", () => {
    // No opening word: a class time alone is not the night's opening.
    expect(statedEveningStart("09:00", "Bachata class at 7pm for improvers")).toBeNull();
    // Bare clocks with no marker are ambiguous.
    expect(statedEveningStart("09:00", "Open 7:00, dancing till 10")).toBeNull();
    // A pm clock before 5pm is a daytime event.
    expect(statedEveningStart("10:00", "Doors open 2pm, family tea dance")).toBeNull();
  });

  it("keeps the start when the description writes a morning time or the start itself", () => {
    expect(statedEveningStart("09:00", "Open 9:00am for brunch, dancing from 7pm")).toBeNull();
    expect(statedEveningStart("10:00", "Morning yoga 10 a.m., open 7pm for salsa")).toBeNull();
    expect(statedEveningStart("09:00", "Workshop 09:00-12:00, then doors open 8pm")).toBeNull();
    expect(statedEveningStart("09:00", "Market 9.00 to noon; party from 9pm")).toBeNull();
  });
});

describe("buildListing with a contradicted morning start (D-867)", () => {
  const base = {
    externalId: "fulham-1117",
    title: "🌺 Tuesdays at FULHAM SALSA & BACHATA CLUB",
    venue: { name: null, address: null, url: null, location: null },
    organizer: { name: null, url: null },
    prices: null,
    ticketUrl: null,
    cancelled: false,
    evidence: { start: "DTSTART 2026-11-17 09:00", end_time: "DTEND 10:00" },
  };
  const options = {
    sourceUrl: "https://www.incognitodance.com/",
    fetchedAt: new Date("2026-11-11T07:51:29Z"),
    method: "feed" as const,
    currency: "GBP",
  };
  const at = (time: string) => ({
    night: "2026-11-17",
    day: "2026-11-17",
    time,
    zone: "Europe/London",
    absolute: false,
  });

  it("starts at the stated opening, drops the placeholder end, and quotes the words", () => {
    const built = buildListing(
      { ...base, start: at("09:00"), end: at("10:00"), description: FULHAM },
      options,
    );
    const l = built.listing;
    const times = [l.doors_time, l.lesson_time, l.dancing_time];
    expect(times).toContain("19:00");
    expect(times).not.toContain("09:00");
    expect(l.end_time).toBeNull();
    expect(l.evidence.start).toContain("Open 7:00pm");
  });

  it("keeps a start the words do not contradict", () => {
    const built = buildListing(
      {
        ...base,
        start: at("09:00"),
        end: at("10:00"),
        description: "Morning dance fitness class, all welcome",
      },
      options,
    );
    const l = built.listing;
    expect([l.doors_time, l.lesson_time, l.dancing_time]).toContain("09:00");
    expect(l.end_time).toBe("10:00");
  });

  it("keeps an end after the stated opening", () => {
    const built = buildListing(
      { ...base, start: at("09:00"), end: at("23:00"), description: FULHAM },
      options,
    );
    expect(built.listing.end_time).toBe("23:00");
  });

  it("leaves a recurring rule's start alone (its nights take the rule's DTSTART)", () => {
    const built = buildListing(
      {
        ...base,
        start: at("09:00"),
        end: at("10:00"),
        description: FULHAM,
        recurrence: {
          rrule: "FREQ=WEEKLY;BYDAY=TU",
          dtstartLocal: "2026-11-17T09:00",
          exdates: [],
        },
      },
      options,
    );
    expect([
      built.listing.doors_time,
      built.listing.lesson_time,
      built.listing.dancing_time,
    ]).toContain("09:00");
  });
});
