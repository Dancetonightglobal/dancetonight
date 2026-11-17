// Price parsing (SPEC section 3: prices[] {label, amount, currency, includes}). Pure.
//
// Sources state prices as text ("$15, $10 before 10pm", "Free", "€12 / 8 € réduit", "Donation")
// or as structured offers. Both end as `Price` rows. Rules:
// - An amount is only ever read from the text; a price the text does not state stays null.
// - The currency comes from the symbol or code in the text, else from the listing's own
//   currency field, else from the metro's country (a US feed that says "15" means dollars).
// - "Free" and "no cover" give one free row (amount 0); "donation", "pay what you can" and
//   "sliding scale" give a row with amount null and the words as its label.

import type { ListingPrice } from "@/src/domain/listing";

/** ISO 4217 currency of a country's everyday prices, for metros we plan to serve. */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: "USD",
  CA: "CAD",
  MX: "MXN",
  GB: "GBP",
  IE: "EUR",
  FR: "EUR",
  DE: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  PT: "EUR",
  AT: "EUR",
  FI: "EUR",
  CH: "CHF",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  PL: "PLN",
  CZ: "CZK",
  AU: "AUD",
  NZ: "NZD",
  JP: "JPY",
  KR: "KRW",
  BR: "BRL",
  AR: "ARS",
  CO: "COP",
  PE: "PEN",
  CL: "CLP",
  IN: "INR",
  SG: "SGD",
  HK: "HKD", // D-661
  ZA: "ZAR",
  IL: "ILS",
  TR: "TRY",
  LB: "LBP", // D-1001
  UY: "UYU",
  AE: "AED", // D-1061
  MA: "MAD", // D-1101
};

export function currencyForCountry(countryCode: string): string | null {
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] ?? null;
}

const SYMBOLS: Array<[RegExp, string]> = [
  [/US\$|\$US/i, "USD"],
  [/C\$|CA\$/i, "CAD"],
  [/A\$|AU\$/i, "AUD"],
  [/NZ\$/i, "NZD"],
  [/R\$/i, "BRL"],
  [/HK\$/i, "HKD"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/¥/, "JPY"],
  [/₩/, "KRW"],
  [/₹/, "INR"],
  [/₺/, "TRY"],
];

/** Currencies whose own sign is a bare $ */
const DOLLAR_SIGN_CURRENCIES = new Set(["MXN", "ARS", "COP", "CLP", "UYU"]);

const CODE =
  /\b(USD|CAD|AUD|NZD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|CZK|MXN|BRL|JPY|KRW|INR|SGD|HKD|ZAR|ARS|COP|CLP|UYU|PEN|AED|LBP)\b/i;

/** The currency a piece of text names, or null. A bare `$` is the fallback's dollar. */
/**
 * Local ways of writing a currency, rewritten before amounts are read: "HKD150" (Hong Kong, D-661) and
 * "INR1500" get a space so the code is a word; "Rs. 1,500", "Rs 1500" and "Rs.1500" (India, D-620) become
 * "₹1,500"; Indian lakh grouping "1,00,000" becomes "100,000".
 * Turkish lira (D-681): "400TL" -> "400 ₺" (any metro). In a TRY metro (fallback="TRY") also:
 * "400 TL" -> "400 ₺", "TL 400" -> "₺400", "TRY 400" -> "₺400", "400TRY" -> "400 ₺".
 * UAE dirham (D-1061): "AED150" -> "AED 150" (any metro). In an AED metro (fallback="AED") also:
 * "Dhs 150" -> "AED 150", "150Dhs" -> "150 AED", "Dh100" -> "AED 100", "150 درهم" -> "150 AED",
 * "د.إ 150" -> "AED 150".
 */
