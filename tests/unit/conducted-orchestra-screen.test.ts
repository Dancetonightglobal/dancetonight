import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { matchStyles } from "@/config/styles";

// D-861 (daily check 2026-11-11, Buenos Aires): cc25.org lists "La Milonga del CC25" and seated concerts
// on one calendar. An orchestra billed with its conductor is a concert, even when its name says tango;
// a milonga, baile or dance word in the title keeps it.
const TZ = "America/Argentina/Buenos_Aires";
const NIGHT = "2026-11-13";
const listing = (title: string) => ({
  title,
  styles: matchStyles(title).styles as string[],
  startsAt: new Date("2026-11-13T20:00:00Z"), // 5pm local
  nightDate: NIGHT,
  tz: TZ,
});
const mixed = { mixedCalendar: true, styles: [] as string[] };
const forDancers = { mixedCalendar: true, bandsForDancers: true, styles: [] as string[] };

describe("D-861 a conducted orchestra's concert", () => {
  it.each([
    "OTBA ORQUESTA DEL TANGO DE BUENOS AIRES / DGMUS DIRECCIÓN: NÉSTOR MARCONI",
    "Orquesta Sinfónica Nacional - Dirección musical: Ana López",
    "Tango Orchestra, conductor Pablo Mainetti",
    "Dirección: Juan Pérez - Orquesta Escuela de Tango",
  ])("screens %s", (title) => {
    // Screened (an English "orchestra" billing may be caught first by the band-billing rule).
    expect(screenNoDance(listing(title), mixed)).not.toBeNull();
  });

  it.each([
    "Milonga con Orquesta Típica, dirección: Juan Pérez",
    "Baile con la Orquesta del Tango, dirección Néstor Marconi",
    "Orquesta Típica Misteriosa Buenos Aires en vivo",
    "Swing Remix with the George Gee Orchestra",
  ])("keeps %s from this rule", (title) => {
    const result = screenNoDance(listing(title), mixed);
    expect(result?.reason ?? "").not.toContain("D-861");
  });

  it("leaves a venue whose bands play for dancers alone", () => {
    const result = screenNoDance(
      listing("OTBA ORQUESTA DEL TANGO DE BUENOS AIRES / DIRECCIÓN: NÉSTOR MARCONI"),
      forDancers,
    );
    expect(result?.reason ?? "").not.toContain("D-861");
  });
});
