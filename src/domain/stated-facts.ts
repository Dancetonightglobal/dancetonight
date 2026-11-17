// A model read's facts other than its times, checked against the listing's own part of the page
// (D-100): the part D-081 reads times from (`titleBlocks`, `ownBlockTexts`), which a ticket link
// does not end (`titleBlocks`' `facts` option) and which leaves out the words before the title on
// its line. A fact the part does not write is dropped; a price the part writes under other words
// is filed under the page's; one end of a range the part writes is listed as the range. Kept facts
// carry the page's own clause as their evidence. Pure: no I/O, no model call. Prices, free entry
// and the age limit for now; the other facts follow (D-100).

import { EVIDENCE_MAX_CHARS, type RawListing } from "@/src/domain/listing";
import { priceRangeLabel } from "@/src/domain/price-range";
import { currencyInText } from "@/src/domain/prices";
import { foldForMatch } from "@/src/domain/text-facts";
import { getDomain, getDomainWithoutSuffix } from "tldts";

export type FactField =
  | "prices"
  | "is_free"
  | "age_min"
  | "cancelled"
  | "indoor_outdoor"
  | "floor"
  | "dress_code"
  | "crowd_size_hint"
  | "level"
  | "partner_required"
  | "music"
  | "organizer";

export interface FactChange {
  field: FactField;
  /** dropped: not written; relabelled: filed under the page's words; ranged: listed as a range. */
  kind: "dropped" | "relabelled" | "ranged";
  detail: string;
}

// ---------------------------------------------------------------------------------------------
// Text as the checks read it

/** A link target as cleanPageText writes it (`label [https://…]`), or a URL printed as text. */
const LINK = /\[https?:\/\/[^\]\s]*\]|https?:\/\/[^\s[\]<>"'()]+/g;

/**
 * The text with its link targets blanked out (a URL's digits are no price, and its words no tier),
 * curly quotes folded ("don’t" reads as "don't"), and a Markdown-escaped dollar ("\$30") read as
 * one. Lengths are kept, so offsets still point into the page's own words.
 */
export function plainText(text: string): string {
  return text
    .replace(LINK, (m) => " ".repeat(m.length))
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\\\$/g, " $");
}

// ---------------------------------------------------------------------------------------------
// Money