const localCurrencyText = (text: string, fallback: string | null = null) => {
  let result = text;
  // Turkish lira rewrites for any metro: glued TL after digit
  result = result.replace(/(\d)TL(?![A-Za-z])/g, "$1 ₺");
  // Additional rewrites only for TRY metro
  if (fallback === "TRY") {
    result = result
      .replace(/(\d)\s?(?:TL|₺)(?![A-Za-z])/g, "$1 ₺")
      .replace(/\bTL\s?(?=\d)/g, "₺")
      .replace(/\bTRY\s?(?=\d)/g, "₺")
      .replace(/(\d)\s?TRY\b/g, "$1 ₺");
  }
  // UAE dirham rewrites for any metro: glued AED after digit
  result = result.replace(/\b(HKD|INR|AED|LBP)(?=\d)/gi, "$1 ");
  // Additional rewrites only for AED metro
  if (fallback === "AED") {
    // Dhs, Dhs., DHS, Dh, Dh. before or after digits
    result = result
      .replace(/\b(Dhs?\.?|DHS)\s+(?=\d)/gi, "AED ")
      .replace(/(\d)\s*(Dhs?\.?|DHS)\b/gi, "$1 AED")
      .replace(/\b(Dh\.?)\s*(?=\d)/gi, "AED ")
      .replace(/(\d)\s*(Dh\.?)\b/gi, "$1 AED")
      // AED. -> AED
      .replace(/\bAED\.\s*(?=\d)/gi, "AED ")
      .replace(/(\d)\s*AED\.\b/gi, "$1 AED")
      // Arabic د.إ and درهم
      // \b is ASCII-only in JavaScript, so the Arabic forms use letter lookarounds.
      .replace(/(?<!\p{L})(?:د\.إ|درهم)\s*(?=\d)/gu, "AED ")
      .replace(/(\d)\s*(?:د\.إ|درهم)(?!\p{L})/gu, "$1 AED");
  }
  // Lebanese pound forms, only in an LBP metro (D-1001): "500,000 LL", "L.L. 500,000", "500,000 ل.ل"
  if (fallback === "LBP") {
    result = result
      .replace(/(\d)\s?L\.?L\.?(?![A-Za-z])/g, "$1 LBP")
      .replace(/\bL\.?L\.?\s?(?=\d)/g, "LBP ")
      .replace(/(\d)\s?ل\s*\.?\s*ل\.?/g, "$1 LBP")
      .replace(/ل\s*\.?\s*ل\.?\s*(?=\d)/g, "LBP ");
  }
  // Moroccan dirham forms, only in a MAD metro (D-1101)
  if (fallback === "MAD") {
    // Capital MAD is the dirham code only in a MAD metro and only beside an amount: "MAD PARTY" names no currency
    // and "MAD 2026" in New York is no price (D-1101).
    result = result.replace(/\bMAD\s?(?=\d)/g, "__MAD__ ").replace(/(\d)\s?MAD\b/g, "$1 __MAD__");
    // DH, Dh, dh, DHS, Dhs, dhs (with optional dot, space, glued)
    // Before number
    result = result
      .replace(/\b(DH\.?|Dh\.?|dh\.?|DHS\.?|Dhs\.?|dhs\.?)\s*(?=\d)/gi, "__MAD__ ")
      // After number
      .replace(/(\d)\s*(DH\.?|Dh\.?|dh\.?|DHS\.?|Dhs\.?|dhs\.?)(?!\p{L})/giu, "$1 __MAD__")
      // dirham/dirhams after number
      .replace(/(\d)\s*(dirham|dirhams)(?!\p{L})/giu, "$1 __MAD__")
      // Arabic درهم and د.م. (with optional final dot)
      // Before number
      .replace(/(?<!\p{L})(?:درهم|د\.م\.?)\s*(?=\d)/gu, "__MAD__ ")
      // After number
      .replace(/(\d)\s*(?:درهم|د\.م\.?)(?!\p{L})/gu, "$1 __MAD__");
  }
  // Convert uppercase MAD to a token to avoid case-insensitive matching
  // Existing rewrites
  return result
    .replace(/\/-(?=\s|$)/g, "") // Remove "/-" suffix
    .replace(/\bRs\.?\s?(?=\d)/gi, "₹")
    .replace(
      /\b(\d{1,2})((?:,\d{2})+),(\d{3})\b/g,
      (_m, head: string, mid: string, tail: string) => {
        const digits = head + mid.replace(/,/g, "") + tail;
        return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      },
    );
};

export function currencyInText(text: string, fallback: string | null): string | null {
  const local = localCurrencyText(text, fallback);
  // First check for MAD token
  if (local.includes("__MAD__")) return "MAD";
  const code = CODE.exec(local);
  if (code?.[1]) return code[1].toUpperCase();
  for (const [pattern, currency] of SYMBOLS) if (pattern.test(local)) return currency;
  if (/\$/.test(local)) {
    if (fallback && (fallback.endsWith("D") || DOLLAR_SIGN_CURRENCIES.has(fallback))) {
      return fallback;
    }
    return "USD";
  }
  return null;
}

