// D-856: the bcn_agenda screen (D-849 datastore rows carry no category; the title decides).
// cities-11 11-11 sweep: the MNAC exhibition "... a càrrec d'Ona Balló" passed on "Ball" + "ó" (JS \b treats "ó"
// as a non-word character), and a samba-canção concert passed on the style word alone. The agenda also wraps a
// party's own name as Festa "...", so Jamboree's Saturday DJ night never paired with the club's own row.
import { describe, expect, it } from "vitest";
import { bcnAgendaToListings, isBcnDanceTitle } from "./bcn-agenda";
import type { Metro, NightDate } from "@/src/adapters/types";
import fixture from "./__fixtures__/bcn-agenda.json";

const BARCELONA: Metro = {
  id: "barcelona",
  slug: "barcelona",
  name: "Barcelona",
  countryCode: "ES",
  center: { lat: 41.3851, lng: 2.1734 },
  radiusKm: 15,
  tz: "Europe/Madrid",
  languages: ["ca", "es"],
};

const jamboree = (fixture as Array<Record<string, unknown>>).find(
  (e) => e.register_id === 99400715380,
)!;

function titlesFor(name: string): string[] {
  const event = { ...jamboree, register_id: 99400715377, name };
  return bcnAgendaToListings([event], {
    metro: BARCELONA,
    nights: ["2026-11-07"] as NightDate[],
    fetchedAt: new Date("2026-11-01T10:00:00Z"),
  }).listings.map((l) => l.listing.title);
}

describe("bcn_agenda screen (D-856)", () => {
  it.each([
    "Exposició 'El viatge invers: Un fresc sonor al romànic', a càrrec d'Ona Balló",
    'Concert "Ellas componen, ellas cantan: el universo femenino del samba-canção"',
    'Concert "Volem amb Txaikovski —La música dels ballets (a partir de 6 anys)"',
    'Conferència "Música clàssica. Maria Callas vs. Montserrat Caballé"',
    "Cinema per a tota la família 'Tot allò que balla'",
    "Exhibició 'Cos de ball i cor de la Casa de Granada'",
  ])("is not a dance night: %s", (name) => {
    expect(isBcnDanceTitle(name)).toBe(false);
    expect(titlesFor(name)).toEqual([]);
  });

  it.each([
    "Ballada de sardanes a la plaça de Sarrià amb la Cobla Baix Llobregat",
    "Balls i tapes",
    "Sardanes amb la Cobla La Nova Vallès",
    "Concert i ball amb l'orquestra Selvatana",
    'Festa "Disco Saturday Night: Dj Eley"',
    "Sessió de DJ al casal",
    "Milonga al Born",
  ])("is still a dance night: %s", (name) => {
    expect(isBcnDanceTitle(name)).toBe(true);
    expect(titlesFor(name)).toHaveLength(1);
  });

  // D-874: rows written before the D-856 screen stayed on the site (MNAC, 11 nights) because the
  // screen skipped silently; its occurrences are now reported as screened so the store retires them.
  it("reports a screened exhibition's occurrences, keyed as its listings would be", () => {
    const opts = {
      metro: BARCELONA,
      nights: ["2026-11-07"] as NightDate[],
      fetchedAt: new Date("2026-11-01T10:00:00Z"),
    };
    const asDance = bcnAgendaToListings(
      [{ ...jamboree, register_id: 99400715377, name: "Balls i tapes" }],
      opts,
    );
    const keys = asDance.listings.map((l) => l.externalId);
    expect(keys.length).toBeGreaterThan(0);
    expect(asDance.screened).toEqual([]);

    const expo = bcnAgendaToListings(
      [
        {
          ...jamboree,
          register_id: 99400715377,
          name: "Exposició 'El viatge invers: Un fresc sonor al romànic', a càrrec d'Ona Balló",
        },
      ],
      opts,
    );
    expect(expo.listings).toEqual([]);
    // Every occurrence is reported (the store limits retirement to the read's nights).
    const screenedKeys = expo.screened.map((s) => s.externalId);
    expect(screenedKeys).toEqual(expect.arrayContaining(keys));
    expect(new Set(screenedKeys).size).toBe(screenedKeys.length);
    expect(screenedKeys.every((k) => k.startsWith("99400715377:"))).toBe(true);

    // A title that was never a dance candidate (no screen word) is not reported.
    const plain = bcnAgendaToListings(
      [{ ...jamboree, register_id: 99400715377, name: "Visita guiada al museu" }],
      opts,
    );
    expect(plain.screened).toEqual([]);
  });

  it("lists a party under its own name, not the agenda's Festa wrapper", () => {
    expect(titlesFor('Festa "Disco Saturday Night: Dj Eley"')).toEqual([
      "Disco Saturday Night: Dj Eley",
    ]);
    expect(titlesFor("Festa 'Nit de salsa al barri'")).toEqual(["Nit de salsa al barri"]);
    // A title that only starts with the word keeps it.
    expect(titlesFor("Festa major de Gràcia: ball de nit")).toEqual([
      "Festa major de Gràcia: ball de nit",
    ]);
  });
});
