// French screen words: boats, cancellations, games, children's parties, seated shows, talks, wellness,
// language and craft classes (D-1041, Paris).
import { describe, expect, it } from "vitest";
import { screenTitle, screenNoDance } from "@/src/domain/listing-screen";

const TZ = "Europe/Paris";
const NIGHT = "2026-11-06";
const at = (hour: number) => new Date(Date.UTC(2026, 10, 6, hour - 1)); // Paris is UTC+1 in November
const listing = (title: string, hour = 20, styles: string[] = []) => ({
  title,
  styles,
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedSource = { mixedCalendar: true, styles: [] as string[] };

describe("French boat parties (D-1041)", () => {
  it.each(["Croisière salsa sur la Seine", "CROISIÈRE DJ", "Soirée en bateau-mouche"])(
    "screens %s as boat_or_cruise",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "boat_or_cruise" });
    },
  );

  // Paris clubs moored on the Seine are venues, not cruises.
  it.each(["Soirée house à la Péniche Marcounet", "Bal swing sur la péniche"])(
    "keeps %s",
    (title) => {
      expect(screenTitle(title)).toBeNull();
    },
  );
});

describe("French cancellations (D-1041)", () => {
  it.each(["ANNULÉ", "Annulée", "REPORTÉ", "Soirée annulée"])("screens %s as closure", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "closure" });
  });

  it("keeps a sold-out night", () => {
    expect(screenTitle("COMPLET - Bal swing du jeudi")).toBeNull();
  });
});

describe("French games nights (D-1041)", () => {
  it.each(["Soirée jeux de société", "Blind test géant", "Loto du club", "Soirée jeux"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );
});

describe("French children's parties and workshops (D-1041)", () => {
  it.each(["Boum des enfants", "Fête d'Halloween pour les enfants", "Atelier enfants"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );
});

describe("French language, craft, book-club and watch titles, on any calendar (D-1041)", () => {
  it.each([
    "Cours de français",
    "Cours d'anglais pour adultes",
    "Atelier tricot",
    "Atelier poterie",
    "Club de lecture",
    "Retransmission du match",
    "Vide-dressing",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });
});

describe("French titles kept (D-1041)", () => {
  it.each([
    "Soirée salsa",
    "Bal swing du jeudi",
    "Soirée bachata au Barrio Latino",
    "Thé dansant",
    "Bal folk",
    "Nuit kizomba",
    "Milonga du dimanche",
    "Soirée dansante années 80",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});

describe("French seated shows and talks screened by screenNoDance (D-1041)", () => {
  it.each([
    "Spectacle : Le Lac des cygnes",
    "Projection : West Side Story",
    "Conférence sur l'histoire du tango",
    "Pièce de théâtre",
    "One man show",
    "Vernissage de l'exposition",
    "Table ronde : la nuit à Paris",
  ])("screens %s", (title) => {
    expect(screenNoDance(listing(title), mixedSource)).not.toBeNull();
  });
});

describe("French wellness sessions screened by screenNoDance (D-1041)", () => {
  it.each(["Bain sonore aux bols tibétains", "Bain de gong", "Sophrologie", "Méditation guidée"])(
    "screens %s",
    (title) => {
      expect(screenNoDance(listing(title, 19), mixedSource)).not.toBeNull();
    },
  );
});

describe("French dance nights kept by screenNoDance (D-1041)", () => {
  it.each([
    ["Soirée dansante", 20, []],
    ["Bal swing", 20, []],
    ["Bal musette", 15, []],
    ["Piste de danse ouverte", 21, []],
    ["Soirée salsa", 20, ["salsa"]],
  ] as const)("keeps %s", (title, hour, styles) => {
    expect(screenNoDance(listing(title, hour, [...styles]), mixedSource)).toBeNull();
  });
});
