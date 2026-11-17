// French screen words, edge cases asked by coverage-106 (D-1041): whole words only, dance words do not rescue
// shows, accented and plain spellings.
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

describe("French words match whole words only (D-1041)", () => {
  it("does not read 'bal' inside 'balade' as a dance on a mixed calendar", () => {
    expect(screenNoDance(listing("Balade à vélo"), mixedSource)).not.toBeNull();
  });

  it("keeps Balboa (a swing style)", () => {
    expect(screenTitle("Soirée Balboa")).toBeNull();
    expect(screenNoDance(listing("Soirée Balboa", 20, ["balboa"]), mixedSource)).toBeNull();
  });

  it("does not read 'loto' inside 'Lotus'", () => {
    expect(screenTitle("Salsa au Lotus Club")).toBeNull();
  });
});

describe("dance words do not rescue shows (D-1041, D-570)", () => {
  it.each(["Spectacle de danse contemporaine", "Spectacle de danse : Casse-Noisette"])(
    "screens %s",
    (title) => {
      expect(screenTitle(title)).not.toBeNull();
    },
  );

  it.each(["Projection : Dirty Dancing", "Projection du film Danse avec les loups"])(
    "screens %s on a mixed calendar",
    (title) => {
      expect(screenNoDance(listing(title), mixedSource)).not.toBeNull();
    },
  );
});

describe("cancellations, accented and plain (D-1041)", () => {
  it.each(["ANNULÉ", "ANNULE", "Annulée", "Annulee", "REPORTÉ", "REPORTE", "Reportée", "Reportee"])(
    "screens %s as closure",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "closure" });
    },
  );
});

describe("soirée as a dance hint does not rescue games nights (D-1041)", () => {
  it.each(["Soirée jeux de société", "Soirée blind test"])("screens %s", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
  });
});

describe("'enfants' marks a children's program only inside a program phrase (D-1041)", () => {
  it.each(["Soirée salsa aux Enfants du Canal", "Bal swing aux Enfants Terribles"])(
    "keeps %s",
    (title) => {
      expect(screenTitle(title)).toBeNull();
    },
  );

  it.each([
    "Atelier danse pour les enfants",
    "Spectacle enfants",
    "Éveil musical enfants de 3 ans",
    "Boum des enfants",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
  });
});
