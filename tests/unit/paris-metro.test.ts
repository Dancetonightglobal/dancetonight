// Paris is the Metropole du Grand Paris (D-1040): the City of Paris plus 129 communes,
// the outline in config/metro-bounds/paris.json, quartiers and communes as neighbourhoods,
// postcodes 75xxx, 92, 93, 94 and six Essonne communes. RA area 44.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { adapterFor } from "@/src/pipeline/runner";
import { REGISTRY } from "@/src/pipeline/ingest";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { insideMetro } from "@/src/domain/metro-bounds";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";

import parisNeighbourhoods from "@/config/neighbourhoods/paris.json";

const PARIS: Metro = {
  id: "m",
  slug: "paris",
  name: "Paris",
  countryCode: "FR",
  center: { lat: 48.8534, lng: 2.3488 },
  radiusKm: 30,
  tz: "Europe/Paris",
  languages: ["fr", "en"],
};

describe("the Metropole du Grand Paris (D-1040)", () => {
  it.each([
    ["Badaboum, Bastille", 48.8545, 2.3747, "La Roquette"],
    ["La Machine du Moulin Rouge", 48.8841, 2.3323, "Grandes Carrières"],
    ["Wanderlust, Docks", 48.8401, 2.3707, "Salpêtrière"],
    ["Le Chinois, Montreuil", 48.8564, 2.4387, "Montreuil"],
    ["Mains d'Oeuvres, Saint-Ouen", 48.9065, 2.333, "Saint-Ouen-sur-Seine"],
    ["Kilometre25, La Villette", 48.8988, 2.3908, "Pont-de-Flandre"],
    ["Argenteuil", 48.947, 2.247, "Argenteuil"],
  ])("puts %s inside, in its quartier/commune", (_name, lat, lng, hood) => {
    expect(insideMetro(PARIS, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["the Seine at Pont Neuf", 48.857, 2.3412],
    ["Bois de Boulogne", 48.862, 2.249],
    ["Orly airport", 48.7262, 2.3794],
  ])("puts %s inside", (_name, lat, lng) => {
    expect(insideMetro(PARIS, { lat, lng })).toBe(true);
  });

  it.each([
    ["Versailles", 48.8049, 2.1301],
    ["Roissy-CDG", 49.0097, 2.5479],
    ["Lyon", 45.764, 4.8357],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(PARIS, { lat, lng })).toBe(false);
  });

  it("has postcodes for Grand Paris", () => {
    expect(METRO_POSTCODE_PREFIXES.paris).toEqual([
      "75",
      "92",
      "93",
      "94",
      "95100",
      "91200",
      "91260",
      "91420",
      "91550",
      "91600",
      "91170",
    ]);
  });

  it("detects outside towns in titles", () => {
    // Versailles is in METRO_OUTSIDE_TOWNS_AFTER_COMMA, detected when preceded by a comma
    expect(titleNamesOutsideTown("paris", "Soirée salsa, Versailles")).toBe("Versailles");
    expect(titleNamesOutsideTown("paris", "Bal swing Gare de Lyon")).toBe(null);
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    // DICE (owner's yes, 2026-11-06), Salsa Vida, tango-argentin.fr (D-1044), AgendaTrad (D-831), RA (D-505), 16 own sites (paris-seed1 to paris-seed4, TiTi retired, Temple du Swing x2, AGUA x2, Banana Café), 1 hand-checked Instagram (La CASA, D-797) and 2 Eventbrite organisers (D-131).
    const parisSources = METRO_SOURCES.paris ?? [];
    expect(parisSources).toHaveLength(64);
    const agendatrad = parisSources.filter((s) => s.platform === "agendatrad");
    expect(agendatrad.map((s) => s.url)).toEqual([
      "https://agendatrad.org/calendar/France/Ile-de-France",
    ]);
    expect(agendatrad[0]?.robotsWaiver?.decision).toBe("D-831");
    // kind "jsonld" + platform "agendatrad" reaches the AgendaTrad reader, not the generic JSON-LD reader
    // (adapterFor checks the platform first; only kind "html" is probed, which would drop the platform).
    expect(agendatrad[0]?.kind).toBe("jsonld");
    expect(agendatrad[0]?.mixedCalendar).toBeUndefined();
    expect(
      adapterFor({ kind: "jsonld", platform: agendatrad[0]?.platform ?? null }, REGISTRY)?.id,
    ).toBe("agendatrad");
    const eventbriteSources = parisSources.filter((s) => s.platform === "eventbrite");
    expect(eventbriteSources.map((s) => s.url)).toEqual([
      "https://www.eventbrite.com/o/11869620777",
      "https://www.eventbrite.fr/o/113172966841",
      "https://www.eventbrite.fr/o/47098959913",
      "https://www.eventbrite.com/o/121838998378",
    ]);
    expect(eventbriteSources.every((s) => s.kind === "ticketing_api")).toBe(true);
    // Every organiser is screened as a mixed calendar except LA SUNDAY, a club night's own list (run 42450876185).
    const laSunday = "https://www.eventbrite.fr/o/47098959913";
    expect(
      eventbriteSources.filter((s) => s.url !== laSunday).every((s) => s.mixedCalendar === true),
    ).toBe(true);
    expect(eventbriteSources.find((s) => s.url === laSunday)?.mixedCalendar).toBeUndefined();
    const tangoSources = parisSources.filter((s) => s.platform === "tango_argentin");
    expect(tangoSources.map((s) => s.url)).toEqual(["https://tango-argentin.fr/ile-de-france"]);
    const raSources = parisSources.filter((s) => s.platform === "ra");
    expect(raSources).toHaveLength(1);
    const diceSources = parisSources.filter((s) => s.platform === "dice");
    expect(diceSources).toHaveLength(34);
    for (const source of diceSources) {
      expect(source.url).toMatch(
        /^https:\/\/dice\.fm\/browse\/paris-5b23e8a0e63cc224a4c36a2d\/music\//,
      );
    }
    const salsaVidaSources = parisSources.filter(
      (s) => s.url === "https://www.salsavida.com/guides/france/paris/",
    );
    expect(salsaVidaSources).toHaveLength(1);
    expect(salsaVidaSources[0]?.trustTier).toBe("directory");
    const retired = METRO_RETIRED_SOURCES.paris ?? [];
    expect(retired).toHaveLength(35);
    const diceRetired = retired.filter((r) =>
      r.url.startsWith("https://dice.fm/browse/paris-5b23e8a0e63cc224a4c36a2d/music/"),
    );
    expect(diceRetired).toHaveLength(13);
    const otherRetired = retired.filter(
      (r) => !r.url.startsWith("https://dice.fm/browse/paris-5b23e8a0e63cc224a4c36a2d/music/"),
    );
    expect(otherRetired).toHaveLength(22);
    const otherUrls = otherRetired.map((r) => r.url);
    expect(otherUrls).toEqual([
      "https://lanuit.club/",
      "https://levelparis.fr/",
      "https://ohhappyparis.com/contact/#formulaire",
      "https://lillysclub.com/",
      "https://salsacaraibes.fr/",
      "https://www.titipalacio.com/",
      "https://aufutetamesure.fr/",
      "https://www.cesanneesla.com/",
      "https://www.alfortville.fr/logement-social",
      "https://www.privateaser.com/reservation-bar/top-beer-pong-bars-paris",
      "https://tango-argentin.fr/daymilongas",
      "https://redzone-bar.com/agenda/",
      "https://raiddbar.com/en/index.html",
      "https://www.sortiracourbevoie.fr/voir/tous",
      "https://www.newmorning.com/",
      "https://studiolaccordparfait.com/",
      "https://www.tresmixity.com/",
      "http://www.leregarducygne.com",
      "http://www.sunset-sunside.com/",
      "https://apprends-et-reve.fr/",
      "https://www.agora.paris/lagendadelagora.html",
      "https://www.maison-developpement-durable.org/",
    ]);
    const sourceUrls = new Set(parisSources.map((s) => s.url));
    const retiredUrls = new Set(retired.map((r) => r.url));
    expect([...sourceUrls].filter((u) => retiredUrls.has(u))).toEqual([]);
    expect(KNOWN_VENUES.paris).toEqual([]);
  });

  it("lists the weekly nights its own sites print (fixedNights, 2026-11-07)", () => {
    const parisSources = METRO_SOURCES.paris ?? [];
    const titles = parisSources.flatMap((s) => (s.fixedNights ?? []).map((n) => n.title));
    expect(titles).toEqual([
      "K&S Experience SBK",
      "Dansez comme à Cuba",
      "Swing au Caveau de la Huchette",
      "Swing au Caveau de la Huchette (week-end)",
      "Après-midi dansant du Duplex (dimanche)",
      "Thé dansant au Balajo",
      "Mixte Salsa Clubbing au Balajo",
      "Club Madame Arthur (jeudi)",
      "Club Madame Arthur (vendredi et samedi)",
      "After WCS du mardi au Temple du Swing",
      "After WCS du jeudi au Temple du Swing",
      "Pratique Swing au Temple du Swing (mercredi)",
      "AGUA - soirée salsa bachata du mardi",
      "AGUA - soirée salsa bachata du dimanche",
      "Banana Café, bar dansant (tous les soirs)",
      "La Frénésie at La CASA (samedi)",
    ]);
    for (const s of parisSources) {
      for (const n of s.fixedNights ?? []) {
        expect(n.danceCited.length).toBeGreaterThan(0);
        expect(n.line.length).toBeGreaterThan(0);
      }
    }
    expect(parisSources.some((s) => s.url === "https://www.titipalacio.com/")).toBe(false);
    expect(
      parisSources.find((s) => s.url === "https://www.salsavida.com/guides/france/paris/")
        ?.mixedCalendar,
    ).toBeUndefined();
    const tango = parisSources.find((s) => s.url === "https://tango-argentin.fr/ile-de-france");
    expect(tango?.kind).toBe("jsonld");
    expect(tango?.platform).toBe("tango_argentin");
  });

  it("has 231 neighbourhood entries with non-empty names and polygons", () => {
    expect(parisNeighbourhoods.neighbourhoods.length).toBe(231);
    for (const n of parisNeighbourhoods.neighbourhoods) {
      expect(n.name).toBeTruthy();
      expect(n.polygons.length).toBeGreaterThan(0);
    }
  });
});
