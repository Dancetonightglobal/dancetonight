// The job table: one `AiJob` per `AiJobId` (PLAN sections 6 to 8, COSTS.md section 1).
//
// Two fields here decide everything downstream, so both are argued rather than guessed:
//
//  * `sendsUntrustedText` is a terms constraint, not a preference. It is true whenever the
//    prompt will carry text we did not write: a fetched page, or a visitor's pasted text or
//    flyer. `routableFor()` in `types.ts` turns it into a hard routing rule, which is why the
//    extraction chain ends at Cloudflare rather than following the owner's Gemini-first order.
//
//  * `maxOutputTokens` is never omitted (contract rule 3) and, for extraction, is the single
//    number that dominates the neuron budget: on the cheapest verified Workers AI model output
//    costs 10,158 / 1,542 = 6.59x input, so an over-generous cap is expensive and a tight one
//    truncates the JSON into an unparseable reply. The arithmetic is spelled out below.
//
// Figures marked (COSTS 1) come from the mid-metro column of docs/COSTS.md section 1.

import { AI_JOB_IDS, type AiJob, type AiJobId } from "@/src/ai/types";

// ----------------------------------------------------------------------------------------------
// Extraction output sizing
//
// `rawExtractionSchema` (src/domain/listing.ts) returns an ARRAY, not one listing:
//
//     { page_kind, language, listings: [ RawListing, ... ] }
//
// so the cap has to cover the whole array. Budgeting for a single listing (the mistake COSTS.md's
// T_out = 900 invites, since that figure is a per-call MEAN across mostly single-event pages) makes
// every list page come back truncated.
//
// Per-listing cost, counted from `rawListingSchema` rather than estimated as a round number:
//
//   structure      25 top-level keys + 8 nested ones (venue 3, organizer 2, music 3) = 33 slots.
//                  A slot that is merely present and null, `"partner_required":null,`, is about
//                  7 tokens, so the empty skeleton alone is ~230 tokens.
//   values         a terse list-page row populates title, styles, date, one or two times, venue
//                  name, and a price: ~70 tokens. A rich single-event page reaches ~135.
//   evidence       PLAN 8.2 asks for a short quote per populated field, cut to EVIDENCE_MAX_CHARS
//                  (300 chars). A list row populates ~6 fields at ~25 tokens per entry: ~150.
//                  A rich page populates ~10: ~250.
//   confidence     one number per populated field, ~7 tokens each: ~42 list row, ~70 rich page.
//                  ------------------------------------------------------------------------------
//                  list row ~492, rich single-event listing ~685. We budget 650, which covers a
//                  list row comfortably and a rich one closely; list pages are the case that has
//                  many rows, and rich pages are the case that has one.
//
// How many rows must fit? PLAN 8.2 escalates when "the page is a `list` with more than 15 items".
// That test cannot be applied to a reply that was truncated at 15, so the cheap model has to be
// able to emit the 16th row and let the rule fire on a complete document. 16 is therefore the cap,
// not a guess about how long list pages are.
//
//   envelope  {"page_kind":"list","language":"en","listings":[ ... ]}   ~20 tokens
//   rows      16 x 650                                                 10,400 tokens
//                                                                      ---------------
//                                                                      10,420 -> 10,500
//
// Cost of that cap on @cf/ibm-granite/granite-4.0-h-micro, reserved in full before the call:
//   in   8,000 x 1,542 / 1e6  =  12.34 neurons
//   out 10,500 x 10,158 / 1e6 = 106.66 neurons
//                               ---------------
//                               119.00 neurons, so 84 fully-reserved extractions against the
//   10,000 neuron/day allowance. The ledger reconciles after the call, and the COSTS 1 mean of 900
//   output tokens costs 21.5 neurons, i.e. ~465 extractions/day -- comfortably above the ~25/day
//   that 740 extractions per metro-month implies. The cap is a ceiling, not the expected spend.
//
// It also fits: 8,000 + 10,500 = 18,500 tokens, well inside granite's 131,000 context.

