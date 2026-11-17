// Daily site check 2026-11-10/11, section E (D-857): RA carries SEO spam posted as events ("Clubs and DJ nights"),
// utility and phone bill-payment guides, in NYC, London, Barcelona and Los Angeles (all 11-14 at 23:00).
import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";
import { screenBillSpam } from "@/src/domain/listing-screen-spam";

describe("bill-payment spam is not an event (D-857)", () => {
  it.each([
    "Ameren Pay My Bill: Pay Online, Guest Payment & Login Portal",
    "ComEd Bill Payment Portal Login - Access & Pay Your Account",
    "Pay Your Xcel Energy Electric Bill Online - Fast & Easy Options",
    "AT&T Fast Pay Online: How to Clear Your Balance Instantly",
    "Pay AT&T Bill Online Without Logging In: Fast Guest Pay Guide",
    "AT&T Bill Payment Portal Online: Login, Methods & AutoPay",
    "AT&T Account Bill Pay Online: Portal Login & Billing Management",
    "How to Pay Your AT&T Bill Online",
  ])("screens %s", (title) => {
    expect(screenBillSpam(title)?.kind).toBe("not_a_dance");
    expect(screenTitle(title)?.kind).toBe("not_a_dance");
  });

  it.each([
    "Pay What You Can Salsa Social",
    "Bill Withers Tribute Night: Soul & Swing",
    "Buffalo Bill's Line Dance Night",
    "Portal: Techno All Night",
    "Login Required: Warehouse Rave",
    "Pay Day Party - Bachata & Kizomba",
    "Fast Feet Lindy Hop",
  ])("keeps %s", (title) => {
    expect(screenBillSpam(title)).toBeNull();
  });
});

// Daily site check 2026-11-12, section G (D-876): a fortune-teller ad typed "Clubs and DJ nights" on RA (Paris 09787d50).
describe("fortune-teller ads are not events (D-876)", () => {
  it.each([
    "Vrai Marabout Voyant Compétent à Strasbourg – Paiement Après Résultat",
    "Grand Marabout Puissant : Retour de l'être aimé",
    "Voyance sérieuse – paiement après résultat",
    "Powerful Spell Caster: Bring Your Ex Back, Results Guaranteed",
    "Psychic Medium Love Spells WhatsApp",
  ])("screens %s", (title) => {
    expect(screenBillSpam(title)?.kind).toBe("not_a_dance");
    expect(screenTitle(title)?.kind).toBe("not_a_dance");
  });

  it.each([
    "Marabout: Afrobeat & Coupé-Décalé Night",
    "Soirée Voyante – Disco Années 80",
    "Medium Tempo Salsa Social",
    "Psychic TV Live + Techno Afterparty",
    "Results Night: Zouk Competition Final",
  ])("keeps %s", (title) => {
    expect(screenBillSpam(title)).toBeNull();
  });
});
