import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// All-city audit 11-04 (D-589): non-dance kinds from ticketing feeds, in the cities' languages.
describe("screenTitle D-589 kinds in other languages and new kinds", () => {
  it.each([
    "Saints Home Game Watch Party",
    "UM Watch Party ft. DJ Breezy",
    "Traitors Viewing Party",
    "Ver el partido: Barça - Madrid",
    "Haseeb Iqbal presents: Jah Shaka Listening Session",
    "PIEN presents: Clothing swap & listening party",
    "Sesión de escucha: Rosalía",
    "Sessão de escuta - novo disco",
    "Noche electoral en el bar",
    "Girl Code November Book Club",
    "Club de lectura de noviembre",
    "THE 2026 NEW YORK BALTIC FILM FESTIVAL",
    "7SIFF – Festival de cine",
    "Marsm x Barbican Senior Community Cinema: Persepolis",
    "LATE NIGHT LAUGHS! A Midnight Comedy Show After Burlesque",
    "Death To All of Them Comedy Presents: QIA+/?",
    "Abierto",
    "Aberto",
  ])("screens %s", (title) => {
    expect(screenTitle(title)?.reason).toContain("D-589");
  });

  it.each([
    "Comedy Night & Dance Party",
    "Salsa Watch Party & Social",
    "Bachata Book Club Social",
    "Some Like It Swing – Vintage Swing Dance Night at Genesis Cinema, London",
    "Open House/Club Night | Caller: Betsy Gotta",
    "Yu Yu Cine Club: MUTEK presenta SUPER SPECIAL GUEST",
    "OPEN DECKS",
    "Festival de Tango de Lisboa",
    "Baile Abierto",
  ])("does not screen %s with D-589", (title) => {
    expect(screenTitle(title)?.reason ?? "").not.toContain("D-589");
  });
});
