import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-888 (weekly review 2026-11-23 of the daily checks 11-18 to 11-22): meals, markets, talks, film cycles, visits
// and errands that mixed calendars still put on the page. Each is screened unless the title names a style, a dance
// word or (for meals) a party word.
describe("D-888 non-dance activities from the 11-18 to 11-22 daily checks", () => {
  it.each([
    // meals (D-770's meal rule)
    "Circe’s Supper Club",
    "Drink & Dine",
    "Dine À La Carte With 30% On Us",
    "Set Lunch Tasting Menu",
    "Harry Potter Themed Dinner",
    "Gypsy Social Lunch",
    "Thanksgiving Dinner at Zoi",
    // markets, errands, services
    "San Pedro Certified Farmers Market",
    "Little Tokyo Farmers' Market",
    "Food Pantry",
    "Colheita de Sangue",
    "Free Citizenship Classes",
    "Turkish Bible Study",
    "Gym with Personal Trainer",
    "Group Fitness Classes and Exercise",
    // talks, visits, film cycles
    "John Ware, Former BBC Correspondent – In Conversation: A London Book Launch",
    "Author Event: Katya Williamson & Gina O’Melveny",
    "Table ronde",
    "An Act of Attention : Visite commentée",
    'Visite hors les murs "Ibrahim Mahama, Le Temps des récoltes" avec Jeanne Barral',
    "Ciclo: Documentales latinoamericanos",
    '"ATREVIDA" Ciclo de Cine Queer',
    "Proyección película de Nuri Bilge Ceylan",
    "Cine para escuelas",
    "Ciclo de Cinema de Homenagem a Rogério Ceitil",
    // other activities
    "tea ceremony with kristine",
    "Juggling Class",
    "Ice Skating",
    "Surf Experience Caparica",
    "Speed Friending (+ After Party)",
    "Music Explorers: Music Appreciation for All Ages!",
    "Intro to Close Reading",
    // holiday closures after a venue or style name
    "CLOSED FOR THANKSGIVING DADA",
    "Business Office Closed for Thanksgiving",
    "NO CONTRA Hancock closed for Thanksgiving",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Salsa Supper Club",
    "Disco Supper Club with DJ Ana",
    "House & Garage Bottomless Brunch Party",
    "Bachata Social after the Farmers Market",
    "Tango Cine Club: Milonga",
    // RA, 11pm to 5am: a club night named after a film club
    "Yu Yu Cine Club: WiG Anniversary",
    "Lindy Hop Social at the Ice Rink",
    "Thanksgiving Eve Dance Party",
    "Roller Disco Night",
    "Swing Dance Book Launch Party",
    "Closed-Toe Shoes Required: Salsa Night",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
