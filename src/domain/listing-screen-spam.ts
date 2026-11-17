import type { NotAnEvent } from "./listing-screen";

/**
 * Screen bill-payment SEO spam posted as events.
 * Returns a NotAnEvent object if the title matches bill-payment spam criteria,
 * otherwise returns null.
 */
export function screenBillSpam(title: string): { kind: "not_a_dance"; reason: string } | null {
  const lowerTitle = title.toLowerCase();

  // Check for bill phrase patterns
  const hasBillPhrase = checkBillPhrase(lowerTitle);

  // Check for online-account words
  const hasAccountWord = checkAccountWord(lowerTitle);

  // Both conditions must hold
  if (hasBillPhrase && hasAccountWord) {
    return {
      kind: "not_a_dance",
      reason: "bill-payment spam, not an event (D-857)",
    };
  }

  // Fortune-teller ads ("Vrai Marabout Voyant Compétent ... Paiement Après Résultat") (D-876).
  if (isFortuneTellerAd(title)) {
    return {
      kind: "not_a_dance",
      reason: "fortune-teller ad, not an event (D-876)",
    };
  }

  return null;
}

// A seer word plus an ad word, accents folded: "Voyant" alone (French "flashy") or "Marabout" alone stays.
function isFortuneTellerAd(title: string): boolean {
  const t = title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const seer =
    /\b(marabouts?|voyante?s?|voyance|medium|clairvoyants?|clairvoyance|psychics?|spell casters?|envoutements?)\b/;
  const ad =
    /\b(paiement|payment|resultats?|results?|competente?|puissante?|serieux|serieuse|retour (?:de l'etre aime|affectif)|etre aime|love spells?|lost love|ex back|whatsapp|garantie?s?|guaranteed)\b/;
  return seer.test(t) && ad.test(t);
}

function checkBillPhrase(lowerTitle: string): boolean {
  // Pattern 1: "bill" followed within 2 words by "pay", "payment", or "payments"
  // Use \S+ to match any non-whitespace characters (including punctuation)
  const pattern1 = /\bbill\b\s+(?:\S+\s+){0,2}\b(pay|payment|payments)\b/;

  // Pattern 2: "pay" or "paying" followed within 3 words by "bill" or "bills"
  // Using {0,4} to match examples like "Pay Your Xcel Energy Electric Bill" which has 4 words between
  const pattern2 = /\b(pay|paying)\b\s+(?:\S+\s+){0,4}\b(bill|bills)\b/;

  // Pattern 3: specific phrases
  const pattern3 = /\b(fast pay|guest pay|autopay|quick pay)\b/;

  // Pattern 4: "View Past Cox Bills Online", "Paperless Billing" (D-882)
  const pattern4 = /\bbills?\b\s+(?:\S+\s+)?(online|statements?)\b|\bpaperless billing\b/;

  return (
    pattern1.test(lowerTitle) ||
    pattern2.test(lowerTitle) ||
    pattern3.test(lowerTitle) ||
    pattern4.test(lowerTitle)
  );
}

function checkAccountWord(lowerTitle: string): boolean {
  // List of online-account words
  const accountWords = [
    "online",
    "portal",
    "login",
    "log in",
    "logging in",
    "account",
    "autopay",
    "balance",
    "guest payment",
    "billing",
    // "Spectrum Mobile App Bill Pay Guide - Fast & Hassle-Free Payments" (D-882)
    "app",
    "paperless",
    "statements?",
    "hassle-free",
  ];

  // Check for any of these words as whole words
  for (const word of accountWords) {
    const pattern = new RegExp(`\\b${word}\\b`);
    if (pattern.test(lowerTitle)) {
      return true;
    }
  }

  return false;
}
