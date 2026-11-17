import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-820 (coverage daily 2026-11-09): religious ceremonies and rallies, a tribute act's concert and London
// Jazz Festival sets are not dance nights on any calendar, unless the title names a style or a dance word.
describe("D-820 religious ceremonies, rallies, tribute concerts, jazz festival sets", () => {
  it.each([
    "Mha Puja 2026 Celebration",
    "Durga Puja",
    "Nepal Era 1147 New Year Bhintuna Rally",
    "THIS IS STAN - THE ULTIMATE EMINEM TRIBUTE",
    "THIS IS STAN: The Ultimate Eminem Tribute - ALTERAÇÃO DE SALA",
    "Queen Tribute Concert",
    "Rosie Frater-Taylor - EFG London Jazz Festival at Half Moon - Putney",
    "Aziz Ibrahim 'Lahore To Longsight' Tour - EFG London Jazz Festival at Half Moon",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Callaita - Tainy Tribute Night Parrty at San Antonios Reggaeton Bar",
    "One Last Breath: Tribute to Creed | 11-14-26",
    "lobby lates: brick lane jazz festival",
    "Garba Night after the Puja",
    "Swing Dance at the London Jazz Festival",
    "Salsa Rally",
    "Protein 2 Year Celebration",
    "Folklore Iyali – A Celebration of Mexican Culture Through Dance",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