const FREE = /\b(free|gratis|gratuit(e)?|kostenlos|no cover|free entry|entrée libre)\b/i;
// [iİı]: JavaScript never case-folds the Turkish dotted İ or dotless ı to i (D-681).
const FREE_TR =
  /(?<![\p{L}\p{N}])(ücrets[iİı]z|bedava|g[iİı]r[iİı]ş serbest|g[iİı]r[iİı]ş ücrets[iİı]z|g[iİı]r[iİı]şler ücrets[iİı]z|ücrets[iİı]z g[iİı]r[iİı]ş)(?![\p{L}\p{N}])/iu;
// Arabic free words (D-1061)
const FREE_AR =
  /(?<![\p{L}\p{N}])(مجاني|مجانا|مجانًا|دخول مجاني|الدخول مجاني|الدخول مجانا)(?![\p{L}\p{N}])/u;
const DONATION =
  /\b(donation|donations|pay what you (can|wish|want)|sliding scale|suggested donation|prix libre|a la gorra|hat)\b/i;

/** An amount with an optional currency symbol or code on either side. */
const AMOUNT =
  /(US\$|C\$|A\$|NZ\$|R\$|HK\$|[$€£¥₩₹₺]|\b(USD|CAD|AUD|NZD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|CZK|MXN|BRL|JPY|KRW|INR|SGD|HKD|ZAR|ARS|COP|CLP|UYU|PEN|AED|LBP)\b|__MAD__)?\s?(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)(?!\d)\s?([$€£¥₩₹₺]|\b(USD|CAD|AUD|NZD|EUR|GBP|CHF|SEK|NOK|DKK|PLN|CZK|MXN|BRL|JPY|KRW|INR|SGD|HKD|ZAR|ARS|COP|CLP|UYU|PEN|AED|LBP)\b|__MAD__)?/gi;

/** Two amounts joined by a dash or "to": a sliding scale, not two prices. */
const RANGE =
  /(?:US\$|C\$|A\$|NZ\$|R\$|HK\$|[$€£¥₩₹₺])?\s?\d{1,4}(?:[.,]\d{1,2})?\s?(?:[$€£¥₩₹₺])?\s?(?:-|–|—|\bto\b|\bà\b)\s?(?:US\$|C\$|A\$|NZ\$|R\$|HK\$|[$€£¥₩₹₺])?\s?\d{1,4}(?:[.,]\d{1,2})?/i;

/** Clock times ("10pm", "22h", "9:30") are never prices; they are masked before amounts are read. */
const CLOCK =
  /\b\d{1,2}(?::\d{2})?\s?(?:[ap]\.?m\.?|h\d{0,2})(?![a-z])|\b\d{1,2}:\d{2}\b|\b\d{1,2}(?:[.:]\d{2})?\s?(?:hs|hrs|h)\b|\b\d{1,2}\s*(?:hs|hrs)\b/gi;

/** Separators between price phrases; a comma inside "1,000" is not one. */
const SEPARATOR = /\s*(?:,(?!\d{3}(?!\d)|\d{1,2}(?:\s|$|[^0-9]))|[;/|\n]|\bor\b|\bou\b)\s*/i;

function toNumber(raw: string): number {
  // "1,000" and "1.000" are thousands; "15,50" and "15.50" are decimals.
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  return Number(raw.replace(",", "."));
}

/**
 * Parses a price phrase into rows. Each amount becomes one row labelled with the words around it
 * ("$15 door, $10 advance" gives Door 15 and Advance 10); a phrase with one amount and no words
 * is labelled "Entry". When the text carries a currency symbol anywhere, a bare number without
 * one is not read as a price ("$15, 2 drink minimum" is one row, not two).
 */
