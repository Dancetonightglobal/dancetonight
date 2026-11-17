// Moored barge venues (D-1046, Paris).
import { describe, expect, it } from "vitest";
import { screenTitle, isMooredBarge, screenStoredRow } from "@/src/domain/listing-screen";
import { screenTitleHan } from "@/src/domain/listing-screen-zh";

describe("Moored barge venues (D-1046)", () => {
  describe("isMooredBarge", () => {
    it("returns true for péniche tokens", () => {
      expect(isMooredBarge("PÉNICHE MARCOUNET")).toBe(true);
      expect(isMooredBarge("Péniche Concorde Atlantique")).toBe(true);
      expect(isMooredBarge("Le Bateau Phare")).toBe(true);
      expect(isMooredBarge("ANNETTE K.")).toBe(true);
    });

    it("returns false for non-barge names", () => {
      expect(isMooredBarge("Le Bateau")).toBe(false);
      expect(isMooredBarge("Bateau-Mouche")).toBe(false);
      expect(isMooredBarge(null)).toBe(false);
      expect(isMooredBarge("")).toBe(false);
      expect(isMooredBarge("Marina Bay Club")).toBe(false);
    });
  });

  describe("screenTitle with venueName", () => {
    it("keeps Rock That Boat at Péniche Concorde Atlantique", () => {
      expect(screenTitle("Rock That Boat", "Péniche Concorde Atlantique")).toBeNull();
    });

    it("drops Rock That Boat without venue", () => {
      expect(screenTitle("Rock That Boat")).toMatchObject({ kind: "boat_or_cruise" });
    });

    it("keeps Rock That Boat @ Péniche Concorde Atlantique (title contains barge)", () => {
      expect(screenTitle("Rock That Boat @ Péniche Concorde Atlantique")).toBeNull();
    });

    it("keeps Boat Party at Le Bateau Phare", () => {
      expect(screenTitle("Boat Party", "Le Bateau Phare")).toBeNull();
    });

    it("keeps Boat Party at Concorde Atlantique", () => {
      expect(screenTitle("Boat Party", "Concorde Atlantique")).toBeNull();
    });

    it("drops Thames Boat Party Cruise at Péniche Marcounet (has sailing word)", () => {
      expect(screenTitle("Thames Boat Party Cruise", "Péniche Marcounet")).toMatchObject({
        kind: "boat_or_cruise",
      });
    });

    it("drops Croisière salsa at Péniche Marcounet (has sailing word)", () => {
      expect(screenTitle("Croisière salsa", "Péniche Marcounet")).toMatchObject({
        kind: "boat_or_cruise",
      });
    });

    it("drops Soirée en bateau-mouche at Péniche Marcounet (has bateau-mouche)", () => {
      expect(screenTitle("Soirée en bateau-mouche", "Péniche Marcounet")).toMatchObject({
        kind: "boat_or_cruise",
      });
    });

    it("drops Yacht Party at Marina Bay Club (not a barge)", () => {
      expect(screenTitle("Yacht Party", "Marina Bay Club")).toMatchObject({
        kind: "boat_or_cruise",
      });
    });

    it("still screens Karaoke Night at Péniche Marcounet (other screens apply)", () => {
      expect(screenTitle("Karaoke Night", "Péniche Marcounet")).not.toBeNull();
    });

    it("drops Boat Party with null venueName", () => {
      expect(screenTitle("Boat Party", null)).toMatchObject({ kind: "boat_or_cruise" });
    });

    it("drops Boat Party with empty venueName", () => {
      expect(screenTitle("Boat Party", "")).toMatchObject({ kind: "boat_or_cruise" });
    });

    it("keeps Salsa Yacht Party at Annette K with venueName Annette K", () => {
      expect(screenTitle("Salsa Yacht Party at Annette K", "Annette K")).toBeNull();
    });

    it("keeps Salsa Yacht Party at Annette K with venueName null (title names Annette K)", () => {
      expect(screenTitle("Salsa Yacht Party at Annette K", null)).toBeNull();
    });

    it("keeps Salsa Yacht Party at Annette K with venueName Péniche ANNETTE K.", () => {
      expect(screenTitle("Salsa Yacht Party at Annette K", "Péniche ANNETTE K.")).toBeNull();
    });

    it("drops Croisière salsa at Annette K with venueName Annette K (has sailing word)", () => {
      expect(screenTitle("Croisière salsa at Annette K", "Annette K")).toMatchObject({
        kind: "boat_or_cruise",
      });
    });

    it("drops a Yacht Party with null venueName when the title names no moored venue", () => {
      expect(screenTitle("Salsa Yacht Party", null)).toMatchObject({ kind: "boat_or_cruise" });
    });

    it("drops Yacht Party at Annette's Bar with venueName Annette's Bar (no K token)", () => {
      expect(screenTitle("Yacht Party at Annette's Bar", "Annette's Bar")).toMatchObject({
        kind: "boat_or_cruise",
      });
    });
  });

  describe("barge only in a venue name", () => {
    it("drops a US party barge with no venue", () => {
      expect(screenTitle("Lake Travis Party Barge Boat Party")).toMatchObject({
        kind: "boat_or_cruise",
      });
    });

    it("keeps Rock That Boat at venue Barge du Crous", () => {
      expect(screenTitle("Rock That Boat", "Barge du Crous")).toBeNull();
    });

    it("reads barge in a venue name only", () => {
      expect(isMooredBarge("Barge du Crous")).toBe(false);
      expect(isMooredBarge("Barge du Crous", { venue: true })).toBe(true);
    });
  });

  describe("Chinese screen with moored venue", () => {
    it("keeps 遊艇派對 when mooredVenue is true", () => {
      expect(screenTitleHan("遊艇派對", true)).toBeNull();
    });

    it("drops 遊艇派對 when mooredVenue is false", () => {
      expect(screenTitleHan("遊艇派對")).toMatchObject({ kind: "boat_or_cruise" });
    });

    it("drops 郵輪派對 even when mooredVenue is true (has cruise needle)", () => {
      expect(screenTitleHan("郵輪派對", true)).toMatchObject({ kind: "boat_or_cruise" });
    });
  });

  describe("screenStoredRow with venueName", () => {
    const row = {
      title: "Rock That Boat",
      styles: ["rock_n_roll"],
      startsAt: new Date(Date.UTC(2026, 10, 9, 19)), // 20:00 Paris
      nightDate: "2026-11-09",
      tz: "Europe/Paris",
    };
    const source = { styles: ["rock_n_roll"] };
    it("keeps a stored barge row", () => {
      expect(
        screenStoredRow({ ...row, venueName: "Péniche Concorde Atlantique" }, source),
      ).toBeNull();
    });
    it("screens the same row with no venue", () => {
      expect(screenStoredRow(row, source)).not.toBeNull();
    });
  });
});
