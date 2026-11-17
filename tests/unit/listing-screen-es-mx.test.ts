import { describe, expect, it } from "vitest";
import { screenTitle, screenNoDance } from "@/src/domain/listing-screen";
import { listingTypeFromText } from "@/src/domain/text-facts";
import { matchStyles } from "@/config/styles";

const TZ = "America/Mexico_City";
const NIGHT = "2026-11-06";
/** 8pm, 6pm or 9pm Central on Friday 2026-11-06 (CST, UTC-6). */
const at = (hour: number) => {
  // Create a date on nightDate (2026-11-06) at the given hour in Mexico City (UTC-6)
  // hour is local hour in Mexico City
  // Convert to UTC: UTC = local + 6
  const utcHour = hour + 6;
  const utcDate = new Date(Date.UTC(2026, 10, 6, utcHour));
  return utcDate;
};
const listing = (title: string, hour = 20) => ({
  title,
  styles: matchStyles(title).styles as string[],
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedOnly = { mixedCalendar: true, styles: [] as string[] };

describe("Mexican Spanish screen words (D-238)", () => {
  describe("screenTitle (any source)", () => {
    it.each([
      "Xochimilco Boat Party | Social Experience for Travelers in Mexico City",
      "Paseo en Trajinera con Mariachi",
      "Ruta de Cantinas Centro Histórico",
      "Gran Cantinazo de Halloween",
      "Girls Halloween Party Bus - The Mexican & Foreign Girls Club",
      "Noche de Lotería",
      "Juegos de Mesa y Mezcal",
      "Fiesta de Disfraces para Peques",
    ])("screens %s", (title) => {
      expect(screenTitle(title)).not.toBeNull();
    });

    it.each([
      "Cósmica presenta: 1tbsp en CDMX · Día de Muertos",
      "HALLOWEEN: La Casita del Terror… y el Perreo | Tributo a Bad Bunny",
      "Mezcal Tasting & Salsa Night Experience in Mexico City",
    ])("keeps %s", (title) => {
      expect(screenTitle(title)).toBeNull();
    });

    it("screens a kids' class (D-571)", () => {
      expect(screenTitle("Clase de Salsa para Peques")?.kind).toBe("not_dance_scope");
    });
  });

  describe("screenNoDance (mixed calendar)", () => {
    it.each([
      "MEZCAL FEST • ESPÍRITUS DE MÉXICO 2026",
      "XXV Cumbre Mundial de Comunicación Política",
      "ITAM - Posgrados",
      "Feria Gastronómica de Coyoacán",
      "Aquelarre Mágico y Cantos al fuego",
      "Círculos de Hombres Gay | Clan CDMX",
      "Temazcal de Luna Llena",
      "Intercambio de Idiomas en la Roma",
      "Desfile de Día de Muertos",
      "Concurso de Catrinas",
    ])("screens %s", (title) => {
      expect(screenNoDance(listing(title), mixedOnly)).toMatchObject({
        kind: "not_dance_scope",
      });
    });

    it.each([
      "Mezcal Tasting & Salsa Night Experience in Mexico City",
      "De Antro en CDMX",
      "Congreso de Salsa CDMX",
    ])("keeps %s", (title) => {
      expect(screenNoDance(listing(title), mixedOnly)).toBeNull();
    });

    it("keeps late-night concert with 'foro' (venue name)", () => {
      // 11pm start - use hour=22 which is 10pm local time, still late night
      const lateListing = {
        ...listing("Concierto en el Foro Indie Rocks", 22),
      };
      expect(screenNoDance(lateListing, mixedOnly)).toBeNull();
    });
  });

  describe("listingTypeFromText", () => {
    it("recognizes 'antro' as club_night", () => {
      const result = listingTypeFromText("De Antro en CDMX", null, []);
      expect(result.type).toBe("club_night");
    });
  });
});