/** Tokens for the object that wraps the array: `page_kind`, `language`, `listings` and braces. */
export const EXTRACT_ENVELOPE_TOKENS = 20;

/** Budgeted output tokens for one `rawListingSchema` object, including its evidence quotes. */
export const EXTRACT_TOKENS_PER_LISTING = 650;

/**
 * Rows the cheap extraction pass must be able to emit. PLAN 8.2 escalates a `list` page with more
 * than 15 items, so the reply has to hold 16 for that rule to be decidable.
 */
export const EXTRACT_BUDGETED_LISTINGS = 16;

/** Cleaned page text sent to extraction (COSTS 1, `T_in`; PLAN 6.5 caps cleaning at ~12k). */
export const EXTRACT_PAGE_TEXT_TOKENS = 6_000;

/**
 * The extraction system prompt plus the JSON Schema for `rawExtractionSchema`. COSTS 1 counted
 * only the page text; the schema alone is large (25 top-level fields, a listing-type enum and
 * ~116 style keys from config/styles.ts) and the rules in PLAN 8.2 add to it.
 */
export const EXTRACT_PROMPT_TOKENS = 2_000;

/**
 * Output tokens needed for an extraction expected to yield `expectedListings` rows.
 *
 * Callers that know the page shape use it to reserve less than the 16-row default: a probe that
 * found a `single_event` page needs one row, a calendar page may want more than 16 on the
 * escalation pass. Always at least one row, so a page that turns out to hold one listing still
 * gets a complete object back.
 */
export function extractOutputTokensFor(expectedListings: number): number {
  const rows = Number.isFinite(expectedListings) ? Math.ceil(expectedListings) : 1;
  return EXTRACT_ENVELOPE_TOKENS + Math.max(1, rows) * EXTRACT_TOKENS_PER_LISTING;
}

const EXTRACT_INPUT_TOKENS = EXTRACT_PAGE_TEXT_TOKENS + EXTRACT_PROMPT_TOKENS; // 8,000
const EXTRACT_OUTPUT_TOKENS = 10_500; // extractOutputTokensFor(16) = 10,420, rounded up

/** PLAN 8.2: the escalation pass re-reads the same page with more room for reasoning. */
const ESCALATION_MULTIPLIER = 1.3;

// ----------------------------------------------------------------------------------------------

