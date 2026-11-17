// D-886 (daily check 2026-11-16): SEO ads and stubs on RA, a promoter's test row, and RA talks, listening events,
// markets, music theatre and quartets were cards. Dance nights that share a word stay.
import { describe, expect, it } from "vitest";

import { screenTitle } from "@/src/domain/listing-screen";

const screened = (title: string) => screenTitle(title) !== null;

describe("D-886 screens", () => {
  it.each([
    "How To Recover Your Lost Crypto From Scammers with Help of Lost Recovery Masters",
    "POWERFUL LOVE SPELLS FOR REUNION, MARRIAGE, ATTRACTION, RELATIONSHIP BY OMEGA SP",
    "Ember Shores Promo Codes 2026 – RSVP or NOCTURNALSD",
    "LILYLAW — Artist Profile Setup",
    "recurring event test",
    "Test Event",
    "TEST",
    "RA25 UNLOCKED x Berlin community radios - Free panel talk and networking",
    "WENN ES HELL WIRD (Nenn' ich es Aufgang oder Untergang) - Ein Solo Musiktheater",
    "Moritz Klein Instruments x Erica Synths: Circuit Design Sessions - FREE w/ RSVP",
    "Rosa Landers - Pre-Listening Event (Solvay EP)",
    "Winter Swap Market Berlin",
    "Gareth Wild VINYL MASTERCLASS",
    "Food Fetish - WIRED: A Sensory Dining Experience",
    "Lyrical Libations presents: Isidore String Quartet",
  ])("screens %s", (title) => {
    expect(screened(title)).toBe(true);
  });

  it.each([
    "Testpilot presents: Techno All Night",
    "Bachata Test Night: First Timers Welcome",
    "Love Spell: A Valentine's Salsa Social",
    "Recovery Sunday Afterparty",
    "Salsa Masterclass with Juan Calle",
    "Promo Code SALSA10 for the Friday Social",
    "Panel Discussion & Swing Dance Social",
    "Contest: Lindy Hop Jack and Jill",
  ])("keeps %s", (title) => {
    expect(screened(title)).toBe(false);
  });
});
