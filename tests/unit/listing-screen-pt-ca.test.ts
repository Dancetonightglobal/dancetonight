import { describe, expect, it } from "vitest";
import { screenTitle, isNotAnEvent } from "@/src/domain/listing-screen";

describe("Portuguese and Catalan words for boats, crawls, cancellations, games, kids, karaoke, haunted (D-233)", () => {
  describe("screenTitle", () => {
    it("screens Portuguese and Catalan boat parties", () => {
      for (const title of [
        "Passeio de Barco na Baía de Guanabara",
        "Lisbon Boat Party: Amazing sunset sailing tour",
        "Creuer al capvespre en catamarà",
        "Golondrinas: nit al port",
      ]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("boat_or_cruise");
      }
    });

    it("keeps Iate Clube (club, not boat)", () => {
      expect(screenTitle("Baile no Iate Clube")).toBeNull();
    });

    it("screens Portuguese and Catalan crawl phrases", () => {
      for (const title of ["Roteiro de bares na Lapa", "Ruta de bars pel Born"]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("crawl_bus_or_happy_hour");
      }
    });

    it("screens Catalan happy hour phrase", () => {
      // "hora felic" (from "hora feliç") should be screened unless dance words present.
      // This test uses a title without dance words.
      expect(screenTitle("Hora felic al bar")).not.toBeNull();
      expect(screenTitle("Hora felic al bar")?.kind).toBe("crawl_bus_or_happy_hour");
    });

    it("screens Portuguese and Catalan cancellations", () => {
      for (const title of [
        "CANCELADO",
        "ANULADO",
        "Adiado",
        "Ajornat",
        "CANCEL·LAT",
        "Anul·lada",
        "Aplazado",
      ]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("closure");
      }
    });

    it("keeps cancellations that also name a dance (mirroring English rule)", () => {
      // The English test keeps "CANCELLED - Salsa Night". We mirror that behavior.
      // The existing rule: cancellation-only screens only when every token is a cancellation word or connector.
      // "CANCELADO - Baile da Gafieira" contains "baile" which is not a cancellation word nor connector,
      // so it should be kept (null).
      expect(screenTitle("CANCELADO - Baile da Gafieira")).toBeNull();
    });

    it("screens Portuguese and Catalan games nights", () => {
      for (const title of [
        "Noite de Quiz CULTURA POP em Botafogo",
        "Bingo do Noel",
        "Sing Out Bingo Lisboa",
        "Torneig d'escacs",
      ]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("not_dance_scope");
      }
    });

    it("keeps Domino Park events (place, not game)", () => {
      expect(screenTitle("Salsa Night at Domino Park")).toBeNull();
      expect(screenTitle("Bingo Night at Domino Park")).not.toBeNull(); // bingo is a game word, but "domino park" is a place; the rule excludes "domino" when followed by "park", but "bingo" is still a game word, so it screens.
    });

    it("screens Portuguese and Catalan children's parties", () => {
      for (const title of ["Festa Infantil de Halloween", "Festa Infantil para Miúdos"]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("not_dance_scope");
      }
    });

    it("screens kids' classes (D-571)", () => {
      expect(screenTitle("Clase de salsa para niños")?.kind).toBe("not_dance_scope");
    });

    it("screens Portuguese and Catalan karaoke", () => {
      for (const title of ["DRAGOKÊ - Karaokê na Lapa (Quinta-feira)", "Noite de Videokê"]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("not_dance_scope");
      }
    });

    it("screens Portuguese and Catalan haunted houses", () => {
      for (const title of ["Casa Assombrada Tijuca"]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("not_dance_scope");
      }
    });

    it("keeps haunted parties with dance words", () => {
      for (const title of [
        "HALLOWEEN HORROR PARTY - Rumbon Latin Party",
        "Sábado Rumbero ft. Jamboree",
        'POSTPONED "A la Vida y al Amor", Alexandra Marie',
      ]) {
        expect(screenTitle(title), title).toBeNull();
      }
    });
  });

  describe("isNotAnEvent", () => {
    it("returns true for screened titles", () => {
      expect(isNotAnEvent("CANCELADO")).toBe(true);
      expect(isNotAnEvent("Roteiro de bares na Lapa")).toBe(true);
      expect(isNotAnEvent("Festa Infantil de Halloween")).toBe(true);
    });

    it("returns false for kept titles", () => {
      expect(isNotAnEvent("Gafieira Rio Antigo")).toBe(false);
      expect(isNotAnEvent("Forróçacana")).toBe(false);
      expect(isNotAnEvent("Quinta Bandida")).toBe(false);
      expect(isNotAnEvent("Ball dels divendres")).toBe(false);
      expect(isNotAnEvent("Matinal de swing")).toBe(false);
      expect(isNotAnEvent("Arraial de Santo António")).toBe(false);
      expect(isNotAnEvent("Matiné Dançante no Ateneu")).toBe(false);
      expect(isNotAnEvent("TUKINA LISBOA 4th EDITION - 11 to 14 DEC 2026")).toBe(false);
    });
  });
});
