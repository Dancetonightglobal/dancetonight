// D-770 (the owner 2026-11-07, "keep DJ/party brunches"): meal brunches are screened; DJ and party brunches stay.
import { describe, expect, it } from "vitest";

import { screenTitle } from "@/src/domain/listing-screen";

const SCREENED = [
  "Bohemia Sunday Brunch",
  "Brunch in Plaza Vieja",
  "Sudan Grand Marshall Brunch",
  "Traditional Irish Sunday Carvery",
  "Sunset Dinner",
  "Sunday Roasts at the Crown",
];

const KEPT = [
  "SoulCaliCool Pool Party Brunch",
  "The House & Disco Bottomless Brunch",
  "Ibiza Anthems Brunch London House Party",
  "Agents Of Time by Brunch Electronik",
  "Y2K: Bottomless 00s Brunch Soho",
  "The Saturday Brunch Club",
  "BRUNCH: House Gospel Choir",
  "Duo RNB Party Brunch Sat 7th November",
  "Salsa Brunch",
  "Bachata Brunch & Social",
  "Dance Brunch",
  "Thursday Ladies' Night",
];

describe("brunch and meal titles (D-770)", () => {
  it.each(SCREENED)("screens %s", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
  });

  it.each(KEPT)("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