/** Clock times ("10pm", "22h", "9:30") are never money; they are blanked before amounts are read. */
const CLOCK = /\b\d{1,2}(?::\d{2})?\s?(?:[ap]\.?m\.?|h\d{0,2})(?![a-z])|\b\d{1,2}:\d{2}\b/gi;
const PRE = String.raw`(?:US\$|C\$|A\$|NZ\$|R\$|[$€£¥₩₹]|\b(?:USD|EUR|GBP|CAD|AUD|CHF)\s?)`;
const POST = String.raw`(?:\s?[$€£¥₩₹円원]|\s?(?:USD|EUR|GBP|CAD|AUD|CHF|dollars?|euros?|kr|zł|Ft|Kč)(?![\p{L}\p{N}]))`;
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,5}(?:[.,]\d{1,2})?)`;
const CONNECT = String.raw`\s*(?:-|–|—|\bto\b)\s*`;
/** A count or a length after a number: "$10 - 45 minute lesson" is no range up to $45. */
const COUNT_AFTER = String.raw`(?!\s*(?:min|mins|minutes?|hrs?|hours?|djs?|people|couples|dancers|songs|years?|yrs?|sets?|pp)\b)`;

const toNumber = (raw: string): number =>
  /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw)
    ? Number(raw.replace(/,/g, ""))
    : Number(raw.replace(",", "."));

export interface MoneyMention {
  amount: number;
  /** Both ends, when the page writes this amount as one end of a range ("$20-25"). */
  range: [number, number] | null;
  start: number;
  end: number;
  /** The words of the mention as written ("$20-25"), for its currency. */
  text: string;
}

/**
 * Every amount of money a text writes: an amount with a currency mark before or after it ("$15",
 * "10$", "€12", "15 dollars", "¥3,000"), a range of two such amounts ("$20-25", "$10 to $20",
 * "20-25 €"), and a second amount slashed onto one ("$15/20"). A bare number is never money, a
 * clock time never is, and neither is a saving ("$5 off", "a $5 discount").
 */
export function moneyMentions(text: string): MoneyMention[] {
  const masked = plainText(text)
    .replace(CLOCK, (m) => " ".repeat(m.length))
    // A cleaning artifact splits an amount's digits ("$1 0" on CDNY's page): one amount, as the
    // model reads it, when nothing follows but the line's end or a mark. The space moves after it,
    // so offsets still hold; "$5 2 drink min" stays $5.
    .replace(/([$€£¥₩₹]\s?\d) (\d)(?=\s*(?:$|[.,;:)!/]))/gu, "$1$2 ");
  const out: MoneyMention[] = [];
  const taken: Array<[number, number]> = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  const add = (start: number, end: number, amount: number, range: [number, number] | null) => {
    if (/^\s*(?:off|discount)\b/i.test(masked.slice(end))) return;
    out.push({ amount, range, start, end, text: text.slice(start, end) });
  };
  const scan = (source: string, each: (m: RegExpExecArray) => void) => {
    const re = new RegExp(source, "giu");
    for (let m = re.exec(masked); m; m = re.exec(masked)) each(m);
  };
  const ranges = [
    String.raw`${PRE}\s?(${NUM})${CONNECT}${PRE}?\s?(${NUM})(?![\d.,]*\d)${COUNT_AFTER}`,
    String.raw`(?<![\d.,])(${NUM})${CONNECT}(${NUM})${POST}`,
  ];
  for (const source of ranges) {
    scan(source, (m) => {
      const [lo, hi] = [toNumber(m[1]!), toNumber(m[2]!)];
      const [a, b] = [m.index, m.index + m[0].length];
      if (!(hi > lo) || !free(a, b)) return;
      taken.push([a, b]);
      add(a, b, lo, [lo, hi]);
      add(a, b, hi, [lo, hi]);
    });
  }
  scan(String.raw`${PRE}\s?(${NUM})\/(${NUM})(?![\d.,]*\d)${COUNT_AFTER}`, (m) => {
    const [a, b] = [m.index, m.index + m[0].length];
    if (!free(a, b)) return;
    taken.push([a, b]);
    const split = a + m[0].lastIndexOf("/");
    add(a, split, toNumber(m[1]!), null);
    add(split + 1, b, toNumber(m[2]!), null);
  });
  for (const source of [
    String.raw`${PRE}\s?(${NUM})(?![\d.,]*\d)`,
    String.raw`(?<![\d.,])(${NUM})${POST}`,
  ]) {
    scan(source, (m) => {
      const [a, b] = [m.index, m.index + m[0].length];
      if (!free(a, b)) return;
      taken.push([a, b]);
      add(a, b, toNumber(m[1]!), null);
    });
  }
  return out.sort((x, y) => x.start - y.start);
}

// ---------------------------------------------------------------------------------------------
// Clauses: where a price's own words are

/**
 * A line is cut into clauses at " / ", " // ", ";", " | ", "·" and a sentence's end, never inside
 * a parenthesis: "plus Late Night after 10pm ($20 / door only)" is one clause.
 */
const CLAUSE_CUT = /\s\/\/?\s|;|\s\|\s|·|(?<=[.!?])\s+(?=\S)/g;

interface Clause {
  /** The clause as the page writes it, trimmed. */
  text: string;
  /** The line above the clause's line (its heading when it ends with ":"), or "". */
  above: string;
  /**
   * For a clause after the first on its line, the words that open the line before a colon and
   * its first amount ("Full-time Students: $10 (one dance); $15 (both dances)" gives the $15 its
   * tier), or "" (D-102 review).
   */
  lineLead: string;
  money: MoneyMention[];
}

/**
 * The words before a line's first colon, when its first amount follows the colon directly
 * ("Full-time Students: $10 ..."): the line's heading. Never a time, a link, a note or a host
 * ("Doors: 7:30pm", "Note: ...", "Hosted by Ana:"), nor anything `tierName` refuses.
 */
function lineHeading(line: string): string {
  const colon = line.indexOf(":");
  if (colon <= 0) return "";
  const head = line.slice(0, colon).trim();
  const first = moneyMentions(line)[0];
  if (!first || first.start < colon) return "";
  if (/\p{L}/u.test(plainText(line.slice(colon + 1, first.start)))) return "";
  if (/\d|https?|www\./i.test(head)) return "";
  if (
    /^(?:doors?|note|notes|hosted|host|by|when|where|location|venue|time|date|info)\b/i.test(head)
  )
    return "";
  return head.split(/\s+/).length <= LABEL_MAX_WORDS ? head : "";
}

/** Whether a clause names nothing of its own besides its amounts and their parentheses. */
const bareClause = (text: string) =>
  !/\p{L}/u.test(
    plainText(text)
      .replace(/\([^)]*\)/g, " ")
      .replace(new RegExp(`${PRE}|${POST}`, "giu"), " "),
  );

function clausesOf(texts: readonly string[]): Clause[] {
  const out: Clause[] = [];
  for (const t of texts) {
    let above = "";
    for (const line of t.split("\n")) {
      if (!line.trim()) continue;
      const depth = (at: number) =>
        (line.slice(0, at).match(/\(/g)?.length ?? 0) -
        (line.slice(0, at).match(/\)/g)?.length ?? 0);
      const cuts = [...line.matchAll(CLAUSE_CUT)]
        .filter((m) => depth(m.index) <= 0)
        .map((m) => [m.index, m.index + m[0].length] as const);
      let from = 0;
      // The heading carries over ";", "/" and "|", never past a sentence's end.
      let heading = lineHeading(line);
      for (const [cut, next] of [...cuts, [line.length, line.length] as const]) {
        const text = line.slice(from, cut).trim();
        const lineLead = from > 0 && bareClause(text) ? heading : "";
        if (/[.!?]\s*$/.test(line.slice(from, cut))) heading = "";
        from = next;
        if (text) out.push({ text, above, lineLead, money: moneyMentions(text) });
      }
      above = line.trim();
    }
  }
  return out;
}

/** Word forms compared: folded, "non-members" as one word, a plural as its singular. */
function wordsOf(text: string): string[] {
  return foldForMatch(plainText(text).replace(/\bnon[\s-]+(?=\p{L})/giu, "non"))
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** Words that name no tier: a label of only these makes no claim the page could contradict. */
const FILLER = new Set(
  wordsOf("price prices ticket tickets entry entrance admission cover cost fee fees charge"),
);
/** Words a label may carry around its tier ("at the door", "for students"). */
const STOP = new Set(wordsOf("for the a an and at in of per with w is only"));

/** Where a free entry is had: a free price under only these words is free entry. */
const DOOR = new Set(wordsOf("door doors"));
/** A label's words that say who pays or when; empty when it says nothing a page could deny. */
const claimWords = (label: string) => wordsOf(label).filter((w) => !FILLER.has(w) && !STOP.has(w));

/** Words a page writes over a list rather than beside one amount ("INDIVIDUAL TICKETS:"). */
const GENERIC_HEADING = new Set([
  "price",
  "prices",
  "pricing",
  "ticket",
  "tickets",
  "individual tickets",
  "cost",
  "fee",
  "fees",
  "rates",
  "cover",
  "location",
  "where",
  "when",
  "time",
  "date",
  "venue",
  "address",
  "info",
  "details",
]);

/** Between two amounts with no comma: whose are the words? The previous one's on a list that writes amounts first. */
const amountsFirst = (clause: Clause) =>
  clause.money.length > 0 &&
  !/\p{L}/u.test(plainText(clause.text.slice(0, clause.money[0]!.start)));

/**
 * The words of a clause that are one amount's own. Between two amounts, a comma divides them
 * ("Advance $15, door $20": door is $20's); with none, they are the earlier amount's where the
 * clause writes amounts first ("$15 door $20 advance") and the later one's otherwise. A parenthesis
 * is its amount's: "$15 ($10 w/ student ID) for DJ nights" gives $10 "w/ student ID" and $15 the
 * words after the parenthesis.
 */
function spanOf(clause: Clause, i: number): { before: string; after: string; inParens: boolean } {
  const m = clause.money[i]!;
  // Two mentions of one range share their place: step past the other end.
  const prev = clause.money.filter((x) => x.end <= m.start).at(-1);
  const next = clause.money.find((x) => x.start >= m.end);
  const t = clause.text;
  const first = amountsFirst(clause);
  let before = t.slice(prev?.end ?? 0, m.start);
  let after = t.slice(m.end, next?.start ?? t.length);
  const open = before.lastIndexOf("(");
  const inParens = open > before.lastIndexOf(")");
  if (inParens) {
    // A parenthesis that holds only the amount is the words' before it: "Late Night after 10pm
    // ($20 / door only)".
    before = /\p{L}/u.test(before.slice(open + 1)) ? before.slice(open + 1) : before.slice(0, open);
    const close = after.indexOf(")");
    if (close >= 0) after = after.slice(0, close);
    return { before, after, inParens };
  }
  const close = next && /^\s*\(\s*$/.test(after) ? t.indexOf(")", next.end) : -1;
  if (close >= 0) {
    const beyond = clause.money.find((x) => x.start > close);
    after = t.slice(close + 1, beyond?.start ?? t.length);
  } else if (next) {
    const comma = after.indexOf(",");
    after = comma >= 0 ? after.slice(0, comma) : first ? after : "";
  }
  before = before.replace(/^[^(]*\)/, " ");
  if (prev) {
    const comma = before.lastIndexOf(",");
    before = comma >= 0 ? before.slice(comma + 1) : first ? "" : before;
  }
  after = after.replace(/\([^)]*$/, " ");
  return { before, after, inParens };
}

/** The words a tier name keeps: no leading "for", dash or colon, no trailing punctuation. */
const tidy = (s: string) =>
  plainText(s)
    .replace(/[^\p{L}\p{N}$)]+$/gu, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^for\s*:?\s+/i, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Words that are no label: a list line's clock ("12a") or the listing's own title. */
function withoutTitle(words: string, title: string): string {
  const own = foldForMatch(title);
  // A list line's clock before its title ("12a El Baile $20") is no word of a tier.
  let out = words.replace(/^\s*\d{1,2}(?::\d{2})?\s?[ap]\b\.?/i, " ");
  if (own && foldForMatch(out).includes(own)) {
    out = out.replace(
      new RegExp(
        own
          .split(" ")
          .map(escape)
          .join(String.raw`[^\p{L}\p{N}]+`),
        "iu",
      ),
      " ",
    );
  }
  return tidy(out);
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** At most this many words make a tier name; more is a sentence, not a label. */
const LABEL_MAX_WORDS = 6;

const MONTH_OR_DAY =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i;
const PLACE =
  /\b(?:manhattan|brooklyn|queens|bronx|staten island|harlem)\b|^\d+\s+\S+.*\b(?:st|street|ave|avenue|rd|road|blvd|pl|place|fl|floor)\b/i;
const URLISH = /\.[a-z]{2,}\b|\/|@/i;

/**
 * Whether words can name a tier: letters, at most LABEL_MAX_WORDS, and not a date, a weekday, a
 * time, a place, a link, a person or a venue ("with DJ Joe", "at Club Cache"), or another title.
 */
function tierName(s: string, others: readonly string[]): string | null {
  if (!/\p{L}/u.test(s) || s.split(/\s+/).length > LABEL_MAX_WORDS) return null;
  if (/^(?:free|gratis)$/i.test(s)) return null;
  if (MONTH_OR_DAY.test(s) || PLACE.test(s) || URLISH.test(s)) return null;
  // Times alone ("9pm–2am") name no tier; "before 10pm" does.
  if (!/\p{L}/u.test(s.replace(/\d{1,2}(?::\d{2})?\s?[ap]\.?m\.?/gi, ""))) return null;
  if (/^(?:at|with|by|featuring|feat|w)\b/i.test(s)) return null;
  const f = foldForMatch(s);
  if (others.some((o) => foldForMatch(o) === f)) return null;
  return s;
}

/**
 * The page's own name for one amount: the words before it on its clause (after a colon: "Tickets:
 * General Admission $50" is General Admission; before it: "Admission: $20" is Admission), unless
 * those are a generic heading ("INDIVIDUAL TICKETS: $25 Early Bird" is Early Bird); else the words
 * after it, up to a comma, a dash between words or a parenthesis ("$15 for: General Public"); else
 * a heading line above ending ":". Null when the page names it nothing a tier can be (`tierName`).
 */
function pageLabel(
  clause: Clause,
  i: number,
  title: string,
  others: readonly string[],
): string | null {
  const span = spanOf(clause, i);
  const before = plainText(span.before);
  const parts = before.split(":");
  const lastPart = parts.at(-1) ?? "";
  const lead = withoutTitle(
    /\p{L}/u.test(lastPart) || parts.length === 1 ? lastPart : (parts.at(-2) ?? ""),
    title,
  );
  // The words after an amount, up to a comma, a dash between words or a note in parentheses; a
  // parenthesis straight after the amount is its name ("$15 (both dances)"), and one naming
  // another amount is skipped.
  const rest = plainText(span.after)
    .replace(/^\s*[–—-]\s*/, " ")
    .replace(/^\s*\([^)]*\d[^)]*\)/, " ");
  const paren = /^\s*\(([^)]*)\)/.exec(rest);
  const trail = withoutTitle(
    paren && !/\d/.test(paren[1]!) ? paren[1]! : rest.split(/,|\s[–—-]\s|\(/)[0]!,
    title,
  );
  const generic = (s: string) => GENERIC_HEADING.has(foldForMatch(s));
  const heading = clause.above.trim().endsWith(":") ? tidy(clause.above) : "";
  const lineLead = tidy(clause.lineLead);
  const candidates = span.inParens
    ? [trail, lead]
    : [
        generic(lead) ? "" : lead,
        generic(lineLead) ? "" : lineLead,
        trail,
        generic(heading) ? "" : heading,
      ];
  for (const c of candidates) {
    const label = tierName(tierWord(c), others);
    if (label) return label;
  }
  return null;
}

/** "at the door" and "door price" are the door price, "in advance" the advance one (cardPrice). */
function tierWord(label: string): string {
  if (/^(?:at the door|door price|doors?)$/i.test(label)) return "door";
  if (/^(?:in advance|advance tickets?|advance)$/i.test(label)) return "advance";
  return label;
}

/**
 * Headings a page writes over several tiers: a read that gives one as a price's label ("$39
 * INDIVIDUAL TICKETS") names no tier, and the price is filed under the tier beside its amount.
 */
const HEADING_LABEL = new Set([
  "individual tickets",
  "ticket prices",
  "pricing",
  "prices",
  "rates",
]);

/** Whether a label's claim is in one mention's own words, or a heading line above ending ":". */
function labelWrittenAt(label: string, clause: Clause, i: number): boolean {
  if (HEADING_LABEL.has(foldForMatch(label))) return false;
  const claim = claimWords(label);
  if (claim.length === 0) return true;
  const { before, after } = spanOf(clause, i);
  const here = new Set([
    ...wordsOf(`${before} ${after} ${clause.lineLead}`),
    ...(clause.above.trim().endsWith(":") ? wordsOf(clause.above) : []),
  ]);
  return claim.every((w) => here.has(w));
}

// ---------------------------------------------------------------------------------------------
// Free entry

/** "free" as a word of its own: not "scent-free", "step-free" or "smoke-free". */
const FREE = String.raw`(?<![\p{L}-])(?:free|gratis)(?![\p{L}-])`;

/** Free entry to the night: "Admission: Free", "free entry", "No cover", "This event is free". */
const ENTRY_FREE = [
  new RegExp(String.raw`^${FREE}\s*[!.]?$`, "iu"),
  new RegExp(
    String.raw`\b(?:admission|entry|entrance|cover|price|cost|tickets?|fee)\s*(?:is|:|–|-|—)?\s*${FREE}`,
    "iu",
  ),
  new RegExp(
    String.raw`${FREE}\s+(?:entry\b|admission\b|entrance\b|event\b|of charge\b|to attend\b|and open to\b|with rsvp\b)`,
    "iu",
  ),
  new RegExp(
    String.raw`\b(?:event|social|dance|party|milonga|practica|night|it|this)\s+(?:is|are)\s+${FREE}`,
    "iu",
  ),
  /\bno cover\b|\bentrada libre\b|\beintritt frei\b|\bentr[ée]e libre\b/i,
  /^(?:(?:admission|entry|entrance|cover|the event|the dance|this event is|it'?s)\b[^.]{0,12})?no (?:charge|cost)\b/i,
  // A donation note after it: "Free ~ $5 donation", "Free ($10 donation suggested)".
  new RegExp(String.raw`^${FREE}\s*[~(]`, "iu"),
];

/** Free for one tier only: "FREE for Stepping Out Studios students", "Children Under 10 – FREE". */
const TIER_FREE = [
  new RegExp(String.raw`${FREE}\s+for\b`, "iu"),
  new RegExp(String.raw`[–—:-]\s*${FREE}\s*[!.]?$`, "iu"),
];

/** A free thing that is not the night: a lesson, parking, a coat check, a drink, a raffle prize. */
const NOT_ENTRY =
  /\b(?:lessons?|class(?:es)?|workshops?|intro|parking|coat|check|drinks?|snacks?|water|raffle|prizes?|masks?|tastings?|wifi|shots?)\b/i;

/** What a clause writes about free entry: the night's, one tier's, or none. */
function freeKind(clauseText: string): "entry" | "tier" | null {
  const text = plainText(clauseText).trim();
  if (ENTRY_FREE.some((re) => re.test(text))) return "entry";
  if (TIER_FREE.some((re) => re.test(text)) && !NOT_ENTRY.test(text)) return "tier";
  return null;
}

/** Whether a text writes that entry to the night is free, in any of its clauses. */
export function writesFree(text: string): boolean {
  return clausesOf([text]).some((c) => freeKind(c.text) === "entry");
}

/** Words beside an amount that ask for money without charging it: a donation, a tip. */
const DONATION = /\b(?:donat\w*|suggest\w*|tips?|pay what|sliding scale|optional)\b/i;

/** Amounts the part charges: every amount above 0 not beside a donation or tip word. */
function charges(clauses: readonly Clause[]): boolean {
  return clauses.some((c) =>
    c.money.some((m, i) => {
      if (m.amount <= 0) return false;
      // Only the words up to a comma either side: "$20 after 11pm, optional coat check" charges.
      const { before, after } = spanOf(c, i);
      const near = `${before.split(",").at(-1) ?? ""} ${after.split(",")[0] ?? ""}`;
      return !DONATION.test(plainText(near));
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Age

/** The bar's rule, not the night's age limit: "21+ to drink", "21+ to be served", "21+ wristband". */
const BAR_AFTER =
  /^\s*\+?\s*(?:only\s+)?(?:(?:to|for)\s+(?:drink|alcohol|consume|be served|buy|purchase|the bar|drinks)|wristband|with id for (?:drinks|the bar))/i;
const BAR_BEFORE = /\b(?:bar|drinks?|alcohol)\b[^.;\n]{0,12}$/i;
/** A number counting something else: "over 21 years of swing", "at least 18 couples". */
const NOT_AN_AGE =
  /^\s*(?:\+\s*)?(?:years?|yrs?|hours?|hrs?|minutes?|mins?|couples?|people|dancers?|guests?|songs?|djs?|bands?|times?)\b/i;
/** "Seniors 65+ $10": a price tier, not an age limit. */
const PRICE_AFTER = /^\s*[:–—-]?\s*(?:[$€£]\s?\d|\d+\s?[$€£])/;

/**
 * Whether a text writes an age limit of `age` (0: all ages): "21+", "18 and over", "21-and-over",
 * "over 21", "over-21", "ages 18", "must be 21", "minimum age 18", "no one under 21"; never the
 * bar's rule ("21+ to drink", "Bar: 21+"), a count ("over 21 years") or a price tier ("Seniors 65+
 * $10"). All ages: "all ages", "all-ages", "any age", "no age limit".
 */
export function writesAge(age: number, text: string): boolean {
  return ageClause(age, text) !== null;
}

function ageClause(age: number, text: string): string | null {
  const plain = plainText(text);
  if (age === 0) {
    const m = /\ball[\s-]+ages?\b|\bany age\b|\bno age (?:limit|restriction)s?\b/i.exec(plain);
    return m ? lineAround(text, m.index) : null;
  }
  const n = String(age);
  const re = new RegExp(
    [
      String.raw`(?<![\d.,$])${n}\s*\+`,
      String.raw`(?<![\d.,$])${n}\s*(?:years?|yrs?)?\s*(?:old\s*)?(?:and|&|or|-and-)\s*(?:over|up|older)\b`,
      String.raw`\b(?:over|ages?|must be|minimum age(?: of)?|at least)\s*[:-]?\s*${n}(?![\d.,]*\d)`,
      String.raw`\b(?:no one|no-one|nobody|none)\s+under\s+${n}(?![\d.,]*\d)`,
    ].join("|"),
    "gi",
  );
  for (let m = re.exec(plain); m; m = re.exec(plain)) {
    const after = plain.slice(m.index + m[0].length);
    const before = plain.slice(0, m.index);
    if (BAR_AFTER.test(after) || BAR_BEFORE.test(before)) continue;
    if (NOT_AN_AGE.test(after) || PRICE_AFTER.test(after)) continue;
    return lineAround(text, m.index);
  }
  return null;
}

/** The page's line around an offset, as an evidence quote. */
function lineAround(text: string, at: number): string {
  const start = text.lastIndexOf("\n", at) + 1;
  const end = text.indexOf("\n", at);
  return plainText(text.slice(start, end < 0 ? text.length : end))
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// The place and the crowd: indoor or outdoor, the floor, the dress code, the crowd (D-102)

/** The sentences of a part: lines cut at a sentence's end, ";" and " | " (what one claim spans). */
function sentencesOf(text: string): string[] {
  return plainText(text)
    .split(/\n|(?<=[.!?])\s+|;|\s\|\s/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** A shoe or a floor-care word in the same sentence: "No outdoor shoes", "indoor-only soles". */
const SHOE_WORD = /\b(?:shoes?|footwear|sneakers?|soles?|soled|heels|boots)\b/i;
/** A negation just before: "not indoors this time", "no outdoor". */
const NEGATED_BEFORE = /\b(?:no|not|never|without|n't)\b(?:\W+\w+){0,2}\W*$/i;
/** Rain plans move an outdoor night indoors: "In case of rain, the dance moves indoors". */
const RAIN_PLAN =
  /\b(?:in case of rain|if it rains|rain location|rain plan|bad weather|inclement)\b/i;
const INDOOR = /\bindoors?\b/gi;
const OUTDOOR = /\boutdoors?\b|\bopen[\s-]air\b|\bal fresco\b|\brain or shine\b|\brain date\b/gi;

/**
 * The page's sentence that says the night is indoors or outdoors with `words`, or null: never a
 * shoe rule ("No outdoor shoes on the dance floor", "Outdoor-soled shoes are not allowed"), never
 * negated ("Not indoors this time!"), and for indoors never a rain plan ("In case of rain, the
 * dance moves indoors").
 */
function placeSentence(text: string, words: RegExp, indoor: boolean): string | null {
  for (const sentence of sentencesOf(text)) {
    if (SHOE_WORD.test(sentence)) continue;
    if (indoor && RAIN_PLAN.test(sentence)) continue;
    for (const m of sentence.matchAll(words)) {
      if (NEGATED_BEFORE.test(sentence.slice(0, m.index))) continue;
      return sentence;
    }
  }
  return null;
}

/**
 * The page's sentence that says the night is indoors, outdoors or both (D-084 question 6: shown
 * only when the listing's own page says so): "indoor(s)"; "outdoor(s)", "open-air", "al fresco",
 * "rain or shine", "rain date"; both needs both. Never a shoe rule, a negation or a rain plan
 * (`placeSentence`), and never a guess from the venue (a park, a plaza, a rooftop).
 */
export function indoorOutdoorClause(
  value: "indoor" | "outdoor" | "both",
  text: string,
): string | null {
  const inside = placeSentence(text, INDOOR, true);
  const outside = placeSentence(text, OUTDOOR, false);
  if (value === "indoor") return inside;
  if (value === "outdoor") return outside;
  return inside && outside ? (inside === outside ? inside : `${inside} / ${outside}`) : null;
}

/** Words a value may carry that are no claim of its own: "floor" in "sprung floor", "code". */
const PLAIN_WORDS = new Set(
  wordsOf("the and for with floor floors dance code dress attire is a an of please very"),
);

/**
 * The page's sentence that writes a value (its words of three letters or more, not `PLAIN_WORDS`,
 * and every number, in order and next to each other), not negated just before ("no formal attire
 * required"), with a cue word of its kind that is not one of the value's own words; null when none
 * does, or the value has no such word. `skip` blanks words that only look like a cue ("2nd floor").
 */
function wordsSentence(value: string, text: string, cue: RegExp, skip?: RegExp): string | null {
  const own = wordsOf(value).filter((w) => (w.length >= 3 || /\d/.test(w)) && !PLAIN_WORDS.has(w));
  if (own.length === 0) return null;
  const phrase = new RegExp(
    String.raw`(?:^| )${own.map(escape).join(String.raw`(?: \S+){0,2} `)}(?= |$)`,
  );
  for (const sentence of sentencesOf(text)) {
    const folded = ` ${wordsOf(sentence).join(" ")} `;
    const m = phrase.exec(folded);
    if (!m) continue;
    const before = folded.slice(0, m.index);
    if (/\b(?:no|not|never|without|nt)(?:\s+\S+){0,2}\s*$/.test(before)) continue;
    const cued = (skip ? sentence.replace(skip, " ") : sentence).replace(
      new RegExp(String.raw`\b(?:${own.map(escape).join("|")})\w*\b`, "gi"),
      " ",
    );
    if (cue.test(cued)) return sentence;
  }
  return null;
}

/** A floor word: "sprung dance floor", "wood floors", "dance space with smooth cement". */
const FLOOR_CUE =
  /\bfloors?\b|\bsprung\b|\bwood\w*\b|\bdance space\b|\bsurface\b|\bcement\b|\bconcrete\b|\btiled?\b|\bmarley\b|\bparquet\b|\bhardwood\b/i;
/** "2nd floor", "Wood St": a storey or a street, not a surface. */
const NOT_A_SURFACE =
  /\b\d+(?:st|nd|rd|th)\s+floors?\b|\b\w+\s+(?:st|street|ave|avenue|rd|road|blvd|pl|place)\b/gi;
/** A floor value that is a storey: "2nd floor", "ground floor", "basement". */
const STOREY = /^(?:\d+(?:st|nd|rd|th)|ground|top|first|second|third|upper|lower|basement)\b/i;
/** A dress word ("Dress: casual", "vintage attire encouraged"); "wear" alone is a mask or shoes. */
const DRESS_CUE =
  /\bdress(?:ed|\s*code)?\b|\battire\b|\boutfits?\b|\bcostumes?\b|\bclothes\b|\bclothing\b/i;
/** "No dress code", "Dress code: none": a fact of its own. */
const NO_DRESS_CODE = /\bno dress code\b|\bdress code\s*[:-]?\s*none\b/i;
/** A crowd word: "a crowd of 200", "up to 80 dancers". */
const CROWD_CUE = /\bcrowd\b|\bpeople\b|\bdancers\b|\bguests\b|\battendees\b|\bcapacity\b/i;

/**
 * The page's sentence that writes a crowd: with a number, its words where a crowd word is written
 * ("Room for 80 people"); without one, a word of its own beside a crowd word ("an intimate crowd"),
 * never a crowd word alone ("Dancers of all levels welcome" is no crowd of dancers).
 */
function crowdSentence(value: string, text: string): string | null {
  const own = wordsOf(value).filter((w) => w.length >= 3 || /\d/.test(w));
  if (!own.some((w) => /\d/.test(w))) return wordsSentence(value, text, CROWD_CUE);
  const phrase = new RegExp(
    String.raw`(?:^| )${own.map(escape).join(String.raw`(?: \S+){0,2} `)}(?= |$)`,
  );
  return (
    sentencesOf(text).find(
      (sentence) => phrase.test(` ${wordsOf(sentence).join(" ")} `) && CROWD_CUE.test(sentence),
    ) ?? null
  );
}

/** The page's sentence that writes a floor surface (not a storey or a street name). */
function floorSentence(value: string, text: string): string | null {
  if (STOREY.test(value.trim())) return null;
  return wordsSentence(value, text, FLOOR_CUE, NOT_A_SURFACE);
}

/** The page's sentence that writes a dress code, or that there is none. */
function dressSentence(value: string, text: string): string | null {
  if (/^(?:no dress code|none|no|n\/a)$/i.test(value.trim())) {
    return sentencesOf(text).find((s) => NO_DRESS_CODE.test(s)) ?? null;
  }
  return wordsSentence(value, text, DRESS_CUE);
}

// ---------------------------------------------------------------------------------------------
// Level and partner (D-103)

/**
 * The level words a value may name, each with what the page must write for it: "all" is "all
 * levels", "any level", "open level"; "beginner" is beginner(s), beginning, novice, newcomer, "no
 * experience"; "advanced" is advanced or adv, or "advance" in a sentence that names no price, ticket
 * or sale ("Advance: $15", "in advance", "advance registration" are no level).
 */
const LEVEL_TERMS: Array<[RegExp, (sentence: string) => boolean]> = [
  [
    /\ball\b|\bopen\b|\bany\b|\bevery\b/,
    (t) =>
      /\ball[\s-]+levels?\b|\bany level\b|\bevery level\b|\bopen[\s-]+level\b|\blevels?\s*:?\s*all\b/i.test(
        t,
      ),
  ],
  [
    /\bbeginn?(?:er|ers|ing)\b|\bnovices?\b|\bnewcomers?\b/,
    (t) =>
      /\bbeginn?(?:er|ers|ing)\b|\bnovices?\b|\bnewcomers?\b|\bno (?:prior )?experience\b/i.test(t),
  ],
  [/\bintermediate\b|\binter\b|\bint\b/, (t) => /\bintermediate\b|\bint\b/i.test(t)],
  [
    /\badvanced?\b|\badv\b/,
    (t) =>
      /\badvanced\b|\badv\b/i.test(t) ||
      (/\badvance\b/i.test(t) &&
        moneyMentions(t).length === 0 &&
        !/\b(?:in advance|advance (?:tickets?|price|sale|purchase|registration|booking)|discounted)\b/i.test(
          t,
        )),
  ],
  [/\bimprovers?\b/, (t) => /\bimprovers?\b/i.test(t)],
];

/**
 * The page's sentence that writes a level: every level word of the value (`LEVEL_TERMS`) in one
 * sentence; a value with none of them ("Moderate") must be written whole. Null when none does.
 */
export function levelClause(level: string, text: string): string | null {
  const f = foldForMatch(level);
  const terms = LEVEL_TERMS.filter(([inValue]) => inValue.test(f));
  for (const sentence of sentencesOf(text)) {
    if (
      terms.length > 0
        ? terms.every(([, onPage]) => onPage(sentence))
        : f.length > 0 && ` ${foldForMatch(sentence)} `.includes(` ${f} `)
    )
      return sentence;
  }
  return null;
}

/** A partner is needed: "bring a partner", "partner required", "couples only". */
const PARTNER_NEEDED =
  /\b(?:bring|need|needs|require[sd]?)\s+(?:a|your|your own|own)?\s*partners?\b|\bpartners?\s+(?:is\s+|are\s+)?(?:required|needed|necessary|recommended)\b|\bcouples?\s+only\b|\bpartners?\s+only\b/i;
/** No partner is needed: "no partner necessary", "singles welcome", "partners rotate". */
const PARTNER_NOT_NEEDED =
  /\bno\s+partners?\b|\bpartners?\s+(?:is\s+|are\s+)?not\s+(?:required|needed|necessary)\b|\b(?:without|don't\s+need|do\s+not\s+need|doesn't\s+need|no\s+need\s+(?:for|of|to\s+(?:bring|have|find)))\s+(?:a\s+|your\s+)?partners?\b|\bsingles?\s+(?:are\s+)?welcome\b|\b(?:come|coming)\s+(?:alone|solo|single)\b|\balone\s+or\s+with\b|\bindividuals\s+(?:and|&)\s+couples\b|\bpartners?\s+rotat|\brotat(?:e|es|ing|ion)\s+partners?\b|\bpartner\s+rotation\b/i;

/**
 * The page's sentence that says whether a partner is needed, or null. "Needed" stands only where a
 * sentence says so and no sentence of the part says one is not ("You don't need a partner", "no need
 * to bring a partner" are not "needed"); "partnered dancing" says neither.
 */
export function partnerClause(required: boolean, text: string): string | null {
  const sentences = sentencesOf(text);
  const notNeeded = sentences.find((s) => PARTNER_NOT_NEEDED.test(s)) ?? null;
  if (!required) return notNeeded;
  if (notNeeded) return null;
  return sentences.find((s) => PARTNER_NEEDED.test(s)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Music: DJs, bands and the mix (D-104)

const DJ_WORD = /\bdj'?s?\b|\bd\.j\.|\bdeejays?\b|\bdisc jockeys?\b/i;
const BAND_WORD =
  /\bbands?\b|\blive music\b|\borchestra\b|\bquartet\b|\bquintet\b|\btrio\b|\bsextet\b|\bensemble\b|\bcombo\b|\bmusicians?\b/i;
const GENERIC_DJ =
  /^(?:the\s+)?(?:djs?|d\.?j\.?s?|disc jockeys?|deejays?|(?:rotating|guest|resident|various|local|top|special|excellent)\s+djs?|tba|tbd)$/i;
const GENERIC_BAND =
  /^(?:the\s+)?(?:(?:a\s+)?(?:live\s+)?bands?|live music|live|orchestra|tba|tbd|musicians?)$/i;

/** A name as compared: folded, without a leading "the" or "DJ". */
const bareName = (name: string) =>
  foldForMatch(plainText(name))
    .replace(/^(?:the|dj)\s+/, "")
    .replace(/^(?:the|dj)\s+/, "");

/**
 * The page's sentence that names a DJ or a band: a name written whole ("DJ Andrius" as "DJ
 * ANDRIUS", "The Hot Toddies" in "Hot Toddies Jazz Band"), or, for a generic entry ("DJ", "live
 * band", "TBA"), a sentence that writes a DJ word or a band word. Null when none does.
 */
export function musicianSentence(name: string, text: string, kind: "dj" | "band"): string | null {
  const sentences = sentencesOf(text);
  if ((kind === "dj" ? GENERIC_DJ : GENERIC_BAND).test(name.trim())) {
    const word = kind === "dj" ? DJ_WORD : BAND_WORD;
    return sentences.find((s) => word.test(s)) ?? null;
  }
  const bare = bareName(name);
  if (!bare) return null;
  return sentences.find((s) => ` ${foldForMatch(s)} `.includes(` ${bare} `)) ?? null;
}

/** The words a genre mix may carry that are no genre: "and", "music", "mix". */
const MIX_FILLER = new Set(
  compactWords("and the with music mix plus some lots of all kinds style styles"),
);

/**
 * Words compared compactly: folded, each space-separated word with its marks taken out, so
 * "Rock-n-Roll" and "rock-n-roll" are both "rocknroll", "R&B" is "rb", "50's" is "50s".
 */
function compactWords(text: string): string[] {
  return foldForMatch(plainText(text).replace(/[-'\u2019&.]/g, ""))
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/** A sentence's compact words, and each run of two or three of them written as one ("Doo Wop"). */
function compactForms(sentence: string): Set<string> {
  const words = compactWords(sentence);
  const forms = new Set(words);
  words.forEach((w, i) => {
    if (words[i + 1]) forms.add(w + words[i + 1]);
    if (words[i + 1] && words[i + 2]) forms.add(w + words[i + 1] + words[i + 2]);
  });
  return forms;
}

/**
 * The page's sentence that writes every word of a genre mix (three letters or more), compared
 * compactly so "doo-wop" is the page's "DooWop"; null when a word is written nowhere in the part.
 */
function mixSentence(mix: string, text: string): string | null {
  const words = compactWords(mix);
  const counted = (w: string) => w.length >= 3 && !MIX_FILLER.has(w);
  if (!words.some(counted)) return null;
  /**
   * How many of the mix's words these forms write; a word is matched alone or joined to the next
   * one or two ("rock n roll" for the page's "Rock-n-Roll").
   */
  const written = (forms: Set<string>) => {
    let n = 0;
    for (let i = 0; i < words.length; i++) {
      for (const span of [1, 2, 3]) {
        if (i + span > words.length) break;
        const run = words.slice(i, i + span);
        if (!forms.has(run.join(""))) continue;
        n += run.filter(counted).length;
        i += span - 1;
        break;
      }
    }
    return n;
  };
  const sentences = sentencesOf(text);
  const formsOf = sentences.map(compactForms);
  const need = words.filter(counted).length;
  if (written(new Set(formsOf.flatMap((f) => [...f]))) < need) return null;
  // The sentence holding the most of its words is the mix's own ("We play Swing, Jump Blues…").
  let best: string | null = null;
  let most = 0;
  sentences.forEach((sentence, i) => {
    const n = written(formsOf[i]!);
    if (n > most) [best, most] = [sentence, n];
  });
  return best;
}

// ---------------------------------------------------------------------------------------------
// Organiser (D-105)

/** The places a name is written on the page, whole, as [start, end] offsets. */
function nameSpans(pageText: string, name: string): Array<[number, number]> {
  const words = plainText(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
  return [...pageText.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
}

/**
 * True when a read's organiser is a neighbour's (D-105): its name is written on the page only
 * inside other listings' parts ("Join host Maria Jose Sosa" in Tango Y Te's part, given to the
 * Ballroom practice below it). The organiser stands, and nothing is withdrawn, when its link is
 * on the page's own site, its name is the site's ("Stepping Out Studios" on
 * steppingoutstudios.com), its own part writes it, the page writes it outside every listing's
 * part, or the page does not write it at all: an organiser not proven wrong is kept.
 */
export function organizerFromNeighbour(
  organizer: { name: string | null; url: string | null } | null | undefined,
  ctx: {
    pageUrl: string;
    pageText: string;
    /** The listing's own part, as `ownBlockTexts` gives it. */
    own: readonly string[];
    /**
     * Every listing's part on the page, this listing's included, as offsets into `pageText`;
     * asked for only when the name is written nowhere else.
     */
    parts: () => ReadonlyArray<{ start: number; end: number; own: boolean }>;
  },
): boolean {
  const name = organizer?.name?.trim();
  if (!name) return false;
  const site = getDomain(ctx.pageUrl);
  if (organizer?.url && site && getDomain(organizer.url) === site) return false;
  const core = getDomainWithoutSuffix(ctx.pageUrl);
  const compact = foldForMatch(plainText(name)).replace(/ /g, "");
  if (core && (compact === core || `the${compact}` === core || compact === `the${core}`)) {
    return false;
  }
  const folded = foldForMatch(plainText(name));
  if (ctx.own.some((t) => ` ${foldForMatch(plainText(t))} `.includes(` ${folded} `))) return false;
  const spans = nameSpans(ctx.pageText, name);
  if (spans.length === 0) return false;
  const parts = ctx.parts();
  return spans.every(([start, end]) => {
    const holding = parts.filter((p) => p.start <= start && end <= p.end);
    return holding.length > 0 && holding.every((p) => !p.own);
  });
}

// ---------------------------------------------------------------------------------------------
// Cancelled

/** A night that is off: cancelled, postponed, called off, rescheduled, will not take place. */
const CANCEL_WORD =
  /\b(?:cancell?ed|postponed|called off|rescheduled|(?:will not|won'?t) (?:take place|happen|be happening)|no longer (?:taking place|happening))\b/gi;
/** A conditional before it: "can be cancelled", "may be postponed", "if cancelled", "pending". */
const CONDITIONAL =
  /\b(?:can|could|may|might|if|in case|subject to|pending|possibly|risk|unless|whether)\b[^.;!?\n]{0,30}$/i;

/**
 * The page's line that says this night is off (`CANCEL_WORD`, or "No <title> this week"), or null.
 * A conditional ("This event can be cancelled/postponed at the last moment due to weather",
 * "Events may be added or cancelled", "Pending Postponement") says nothing about this night.
 */
export function cancelledClause(text: string, title: string): string | null {
  const plain = plainText(text);
  for (const m of plain.matchAll(CANCEL_WORD)) {
    if (CONDITIONAL.test(plain.slice(0, m.index))) continue;
    return lineAround(text, m.index);
  }
  const own = foldForMatch(title);
  if (!own) return null;
  for (const line of plain.split("\n")) {
    const f = ` ${foldForMatch(line)} `;
    if (new RegExp(String.raw` no ${escape(own)} (?:this week|tonight|today)\b`).test(f)) {
      return line.replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The check

type RawPrice = RawListing["prices"][number];

export interface FactContext {
  /** The read's other titles: none of them is a tier's name. */
  others?: readonly string[];
  /** The metro's currency, for a range whose page writes no mark this module knows. */
  currency?: string | null;
}

const money$ = (n: number) => `$${n}`;
const quote = (clauses: readonly string[]) =>
  [...new Set(clauses)].join(" / ").slice(0, EVIDENCE_MAX_CHARS);

/** An inclusion word: what the price comes with, not who pays it. */
const INCLUDES_CUE = /\b(?:includ\w*|incl\.?|comes with|plus|with)\b|\+/i;

function checkPrices(
  listing: RawListing,
  clauses: readonly Clause[],
  partWords: ReadonlySet<string>,
  ctx: FactContext,
  changes: FactChange[],
): { prices: RawPrice[]; evidence: string[] } {
  const others = (ctx.others ?? []).filter((o) => foldForMatch(o) !== foldForMatch(listing.title));
  const out: RawPrice[] = [];
  const evidence: string[] = [];
  const otherLabels = new Set(listing.prices.map((p) => foldForMatch(p.label)));
  for (const p of listing.prices) {
    // A sum the page writes no amount for ("donation", "pay what you can"): its words are the fact.
    if (p.amount === null) {
      const words = wordsOf(p.label).filter((w) => w.length >= 3);
      if (words.length > 0 && words.every((w) => partWords.has(w))) out.push(p);
      else changes.push({ field: "prices", kind: "dropped", detail: p.label });
      continue;
    }
    if (p.amount === 0) {
      // Free for everyone where the part writes free entry; free for one tier where it writes
      // free for that tier, and a read that names no tier is filed under the page's.
      // "Door" says where a free entry is paid, not who gets it (D-106).
      const claim = claimWords(p.label).filter((w) => w !== "free" && !DOOR.has(w));
      const entry = claim.length === 0 ? clauses.find((c) => freeKind(c.text) === "entry") : null;
      const tier = entry
        ? null
        : clauses.find((c) => freeKind(c.text) === "tier" && labelWrittenFree(p.label, c.text));
      const at = entry ?? tier;
      if (!at) {
        changes.push({ field: "prices", kind: "dropped", detail: `${p.label} free` });
        continue;
      }
      let label = p.label;
      if (tier && claim.length === 0) {
        label = freeTierName(tier.text, others) ?? p.label;
        if (label !== p.label) {
          changes.push({
            field: "prices",
            kind: "relabelled",
            detail: `free ${p.label} as ${label}`,
          });
        }
      }
      let includes = p.includes;
      if (includes !== null && !includesWritten(includes, label, at, partWords, otherLabels)) {
        changes.push({ field: "prices", kind: "relabelled", detail: `free without "${includes}"` });
        includes = null;
      }
      out.push({ ...p, label, includes });
      evidence.push(at.text);
      continue;
    }
    const places = clauses.flatMap((clause) =>
      clause.money.flatMap((m, i) => (m.amount === p.amount ? [{ clause, i }] : [])),
    );
    if (places.length === 0) {
      changes.push({ field: "prices", kind: "dropped", detail: `${money$(p.amount)} ${p.label}` });
      continue;
    }
    const own = places.find(({ clause, i }) => labelWrittenAt(p.label, clause, i));
    const { clause, i } = own ?? places[0]!;
    const mention = clause.money[i]!;
    let label = p.label;
    if (!own) {
      label =
        pageLabel(clause, i, listing.title, others) ??
        (HEADING_LABEL.has(foldForMatch(p.label)) ? p.label : "price");
      changes.push({
        field: "prices",
        kind: "relabelled",
        detail: `${money$(p.amount)} ${p.label} as ${label}`,
      });
    }
    let includes = p.includes;
    if (includes !== null && !includesWritten(includes, label, clause, partWords, otherLabels)) {
      changes.push({
        field: "prices",
        kind: "relabelled",
        detail: `${money$(p.amount)} without "${includes}"`,
      });
      includes = null;
    }
    evidence.push(clause.text);
    // The page's own mark decides the currency ("15 €" is euros whatever the read said).
    const currency = currencyInText(mention.text, p.currency ?? ctx.currency ?? null) ?? p.currency;
    if (mention.range) {
      const [lo, hi] = mention.range;
      const name =
        claimWords(label).length > 0
          ? label
          : (pageLabel(clause, i, listing.title, others) ?? label);
      const known = currency ?? ctx.currency ?? null;
      changes.push({
        field: "prices",
        kind: "ranged",
        detail: `${money$(p.amount)} ${p.label} as ${money$(lo)} to ${money$(hi)}`,
      });
      out.push({
        ...p,
        amount: null,
        currency: known ?? p.currency,
        // A currency this module cannot name is written as the page writes the range.
        label: known
          ? priceRangeLabel(name, lo, hi, known)
          : `${name}, ${mention.text.replace(/\s+/g, " ").trim()}`,
        includes,
      });
      continue;
    }
    out.push({ ...p, label, includes, currency });
  }
  // Two read prices the page writes as one range are one row.
  const seen = new Set<string>();
  const prices = out.filter((p) => {
    const key = `${foldForMatch(p.label)}|${p.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { prices, evidence };
}

/** A free tier's label: no claim, or its words in the clause that writes free. */
function labelWrittenFree(label: string, clause: string): boolean {
  const claim = claimWords(label).filter((w) => w !== "free");
  const here = new Set(wordsOf(clause));
  return claim.every((w) => here.has(w));
}

/** The tier a clause writes free for: "FREE for X" is X, "X – FREE" is X. */
function freeTierName(clauseText: string, others: readonly string[]): string | null {
  const text = plainText(clauseText);
  const after = new RegExp(String.raw`${FREE}\s+for\s+(.+)$`, "iu").exec(text)?.[1];
  const before = new RegExp(String.raw`^(.+?)\s*[–—:-]\s*${FREE}`, "iu").exec(text)?.[1];
  const name = tidy(after ?? before ?? "");
  return name ? tierName(name, others) : null;
}

/**
 * What a price comes with stands when the page writes it with an inclusion word in the listing's
 * part ("includes entry to event & dance lesson"), names no amount, and is not a tier's name: the
 * read's "Includes Early Bird" for the early-bird tier, or "($10 w/ student ID)", is another tier.
 */
function includesWritten(
  includes: string,
  label: string,
  clause: Clause,
  partWords: ReadonlySet<string>,
  tiers: ReadonlySet<string>,
): boolean {
  if (/[$€£¥₩₹]/.test(includes) || moneyMentions(includes).length > 0) return false;
  const f = foldForMatch(includes);
  if (f === foldForMatch(label) || tiers.has(f)) return false;
  const words = wordsOf(includes).filter((w) => !STOP.has(w));
  if (words.length === 0 || !words.every((w) => partWords.has(w))) return false;
  // "with student ID" under the tier "student_id" repeats the tier; it includes nothing.
  const tier = new Set(wordsOf(label));
  if (words.every((w) => tier.has(w))) return false;
  return INCLUDES_CUE.test(`${clause.above}\n${clause.text}`);
}

/**
 * One listing of a model read, its prices, free entry and age limit checked against its own part
 * of the page (`texts`: `ownBlockTexts` of its facts blocks, without the line's lead). What the
 * part does not write is dropped and nothing is put in its place; a price the part writes is filed
 * under the page's words when the read's are not beside it, and one end of a range is listed as the
 * range. A kept fact's evidence is the page's clause. Free entry is set from the page: true where
 * it writes free entry and charges nothing but donations, false where it charges an amount that
 * stood, else unknown, so the write path never reads a free tier as a free night. With no texts the
 * listing is left as it is.
 */
export function checkListingFacts(
  listing: RawListing,
  texts: readonly string[],
  ctx: FactContext = {},
): { listing: RawListing; changes: FactChange[] } {
  if (texts.length === 0) return { listing, changes: [] };
  const all = texts.join("\n");
  const clauses = clausesOf(texts);
  const changes: FactChange[] = [];
  const evidence = { ...listing.evidence };
  const confidence = { ...listing.confidence };
  const next: RawListing = { ...listing };

  const prices = checkPrices(listing, clauses, new Set(wordsOf(all)), ctx, changes);
  next.prices = prices.prices;
  if (prices.prices.length > 0) evidence.prices = quote(prices.evidence);
  else delete evidence.prices;
  if (changes.some((c) => c.field === "prices")) delete confidence.prices;

  // Free entry, from the page: the read's "free" stands where the part writes free entry and
  // charges nothing but donations; a price that stood (an amount or a range) is no free night.
  const charged = charges(clauses);
  const paid = next.prices.some((p) => (p.amount ?? 0) > 0);
  let isFree: boolean | null = null;
  let freeQuote: string | null = null;
  if (listing.is_free === true) {
    const at = clauses.find((c) => freeKind(c.text) === "entry");
    if (at && !charged) {
      isFree = true;
      freeQuote = at.text;
    } else changes.push({ field: "is_free", kind: "dropped", detail: "free" });
  }
  if (isFree === null && (paid || (charged && next.prices.length > 0))) isFree = false;
  if (isFree === null && listing.is_free === false && charged) isFree = false;
  next.is_free = isFree;
  if (isFree === listing.is_free && freeQuote)
    evidence.is_free = freeQuote.slice(0, EVIDENCE_MAX_CHARS);
  else if (isFree !== listing.is_free) {
    delete confidence.is_free;
    if (freeQuote) evidence.is_free = freeQuote.slice(0, EVIDENCE_MAX_CHARS);
    else if (isFree === false && prices.evidence.length > 0)
      evidence.is_free = quote(prices.evidence);
    else delete evidence.is_free;
  }

  if (listing.age_min !== null) {
    const at = ageClause(listing.age_min, all);
    if (at === null) {
      next.age_min = null;
      changes.push({
        field: "age_min",
        kind: "dropped",
        detail: listing.age_min === 0 ? "all ages" : `${listing.age_min}+`,
      });
      delete evidence.age_min;
      delete confidence.age_min;
    } else evidence.age_min = at.slice(0, EVIDENCE_MAX_CHARS);
  }

  // The place and the crowd (D-102): each only where its own words are written in the part.
  const place: Array<{
    field: "indoor_outdoor" | "floor" | "dress_code" | "crowd_size_hint";
    at: (value: string) => string | null;
  }> = [
    {
      field: "indoor_outdoor",
      at: (v) => indoorOutdoorClause(v as "indoor" | "outdoor" | "both", all),
    },
    { field: "floor", at: (v) => floorSentence(v, all) },
    { field: "dress_code", at: (v) => dressSentence(v, all) },
    { field: "crowd_size_hint", at: (v) => crowdSentence(v, all) },
  ];
  for (const { field, at } of place) {
    const value = listing[field];
    if (value === null) continue;
    const line = at(value);
    if (line === null) {
      next[field] = null;
      changes.push({ field, kind: "dropped", detail: value });
      delete evidence[field];
      delete confidence[field];
    } else evidence[field] = line.slice(0, EVIDENCE_MAX_CHARS);
  }

  // Level and partner (D-103): each only where the part writes it.
  if (listing.level !== null) {
    const at = levelClause(listing.level, all);
    if (at === null) {
      next.level = null;
      changes.push({ field: "level", kind: "dropped", detail: listing.level });
      delete evidence.level;
      delete confidence.level;
    } else evidence.level = at.slice(0, EVIDENCE_MAX_CHARS);
  }
  if (listing.partner_required !== null) {
    const at = partnerClause(listing.partner_required, all);
    if (at === null) {
      next.partner_required = null;
      changes.push({
        field: "partner_required",
        kind: "dropped",
        detail: listing.partner_required ? "partner needed" : "no partner needed",
      });
      delete evidence.partner_required;
      delete confidence.partner_required;
    } else evidence.partner_required = at.slice(0, EVIDENCE_MAX_CHARS);
  }

  // Music (D-104): each DJ and band only where the part names them; the mix where it writes it.
  {
    const quotes: string[] = [];
    const keep = (name: string, kind: "dj" | "band") => {
      const at = musicianSentence(name, all, kind);
      if (at === null) changes.push({ field: "music", kind: "dropped", detail: name });
      else quotes.push(at);
      return at !== null;
    };
    const djs = listing.music.djs.filter((n) => keep(n, "dj"));
    const bands = listing.music.bands.filter((n) => keep(n, "band"));
    let mix = listing.music.genre_mix;
    if (mix !== null) {
      const at = mixSentence(mix, all);
      if (at === null) {
        changes.push({ field: "music", kind: "dropped", detail: mix });
        mix = null;
      } else quotes.push(at);
    }
    next.music = { djs, bands, genre_mix: mix };
    if (quotes.length > 0) evidence.music = quote(quotes);
    else delete evidence.music;
    if (changes.some((c) => c.field === "music")) delete confidence.music;
  }

  // Cancelled (D-101): only where the part says this night is off, never on a conditional.
  if (listing.cancelled === true) {
    const at = cancelledClause(all, listing.title);
    if (at === null) {
      next.cancelled = null;
      changes.push({ field: "cancelled", kind: "dropped", detail: "cancelled" });
      delete evidence.cancelled;
      delete confidence.cancelled;
    } else evidence.cancelled = at.slice(0, EVIDENCE_MAX_CHARS);
  }
  return { listing: { ...next, evidence, confidence }, changes };
}
