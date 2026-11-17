# Phase 3 plan: the AI pipeline

SPEC section 11, Phase 3: *discovery, LLM extraction, day-of verification, submission extraction, both evals, cost logging and budgets. Done when you can show me extraction precision and recall, NYC recall against my list with misses classified, and spend per metro-day.* PLAN section 8 is the design; D-039, D-040 and D-048 are the decisions. This file is the order of work and what each step proves.

## Where Phase 2 left us

The deterministic pipeline runs daily (D-046). On New York it writes Ticketmaster and Eventbrite listings, and 19 first-party pages load but publish no feed or structured events; they are marked `waits_for_extraction`. Those pages are what Phase 3 exists for.

## Order of work

Each step is its own pull request, green before the next starts.

1. **Keys proven live.** `pnpm ai:check` in the ingest workflow (D-048). Groq and OpenRouter models are wired from the ids it lists, not from memory.
2. **Extraction.** Cleaned page text to `rawExtractionSchema` listings on Workers AI (`@cf/ibm-granite/granite-4.0-h-micro`), with `max_tokens` from `src/ai/jobs.ts`, zod validation, one retry with the validator's complaint, escalation to `@cf/google/gemma-4-26b-a4b-it` on PLAN 8.2's conditions, the extraction cache keyed by content hash, the neuron ledger reserving before and reconciling after, and `quota_exhausted` deferring a source rather than failing it. Wired into the ingest for every `waits_for_extraction` source. The run report gains neurons spent, sources deferred, and the share of listings that needed a model at all.
3. **Extraction eval.** Real pages recorded by the ingest workflow's `--record`, each with hand-checked expected JSON in `evals/extraction/`, including prompt-injection pages. `pnpm eval:extraction` reports field-level precision and recall.
4. **Discovery (D-040).** Sitemaps and outbound links of the sources we hold, Overpass `website` tags, Wikidata P856 and directory pointers, all feeding the existing probe. No model. Then the one Serper measurement of what these miss, recorded in `evals/recall/`.
5. **Afternoon re-check, summaries, dedupe adjudication.** A second daily workflow at about 14:30 New York time for tonight's rule-inferred, stale and conflicting listings; summaries from our own facts on the owner's chain with the post-check; model adjudication for dedupe pairs scoring 0.5 to 0.79.
6. **Suggest an event.** The submission reader (URL through the harvest ladder, pasted text through extraction) and a page nothing links to until Phase 5.
7. **Recall.** A drafted list for three New York nights in `evals/recall/nyc/`, corrected by the owner, and `pnpm eval:recall` classifying each miss (no source held, source held but not harvested, harvested but not extracted, extracted but merged wrongly, social-only).

## What the checkpoint report will show

Extraction precision and recall from step 3; New York recall with misses classified from step 7; neurons and requests per metro-day from the ledger; the share of listings that needed a model; and the discovery gap from step 4. All at $0.
