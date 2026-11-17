import { describe, expect, it } from "vitest";
import { readBlockTimes } from "@/src/domain/stated-times";

// Ocaña's live-music grid (ocana.cat/live-music, read 41045905409, 2026-10-30) writes its hours as
// "21 h" and "22:30 h": a 24-hour hour with a spaced "h". The check dropped every "21 h" start as
// not written, so the 9pm concerts were kept untimed instead of screened.
const values = (text: string) => readBlockTimes(text, "es").map((m) => m.value);

describe('a spaced "h" after a 24-hour hour (Spanish and Catalan pages)', () => {
  it('reads "21 h" as 21:00', () => {
    expect(values("MARTES · LA CLAVE Latin Jazz & Salsa · 21 h · Apotheke")).toEqual(["21:00"]);
  });

  it('reads "22:30 h" as 22:30, as before', () => {
    expect(values("VIERNES · NOCHES DE SOUL & FUNK Soul, Funk & Groove · 22:30 h · Club")).toEqual([
      "22:30",
    ]);
  });

  it('reads "0 h" and "23 h" as 24-hour times', () => {
    expect(values("Obrim a les 23 h")).toEqual(["23:00"]);
    expect(values("Fins a les 0 h")).toEqual(["00:00"]);
  });

  it('does not read a duration or a count before "h" as a time', () => {
    expect(values("Taller de 2 h amb la Maria")).toEqual([]);
    expect(values("Durada: 3 h. Preu 10 €")).toEqual([]);
  });

  it('reads both ends of "de 21 h a 3 h"', () => {
    expect(values("Festa de 21 h a 3 h")).toEqual(["21:00", "03:00"]);
  });

  it('leaves "1 h" and "2 h de clase" without minutes unread', () => {
    expect(values("2 h de clase de salsa")).toEqual([]);
    expect(values("Sessió d'1 h")).toEqual([]);
  });

  it("does not take a number followed by a word starting with h as a time", () => {
    expect(values("21 habitacions i 3 horaris")).toEqual([]);
  });
});
