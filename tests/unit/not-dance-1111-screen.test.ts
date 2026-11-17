import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-860 (coverage daily 2026-11-11): a flea market, a choir rehearsal, a card-game night and a tech
// festival are not dance nights on any calendar, unless the title names a style or a dance word.
describe("D-860 non-dance activities from the 11-11 daily check", () => {
  it.each([
    "Weekend Flea Market",
    "Wayne Oratorio Society Weekly Rehearsal",
    "EDH/Commander Casual",
    "Magic the Gathering Draft Night",
    "Board and Card Games Social",
    "AI FESTIVAL Women - Rio de Janeiro - Protagonismo feminino na Inteligência Artificial",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Salsa Night at the Flea Market",
    "Lindy Hop Social after Rehearsal",
    "Bachata Festival Weekend",
    "Commander's Ball: Swing Dance",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
