import { describe, expect, it } from "vitest";
import { cancelledByTitle } from "@/src/domain/title-notices";

// D-835 (daily 2026-11-10, Barcelona): the organiser's "we cancel" anywhere in the title.
describe("cancelledByTitle, first-person cancellation (D-835)", () => {
  it.each([
    "MICROOBERT SINESTESIA Cancelamos el microabierto del día 11/11",
    "Suspendemos la clase de salsa de hoy",
    "Bal folk: nous annulons la soirée",
    "Cancel·lem el ball d'avui",
    "Adiamos o baile de sábado",
  ])("%s is cancelled", (title) => {
    expect(cancelledByTitle(title)).toBe(true);
  });

  it.each([
    "Cancelamos",
    "Salsa Social",
    "Cancelación Flamenco Show",
    "Bachata Night (we cancel nothing)",
  ])("%s is not", (title) => {
    expect(cancelledByTitle(title)).toBe(false);
  });
});
