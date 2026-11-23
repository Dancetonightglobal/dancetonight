// D-815: a title that cancels its own event is that event, cancelled; placeholder and bar-promo rows are screened
// Examples: "CANCELLED - Sunday Tango Classes with VANIA REY!!!", "CANCELLED TODAY ☆ AUSTIN TANGO PRACTICA",
// "■ THE PRACTICA GUIDE FOR TODAY IS N/A"

import { normalizeForMatch } from "@/config/styles";

const CANCELLATION_WORDS = new Set([
  "cancelled",
  "canceled",
  "postponed",
  "cancelado",
  "cancelada",
  "pospuesto",
  "pospuesta",
  "suspendido",
  "suspendida",
  "adiado",
  "adiada",
  "annule",
  "annulee",
  "reporte",
  "abgesagt",
]);

const TODAY_WORDS = new Set(["today", "tonight", "hoy", "hoje"]);

/**
 * D-835: the organiser's own "we cancel" anywhere in the title ("MICROOBERT SINESTESIA Cancelamos el
 * microabierto del día 11/11", Barcelona 2026-11-10). First-person forms only: they say this event is off.
 */
const WE_CANCEL_WORDS = new Set([
  "cancelamos",
  "suspendemos",
  "anulamos",
  "aplazamos",
  "adiamos",
  "cancellem",
  "suspenem",
  "ajornem",
  "annulons",
  "reportons",
]);

function stripPunctuation(text: string): string {
  // Remove punctuation and replace with space, then collapse whitespace
  return text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNormalizedTokens(title: string): string[] {
  // Catalan's "l·l" is one word ("Cancel·lem"), not two (D-835).
  const normalized = normalizeForMatch(title.replace(/l·l/giu, "ll"));
  const withoutPunct = stripPunctuation(normalized);
  return withoutPunct.split(/\s+/).filter((token) => token.length > 0);
}

export function cancelledByTitle(title: string): boolean {
  const tokens = getNormalizedTokens(title);
  if (tokens.length === 0) return false;

  // "we cancel" anywhere, with something else named (D-835)
  if (tokens.length >= 2 && tokens.some((token) => WE_CANCEL_WORDS.has(token))) return true;

  // Check opening form
  const firstToken = tokens[0] ?? "";
  if (CANCELLATION_WORDS.has(firstToken)) {
    // Check if there's at least one more token after optional today words
    let i = 1;
    while (i < tokens.length && TODAY_WORDS.has(tokens[i] ?? "")) {
      i++;
    }
    // If we have at least one token after the cancellation word (and optional today words)
    return i < tokens.length;
  }

  // Check closing form
  const lastToken = tokens.at(-1) ?? "";
  if (CANCELLATION_WORDS.has(lastToken)) {
    // There must be at least one token before the cancellation word
    return tokens.length >= 2;
  }

  return false;
}

// D-889: link text a calendar's button gave as the row's title ("Learn more here", Nashville Skinny Dennis).
const PLACEHOLDER_WHOLE = new Set([
  "tba",
  "tbd",
  "n a",
  "none",
  "learn more",
  "learn more here",
  "click here",
  "click for more",
  "info coming soon",
  "details coming soon",
  "more details soon",
]);
const PLACEHOLDER_ENDINGS = [
  "is n a",
  "is tba",
  "is tbd",
  "is none",
  "none today",
  "none tonight",
  "today tba",
  "tonight tba",
  "today n a",
  "tonight n a",
];

export function isPlaceholderTitle(title: string): boolean {
  const normalized = normalizeForMatch(title);
  const withoutPunct = stripPunctuation(normalized);

  // Check if whole title matches placeholder
  if (PLACEHOLDER_WHOLE.has(withoutPunct)) {
    return true;
  }

  // Check for ending patterns
  for (const ending of PLACEHOLDER_ENDINGS) {
    // Whole words only: "this n a" does not end with "is n a".
    if (` ${withoutPunct}`.endsWith(` ${ending}`)) {
      return true;
    }
  }

  return false;
}
