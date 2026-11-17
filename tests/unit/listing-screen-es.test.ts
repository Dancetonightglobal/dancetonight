import { describe, expect, it } from "vitest";
import { screenTitle, screenNoDance } from "@/src/domain/listing-screen";

describe("Spanish (Miami) words for shows, games, kids, cancellations, boats, happy hours, haunted houses, wellness and talks (D-228)", () => {
  describe("screenTitle", () => {
    it("screens Spanish boat parties", () => {
      for (const title of [
        "SobeWetMiami : Yatcht : Club Edition*",
        "Rumba at Sea 2027 - Latin Dance Cruise",
        "Fiesta en Barco Miami",
      ]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("boat_or_cruise");
      }
    });

    it("keeps Yate Club Miami", () => {
      expect(screenTitle("Yate Club Miami")).toBeNull();
    });

    it("screens Spanish happy hour and crawl", () => {
      for (const title of ["Hora Feliz en Calle 8", "Recorrido de Bares Wynwood"]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("crawl_bus_or_happy_hour");
      }
    });

    it("keeps Spanish happy hour with dance words", () => {
      expect(screenTitle("FREE SALSA CLASS & HAPPY HOUR - LITTLE HAVANA MIAMI!")).toBeNull();
    });

    it("screens Spanish cancellations", () => {
      for (const title of ["CANCELADO", "Pospuesto"]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("closure");
      }
    });

    it("screens 'Closed for a Private Event'", () => {
      expect(screenTitle("Closed for a Private Event")).not.toBeNull();
      expect(screenTitle("Closed for a Private Event")?.kind).toBe("closure");
    });

    it("screens Spanish games nights", () => {
      for (const title of [
        "Reyes del Dominó Tournament",
        "Dominoes Tournament at The Yard",
        "Offline at The Wolf: Mahjong Night",
      ]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("not_dance_scope");
      }
    });

    it("keeps Domino Park events", () => {
      expect(screenTitle("Salsa Night at Domino Park")).toBeNull();
      expect(screenTitle("Bingo Night at Domino Park")).not.toBeNull();
    });

    it("screens Spanish children's parties", () => {
      for (const title of ["Fiesta Infantil de Halloween"]) {
        expect(screenTitle(title), title).not.toBeNull();
        expect(screenTitle(title)?.kind).toBe("not_dance_scope");
      }
    });

    it("screens kids' classes (D-571)", () => {
      expect(screenTitle("Clase de salsa para niños")?.kind).toBe("not_dance_scope");
    });

    it("screens Spanish haunted houses", () => {
      for (const title of ["Casa Embrujada Hialeah", "Casa del Terror"]) {
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

  describe("screenNoDance (mixed calendar)", () => {
    const mixedSource = { mixedCalendar: true, styles: [] as string[] };
    const listing = (title: string) => ({
      title,
      styles: [] as string[],
      startsAt: new Date("2026-10-31T20:00:00-04:00"),
      nightDate: "2026-10-31",
      tz: "America/New_York",
    });

    it("screens Spanish seated shows", () => {
      for (const title of [
        "KAMANKOLA en Concierto | Lanzamiento MAYOMI",
        "Rami Gonzalez presenta: LIBRE. Un show de stand up comedy",
        "Tributo a Fonseca at The Yard",
      ]) {
        expect(screenNoDance(listing(title), mixedSource), title).not.toBeNull();
      }
    });

    it("screens wellness sessions", () => {
      for (const title of [
        "Shamanic Sound Healing Journey & Cacao Ceremony from Perú",
        "Martes de Reflexiones Espirituales - Presencial!",
      ]) {
        expect(screenNoDance(listing(title), mixedSource), title).not.toBeNull();
      }
    });

    it("screens talks and worship", () => {
      for (const title of [
        "Taller de los Yoga Sutras de Patanjali con Emilia Arenas",
        "Noche de Adoración MIAMI | JESUS WORSHIP",
      ]) {
        expect(screenNoDance(listing(title), mixedSource), title).not.toBeNull();
      }
    });

    it("keeps dance events", () => {
      for (const title of ["Noche de Baile Latino", "Taller de Salsa en Línea"]) {
        expect(screenNoDance(listing(title), mixedSource), title).toBeNull();
      }
    });
  });
});
