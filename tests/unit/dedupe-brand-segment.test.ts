import { describe, expect, it } from "vitest";

import {
  scorePair,
  sharedBrandSegment,
  type DedupeSide,
  type PairFacts,
} from "@/src/domain/dedupe";

// D-741: two sources' listings at one venue and one start, one title a party's name on its own between separators,
// the other naming that party. Lisbon, Casa Capitao, Saturday 2026-11-07 23:59 (cities-3, 2026-11-05): dice.fm
// "BAILE | EMBRASA: DJ SAZE + DJ Lorrany + Rafa Militao + bieu" and ma.to "Ultimo Embrasa do Ano" were two cards;
// the pair was left to the model, which was unsure.

const at = (hhmm: string) => new Date(`2026-11-07T${hhmm}:00Z`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("23:59"),
  organizerId: null,
  organizerName: null,
  venueId: "v-capitao",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "ticketing",
  firstSeenAt: new Date("2026-10-29T00:00:00Z"),
  listingType: "social",
  endsAt: null,
  venueName: "Casa Capitão",
  ...over,
});

const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.12,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

const DICE = "BAILE | EMBRASA: DJ SAZE + DJ Lorrany + Rafa Militão + bieu";
const MATO = "Ultimo Embrasa do Ano";

describe("sharedBrandSegment", () => {
  it("a one-word segment of one title that the other names", () => {
    expect(sharedBrandSegment(DICE, MATO, "Casa Capitão")).toBe(true);
    expect(sharedBrandSegment(MATO, DICE, "Casa Capitão")).toBe(true);
  });

  it("not a generic word, even in Portuguese or Spanish", () => {
    expect(sharedBrandSegment("BAILE | Noite Quente", "Grande Baile de Sabado", undefined)).toBe(
      false,
    );
    expect(sharedBrandSegment("FIESTA | Calor", "La Fiesta Latina", undefined)).toBe(false);
    expect(sharedBrandSegment("SALSA | Calor", "Noche de Salsa", undefined)).toBe(false);
  });

  it("not the venue's own name", () => {
    expect(sharedBrandSegment("CAPITAO | Noite", "Sexta no Capitao", "Casa Capitão")).toBe(false);
  });

  it("not a short word, and not a word inside a longer segment", () => {
    expect(sharedBrandSegment("FUNK | Noite", "Funk na Casa", undefined)).toBe(false);
    expect(sharedBrandSegment("Embrasa Clube Night | x", "Ultimo Embrasa do Ano", undefined)).toBe(
      false,
    );
  });
});

describe("scorePair with a shared brand segment (D-741)", () => {
  it("merges two sources' listings at one venue and start", () => {
    const dice = side({ id: "d", title: DICE });
    const mato = side({ id: "m", title: MATO, trust: "directory" });
    expect(scorePair(dice, mato, facts()).decision).toBe("auto_merge");
  });

  it("not one source's two listings", () => {
    const a = side({ id: "d", title: DICE });
    const b = side({ id: "m", title: MATO });
    expect(scorePair(a, b, facts({ sameSource: true })).decision).not.toBe("auto_merge");
  });

  it("not at different starts", () => {
    const a = side({ id: "d", title: DICE });
    const b = side({ id: "m", title: MATO, startsAt: at("20:00") });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("not at another venue", () => {
    const a = side({ id: "d", title: DICE });
    const b = side({ id: "m", title: MATO, venueId: "v-other", venueName: "Lux Frágil" });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("not classes", () => {
    const a = side({ id: "d", title: "AULA | EMBRASA", listingType: "class" });
    const b = side({ id: "m", title: "Embrasa Kizomba Class", listingType: "class" });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("not a cancelled listing", () => {
    const a = side({ id: "d", title: DICE });
    const b = side({ id: "m", title: MATO, cancelled: true });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("not on a French word for dance, night or party (D-1042)", () => {
    for (const [one, two] of [
      ["DANSE | Club Night: DJ Foo", "Cours de danse ouverte"],
      ["NUITS | Afro Party: DJ Bar", "Les nuits du samedi"],
      ["FETES | Latino: DJ Baz", "Les fetes de fin d'annee"],
    ]) {
      const a = side({ id: "d", title: one });
      const b = side({ id: "m", title: two, trust: "directory" });
      expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
    }
  });
});
