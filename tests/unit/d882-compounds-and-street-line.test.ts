// D-882: a German compound names its dance ("Walzerfrühstück", Berlin traumtaenzer 2026-11-13), and a venue name
// before the street line is no street line ("Juju's Bar and Stage, Ely's Yard, 15 Hanbury Street", London 2026-11-13).
import { describe, expect, it } from "vitest";

import { compoundHead } from "@/config/style-compounds";
import { matchStyles } from "@/config/styles";
import { sameStreetAddress } from "@/src/domain/dedupe";
import { screenNoDance } from "@/src/domain/listing-screen";

describe("German dance compounds (D-882)", () => {
  it("finds the dance in a compound title", () => {
    expect(matchStyles("Walzerfrühstück").styles).toContain("waltz");
    expect(matchStyles("Tangoabend im Café").families).toContain("tango");
    expect(matchStyles("Salsakurs für Anfänger").styles).toContain("salsa");
  });

  it("finds nothing in compounds whose head is no dance", () => {
    expect(matchStyles("Schneeball").styles).toEqual([]);
    expect(matchStyles("Kaffeekranz und Kuchen").styles).toEqual([]);
    expect(compoundHead("ball")).toBeNull();
    expect(compoundHead("teeabend")).toBeNull();
  });

  it("keeps a compound-titled morning row on a mixed calendar", () => {
    // Styles as normalizeListing takes them from the title.
    const listing = (title: string) => ({
      title,
      styles: matchStyles(title).styles,
      startsAt: new Date("2026-11-22T09:00:00Z"),
      nightDate: "2026-11-22",
      tz: "Europe/Berlin",
    });
    expect(screenNoDance(listing("Walzerfrühstück"), { mixedCalendar: true })).toBeNull();
    expect(screenNoDance(listing("Kaffeefrühstück"), { mixedCalendar: true })).not.toBeNull();
  });
});

describe("a venue name before the street line (D-882)", () => {
  it("reads the street line after the venue's names", () => {
    expect(
      sameStreetAddress(
        "Juju's Bar and Stage, Ely's Yard, 15 Hanbury Street, London, United Kingdom",
        "Ely's Yard, 15 Hanbury St, London E1 6QR, UK",
      ),
    ).toBe(true);
  });

  it("never takes a postcode or a different house for the street line", () => {
    expect(sameStreetAddress("Foo Bar, Brooklyn, NY 11211", "Baz Club, Brooklyn, NY 11211")).toBe(
      false,
    );
    expect(
      sameStreetAddress(
        "Juju's Bar and Stage, 15 Hanbury Street, London",
        "Ely's Yard, 17 Hanbury St, London",
      ),
    ).toBe(false);
  });
});
