// D-886 (daily check 2026-11-16, London): Skiddle gave club nights a morning door time (a promoter's 12-hour
// slip) beside RA's and DICE's 9pm/10pm copies, so the copies never paired.
import { describe, expect, it } from "vitest";

import { clubNightMorningSlip } from "@/src/adapters/apis/skiddle";

describe("clubNightMorningSlip", () => {
  it("reads a club night's 9am doors with no close as 9pm (NQ JPN, Free Entry Until 3am)", () => {
    expect(
      clubNightMorningSlip("CLUB", "NQ JPN: House & Techno - Free Entry Until 3am", "09:00", null),
    ).toBe("21:00");
  });

  it("reads 10am doors closing at 5am as 10pm (Max Styler, 26 Leake Street)", () => {
    expect(
      clubNightMorningSlip("CLUB", "Max Styler - 26 Leake Street, London", "10:00", "05:00"),
    ).toBe("22:00");
  });

  it("keeps seconds when Skiddle sends them", () => {
    expect(clubNightMorningSlip("LGB", "Queer Rave", "11:30:00", null)).toBe("23:30:00");
  });

  it("keeps a day event that closes the same day", () => {
    expect(clubNightMorningSlip("CLUB", "Warehouse Session", "11:00", "18:00")).toBe("11:00");
  });

  it("keeps a club event whose title says it is by day", () => {
    expect(clubNightMorningSlip("CLUB", "Coffee Rave: Morning Disco", "08:00", null)).toBe("08:00");
    expect(clubNightMorningSlip("CLUB", "Sunday Day Party", "11:00", null)).toBe("11:00");
    expect(clubNightMorningSlip("CLUB", "Fabric Afterhours", "06:00", null)).toBe("06:00");
    expect(clubNightMorningSlip("CLUB", "Sunday After Party", "07:00", null)).toBe("07:00");
  });

  it("leaves other kinds of events and other hours alone", () => {
    expect(clubNightMorningSlip("LIVE", "Band at the Pub", "09:00", null)).toBe("09:00");
    expect(clubNightMorningSlip("CLUB", "Late Club", "23:00", "04:00")).toBe("23:00");
    expect(clubNightMorningSlip("CLUB", "Afterhours", "05:00", "11:00")).toBe("05:00");
    expect(clubNightMorningSlip("CLUB", "No time", null, null)).toBeNull();
  });
});
