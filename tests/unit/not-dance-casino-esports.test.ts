import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-847 (cities-10, London discovered sources 11-10/11-11): casino tournaments and esports nights are not dance
// nights on any calendar, unless the title names a style or a dance word. "Casino" alone is a salsa style.
describe("D-847 casino tournaments and esports", () => {
  it.each([
    "£10,000* Slots Tournament",
    "Texas Hold'em Poker Tournament",
    "Friday Poker Night",
    "Blackjack Tournament",
    "OVERWATCH 5v5",
    "Rocket League 3v3 Cup",
    "Esports Night: Valorant",
    "E-sports Finals Watch Party",
    "LAN Party",
    "FIFA Tournament",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Casino Night: Salsa Cubana",
    "Rueda de Casino Social",
    "Cyberpunkers 3 - A Cyberpunk Party",
    "Salsa Night after the Poker Tournament",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
