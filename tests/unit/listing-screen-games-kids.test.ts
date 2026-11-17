// D-199: games nights and children's parties are screened out (owner, 2026-10-28).
import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

describe("screenTitle games nights and children's parties (owner 2026-10-28)", () => {
  it("screens games nights", () => {
    for (const title of [
      "Board Game Social",
      "Arcade Nights Every Thursday @ NQ64 Soho",
      "Arcade Nights Every Thursday @ NQ64 Shoreditch",
      "Bingo Loco",
      "Pub Quiz & Disco",
      "Boardgames Night",
      "Games Night",
      "BIG FAT QUIZBOX", // Boxpark Wembley, 2026-10-29
      "Pub-Quiz Night",
    ]) {
      expect(screenTitle(title), title).toEqual({
        kind: "not_dance_scope",
        reason: "a games night (the owner lists none, 2026-10-28)",
      });
    }
  });

  it("screens children's parties", () => {
    for (const title of [
      "Kids Halloween Dress up Party",
      "Kid's Disco",
      "Children's Halloween Party",
      "Family Rave", // "family" with no dance style
      "Family Disco Party",
      "Raver Tots Halloween Party Wembley", // Boxpark Wembley, 2026-10-29
    ]) {
      expect(screenTitle(title), title).toEqual({
        kind: "not_dance_scope",
        reason: "a children's party (the owner lists none, 2026-10-28)",
      });
    }
  });

  it("keeps titles that are not games nights or children's parties", () => {
    for (const title of [
      "Salsa Social",
      "Brooklyn Social",
      "Halloween Party",
      "Kizomba Party",
      "Disco Night",
      "Family Swing Dance", // has style swing, so "family" doesn't count as kid word
      "Swing Family Halloween Party", // has style swing
      "Salsa Family Party", // has style salsa
      "Game On: Bachata Night", // "game" alone is not a game word
      "Trivial Pursuit", // "trivial" is not "trivia"
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("screens children's workshops", () => {
    for (const title of [
      "Oficina de dança criativa",
      "Dança para os Pequeninos",
      "Kids Salsa Workshop",
      "Taller infantil de baile",
    ]) {
      expect(screenTitle(title), title).toEqual({
        kind: "not_dance_scope",
        reason: "a children's workshop (the owner lists none, 2026-10-29)",
      });
    }
  });

  it("keeps titles that are not children's workshops", () => {
    for (const title of [
      "Salsa Workshop with Ana",
      "Oficina de Kizomba",
      "Family Swing Dance",
      "Bachata Sensual Workshop",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });
});