export function parsePriceText(text: string, fallbackCurrency: string | null): ListingPrice[] {
  const trimmed = localCurrencyText(text, fallbackCurrency).replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  const currency = currencyInText(trimmed, fallbackCurrency) ?? fallbackCurrency ?? "USD";
  const textHasSymbol = currencyInText(trimmed, null) !== null;

  const rows: ListingPrice[] = [];
  for (const part of trimmed
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const clocks: string[] = [];
    const masked = part.replace(CLOCK, (clock) => {
      clocks.push(clock);
      return `\u0000${clocks.length - 1}\u0000`;
    });
    const unmask = (value: string) =>
      value.replace(/\u0000(\d+)\u0000/g, (_, i: string) => clocks[Number(i)] ?? "");

    // A range ("$5-$20", "10 to 15 €") is one row with no single amount; the label keeps it.
    if (RANGE.test(masked)) {
      rows.push({ label: capitalise(part), amount: null, currency, includes: null });
      continue;
    }
    const matches = [...masked.matchAll(AMOUNT)].filter(
      // A bare number on a Lebanese page names no currency (D-1001).
      (m) =>
        m[3] && (!textHasSymbol || m[1] || m[4]) && (fallbackCurrency !== "LBP" || m[1] || m[4]),
    );
    if (matches.length === 0) {
      if (FREE.test(part) || FREE_TR.test(part) || FREE_AR.test(part))
        rows.push({ label: freeLabel(part), amount: 0, currency, includes: null });
      else if (DONATION.test(part))
        rows.push({ label: capitalise(part), amount: null, currency, includes: null });
      continue;
    }
    for (const match of matches) {
      const amount = toNumber(match[3] ?? "");
      if (!Number.isFinite(amount)) continue;
      const words = unmask(masked.replace(match[0], " "))
        .replace(
          /[$€£¥₩₹₺]|\b(USD|EUR|GBP|CAD|AUD|MXN|ARS|COP|CLP|UYU|PEN|BRL|HKD|AED)\b|__MAD__/gi,
          " ",
        )
        .replace(/\s+/g, " ")
        .trim();
      rows.push({ label: words ? capitalise(words) : "Entry", amount, currency, includes: null });
    }
  }

  if (rows.length === 0 && (FREE.test(trimmed) || FREE_TR.test(trimmed) || FREE_AR.test(trimmed))) {
    rows.push({ label: "Free", amount: 0, currency, includes: null });
  }
  return dedupeRows(rows);
}

/** "Free" alone stays "Free"; "Free before 11pm" keeps its condition. */
function freeLabel(part: string): string {
  const trimmed = part.trim();
  if (
    /^(free|no cover|gratis|gratuit|kostenlos)$/i.test(trimmed) ||
    /^(ücrets[iİı]z|bedava|g[iİı]r[iİı]ş serbest|g[iİı]r[iİı]ş ücrets[iİı]z|g[iİı]r[iİı]şler ücrets[iİı]z|ücrets[iİı]z g[iİı]r[iİı]ş)$/iu.test(
      trimmed,
    ) ||
    /^(مجاني|مجانا|مجانًا|دخول مجاني|الدخول مجاني|الدخول مجانا)$/u.test(trimmed)
  ) {
    return "Free";
  }
  return capitalise(part);
}

/** Rows from structured prices whose currency may be missing. Amounts below zero are dropped. */
export function normalizePrices(
  prices: ReadonlyArray<{
    label: string;
    amount: number | null;
    currency: string | null;
    includes: string | null;
  }>,
  fallbackCurrency: string | null,
): ListingPrice[] {
  const rows: ListingPrice[] = [];
  for (const price of prices) {
    if (price.amount !== null && (!Number.isFinite(price.amount) || price.amount < 0)) continue;
    const currency = (price.currency ?? fallbackCurrency ?? "").toUpperCase();
    if (currency.length !== 3) continue;
    rows.push({
      label: price.label.trim() || "Entry",
      amount: price.amount,
      currency,
      includes: price.includes,
    });
  }
  return dedupeRows(rows);
}

/** True when every row is free, false when any row costs money, null when no row says. */
export function isFreeFromPrices(prices: readonly ListingPrice[]): boolean | null {
  if (prices.length === 0) return null;
  if (prices.some((p) => p.amount !== null && p.amount > 0)) return false;
  if (prices.every((p) => p.amount === 0)) return true;
  return null;
}

function capitalise(text: string): string {
  const clean = text.replace(/^[-–:\s]+|[-–:\s]+$/g, "");
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "Entry";
}

function dedupeRows(rows: ListingPrice[]): ListingPrice[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label.toLowerCase()}|${row.amount}|${row.currency}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