const JOBS: Record<AiJobId, AiJob> = {
  extract: {
    id: "extract",
    // Cleaned text from someone else's page, ~740 pages per metro-month (COSTS 1).
    sendsUntrustedText: true,
    estimatedInputTokens: EXTRACT_INPUT_TOKENS,
    maxOutputTokens: EXTRACT_OUTPUT_TOKENS,
    description:
      "Read one cleaned page into { page_kind, language, listings[] } with per-field evidence " +
      "and confidence (PLAN 8.2). Output is budgeted for 16 listings so the >15-item escalation " +
      "rule is decidable on a complete reply.",
  },

  escalate: {
    id: "escalate",
    sendsUntrustedText: true,
    // PLAN 8.2: 1.3x extract, for schema failures, mean confidence below 0.6, non-Latin scripts
    // and list pages with more than 15 items.
    estimatedInputTokens: Math.round(EXTRACT_INPUT_TOKENS * ESCALATION_MULTIPLIER), // 10,400
    maxOutputTokens: Math.round(EXTRACT_OUTPUT_TOKENS * ESCALATION_MULTIPLIER), // 13,650
    description:
      "Re-read a page the cheap pass could not settle: schema validation failed twice, mean " +
      "confidence below 0.6, non-Latin script, or a list page with more than 15 items (PLAN 8.2).",
  },

  submission: {
    id: "submission",
    // A visitor's pasted text or flyer is untrusted in exactly the way a fetched page is: we did
    // not write it, and PLAN 8.4 treats it as data, never as instructions.
    sendsUntrustedText: true,
    // ~3,000 tokens of pasted text (submissions are one event, not a season) plus the ~2,000-token
    // extraction prompt. Flyer images are charged separately by the provider and are not counted
    // here; the ledger reconciles the real figure after the call.
    estimatedInputTokens: 5_000,
    // A submission describes one event; three rows leaves room for a flyer listing a short series.
    maxOutputTokens: extractOutputTokensFor(3), // 1,970
    description:
      "Turn a visitor's submitted URL or pasted text (D-035: no flyer uploads in v1) into a draft listing for " +
      "field-by-field review before moderation (PLAN 8.3).",
  },

  summarise: {
    id: "summarise",
    // Structured facts we already validated: no source text ever reaches this prompt (PLAN 8.3,
    // and CLAUDE.md's "store facts and our own summaries only").
    sendsUntrustedText: false,
    estimatedInputTokens: 700, // COSTS 1
    // COSTS 1 measures ~120 output tokens for 2 to 3 sentences; the cap leaves room for a long
    // venue or organizer name rather than truncating mid-sentence.
    maxOutputTokens: 300,
    description:
      "Write the 2 to 3 sentence summary for one listing from its validated facts, post-checked " +
      "so every number and proper noun appears in those facts (PLAN 8.3).",
  },

  dedupe: {
    id: "dedupe",
    sendsUntrustedText: false,
    estimatedInputTokens: 1_200, // COSTS 1: two candidate listings' facts
    maxOutputTokens: 400, // COSTS 1 measures ~150: a verdict plus its reason
    description:
      "Adjudicate one borderline duplicate pair from both listings' structured facts " +
      "(PLAN section 9); the deterministic rules settle everything outside the borderline band.",
  },

  classify_venue: {
    id: "classify_venue",
    // The already-extracted venue record: name, Overture and OSM categories, address, website
    // host. Not the venue's page text -- that path is `extract`, and its output lands here already
    // validated (PLAN 6.2 stage 1).
    sendsUntrustedText: false,
    estimatedInputTokens: 900,
    maxOutputTokens: 300, // kind, dance_floor verdict, confidence, one-line reason
    description:
      "Decide whether an ambiguous seeded venue is a dance venue, from its validated facts, so " +
      "the row can carry 'Check before you go' until a first-party listing confirms it (PLAN 6.2).",
  },

  map_style: {
    id: "map_style",
    // An unknown style term that the synonym table in config/styles.ts did not match, which came
    // out of an extraction that already passed zod validation.
    sendsUntrustedText: false,
    // ~116 style keys plus 13 family keys (config/styles.ts) is ~500 tokens of candidate list, the
    // unmatched terms and their listing context ~300, the instructions ~600.
    estimatedInputTokens: 1_400,
    maxOutputTokens: 400, // the mapping, plus proposed synonyms for the review list
    description:
      "Map an unmatched style term onto the config/styles.ts taxonomy and propose synonyms for " +
      "the review list, when the synonym table misses (PLAN 6.2 stage 4).",
  },
};

/** Every job the pipeline asks a model to do, keyed by id. */
export const AI_JOBS: Readonly<Record<AiJobId, AiJob>> = Object.freeze(JOBS);

/** The job definition for `id`. Total over `AiJobId`, so it never returns undefined. */
export function jobById(id: AiJobId): AiJob {
  return AI_JOBS[id];
}

/** Every job, in the contract's declared order. */
export const ALL_AI_JOBS: readonly AiJob[] = Object.freeze(AI_JOB_IDS.map((id) => AI_JOBS[id]));

/** The jobs whose prompts carry text we did not write; these are routed by data policy. */
export const UNTRUSTED_TEXT_JOBS: readonly AiJob[] = Object.freeze(
  ALL_AI_JOBS.filter((job) => job.sendsUntrustedText),
);
