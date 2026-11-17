import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";

const TZ = "Europe/Lisbon";
const NIGHT = "2026-11-06";
const at = (hour: number) => new Date(Date.UTC(2026, 10, 6, hour)); // Lisbon is UTC+0 in November
const listing = (title: string, hour = 20, styles: string[] = []) => ({
  title,
  styles,
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedSource = { mixedCalendar: true, styles: [] as string[] };
const bandsForDancersSource = {
  mixedCalendar: true,
  bandsForDancers: true,
  styles: [] as string[],
};

describe("Portuguese and Catalan dance words keep a listing (D-234)", () => {
  it.each([
    "Ball dels divendres",
    "Ballada de swing amb la banda Beat Band",
    "Matiné Dançante no Ateneu",
    "Arraial de Santo António",
    "Tardeada de salsa",
    "Jueves de Bailoteo en La Casa de los Bailadores",
    "Sábado Bailables at Música Bar & Lounge",
  ])("keeps %s", (title) => {
    expect(screenNoDance(listing(title), mixedSource), title).toBeNull();
  });

  it("keeps Oficina de forró when style matches", () => {
    // Assuming forro is a valid style key in matchStyles
    const listingWithStyle = listing("Oficina de forró", 20, ["forro"]);
    expect(screenNoDance(listingWithStyle, mixedSource)).toBeNull();
  });
});

describe("Portuguese and Catalan seated shows are screened (D-234)", () => {
  it.each([
    "Noite de Fado na Mouraria",
    "Fado in Chiado",
    "Concert de guitarra de David de Arahal",
    "Concert simfònic de l'OAM",
    "Peça: O Auto da Compadecida",
    "Xerrada i debat 'Ball de bot des d'una perspectiva històrica, política i de gènere'",
    "Cena show en Señor Tango",
    "Espectacle de dansa contemporània",
  ])("screens %s", (title) => {
    expect(screenNoDance(listing(title), mixedSource), title).not.toBeNull();
  });
});

describe("Wellness sessions in Portuguese/Catalan are screened (D-234)", () => {
  it.each(["Gestió de l'estrés i meditació", "Banho de som com taças tibetanas"])(
    "screens %s",
    (title) => {
      expect(screenNoDance(listing(title), mixedSource), title).not.toBeNull();
    },
  );
});

describe("Talks, workshops, street parades are screened when style-less (D-234)", () => {
  it.each(["Palestra sobre gestão", "Correfoc", "Taller de castells"])("screens %s", (title) => {
    expect(screenNoDance(listing(title), mixedSource), title).not.toBeNull();
  });

  it("screens a talk whose title names no style, even with an extracted style (as D-228)", () => {
    const listingWithStyle = listing("Palestra sobre gestão", 20, ["samba"]);
    expect(screenNoDance(listingWithStyle, mixedSource)).not.toBeNull();
  });
});

describe("Dance-floor venue (bandsForDancers) behavior (D-234)", () => {
  it("keeps Concerto de samba at a dance-floor venue", () => {
    expect(screenNoDance(listing("Concerto de samba"), bandsForDancersSource)).toBeNull();
  });

  it("screens Noite de Fado at a dance-floor venue", () => {
    expect(screenNoDance(listing("Noite de Fado"), bandsForDancersSource)).not.toBeNull();
  });
});
