import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";

const listing = (title: string) => ({
  title,
  styles: ["bachata"],
  startsAt: new Date("2026-11-04T22:00:00Z"),
  nightDate: "2026-11-04",
  tz: "America/Argentina/Buenos_Aires",
});

describe("screenNoDance with notDanceNights", () => {
  const notDanceNights = ["Instructorado de Bachata Femme"];

  it("leaves out a listed title on a mixed calendar", () => {
    const out = screenNoDance(listing("INSTRUCTORADO DE BACHATA FEMME"), {
      mixedCalendar: true,
      notDanceNights,
    });
    expect(out?.kind).toBe("not_dance_scope");
  });

  it("leaves out a listed title on a calendar that is not mixed", () => {
    const out = screenNoDance(listing("Instructorado de Bachata Femme!"), {
      mixedCalendar: false,
      notDanceNights,
    });
    expect(out?.kind).toBe("not_dance_scope");
  });

  it("keeps other titles, including longer ones that contain a listed title", () => {
    expect(
      screenNoDance(listing("Bachata + Salsa"), { mixedCalendar: true, notDanceNights }),
    ).toBeNull();
    expect(
      screenNoDance(listing("Instructorado de Bachata Femme: social de cierre"), {
        mixedCalendar: false,
        notDanceNights,
      }),
    ).toBeNull();
  });

  it("does nothing without the list", () => {
    expect(
      screenNoDance(listing("Instructorado de Bachata Femme"), { mixedCalendar: false }),
    ).toBeNull();
  });
});
