# Quota model per active metro

Rewritten 2026-09-22 for D-039, then reconciled against the code on 2026-09-22. The build runs at
**$0**, so this is no longer a model of money: it is a model of **quota**. Every free tier meters
something, the units differ, and the binding constraint is the 9,000 neurons a day we allow
ourselves out of Cloudflare's verified 10,000 for the whole account, shared across every metro and
every model. The dollar model that preceded this is kept in full as Appendix A, for the day the
owner ever sets `AI_ENABLE_PAID=true`.

**Where the numbers come from.** Every token figure below is a constant in `src/ai/jobs.ts`, and
every neuron rate is a field in `src/ai/registry.ts`. Nothing is estimated here that the code does
not also hold, and the arithmetic is shown on each row so a reader can re-multiply it without
running anything. If a row cannot be reproduced from those two files, the row is wrong.

Verification vocabulary is SOURCES.md's: *live* means read on the vendor's own page or source
repository on 2026-09-22, *mirror* a dated third-party copy, *unverified* nothing authoritative
could be loaded. Unverified numbers are not budgeted against; they are marked and left to the owner
to read from their own console (SOURCES.md section 10).

## 1. The verified daily allowances

| Provider | Unit | Free per day | Reset | Per-minute | May carry third-party page text? | Verification |
|---|---|---|---|---|---|---|
| Cloudflare Workers AI | neuron | **10,000 per account**, shared across every model and task type, no accumulation | 00:00 UTC | 300 requests/min (text generation) | **yes** — terms forbid training on input | live |
| OpenRouter free models | request | 50 with no credits (1,000 after a one-time $10, which is not $0 and is out of scope) | not stated | 20 | no — the free catalogue needs endpoints that may train on and publish prompts | live |
| Gemini (Google AI Studio) | request | **unverified** — mirrors disagree by 6x (250 vs 1,500 for the same model class); one says Google no longer publishes the figure at all | not stated | unverified | no — free-tier content is reported to improve Google's products | unverified |
| Groq | request | 1,000 reported | not stated | 30 requests/min and 8,000 tokens/min reported | no | unverified |
| Cohere | call | 1,000 per **month** | — | — | excluded | verified |
| Mistral | — | free mode is "intended for evaluation and prototyping" | — | — | excluded | verified wording |

Two consequences fall straight out of the table. Cloudflare's exhaustion is a hard stop, error 3036
with HTTP 429, not a throttle: when the neurons are gone, every metro loses extraction at the same
moment. And Groq's 8,000 tokens a minute cannot hold one extraction — `src/ai/jobs.ts` sends 8,000
input tokens on the `extract` job, a whole minute's budget before the reply has produced a token,
and the reply may run to 10,500 more — so Groq is structurally barred from extraction whatever its
daily figure turns out to be.

## 2. What the day's neurons buy, per model

### 2.1 The standard extraction call

The call is `src/ai/jobs.ts`'s `extract` job, and every figure in it is a named constant there:

| Part | Tokens | Constant in `src/ai/jobs.ts` |
|---|---|---|
| Cleaned page text | 6,000 | `EXTRACT_PAGE_TEXT_TOKENS` (PLAN 6.5 caps cleaning at about 12,000) |
| System prompt and the rendered JSON Schema | 2,000 | `EXTRACT_PROMPT_TOKENS` |
| **Input total** | **8,000** | `EXTRACT_INPUT_TOKENS` = 6,000 + 2,000 |
| Output, per listing | 650 | `EXTRACT_TOKENS_PER_LISTING` |
| Listings the reply must be able to hold | 16 | `EXTRACT_BUDGETED_LISTINGS` — PLAN 8.2 escalates a `list` page with more than 15 items, so the reply has to hold the 16th for the rule to be decidable on a complete document |
| Envelope (`page_kind`, `language`, brackets) | 20 | `EXTRACT_ENVELOPE_TOKENS` |
| **Output cap** | **10,500** | 20 + 16 × 650 = 10,420, rounded up |

8,000 + 10,500 = 18,500 tokens, well inside granite's 131,000 context.

### 2.2 Reserved and expected are different numbers, and this document used neither

Output length is not known before a call, so the ledger holds the job's whole `maxOutputTokens`
before the call runs and gives the difference back when the real usage arrives (`src/ai/ledger.ts`,
contract rule 1). Every job therefore has two figures: the **reserved** cost, which decides whether
the call is admitted at all, and the **expected** cost, which is what the day actually spends.

The previous revision of this document used neither. It multiplied a 900-token output by three
listings and added a 50-token envelope to reach 2,750 output tokens — a figure that appears nowhere
in the code, well above the mean and less than a third of the cap — and it sized escalation at
3,575 output tokens against the 13,650 `src/ai/jobs.ts` actually budgets, a difference of 3.8x.
**`src/ai/jobs.ts` is right and this document was wrong.** The cap is 10,500, the mean is 900, and
every row below carries whichever of the two it needs and says which.

### 2.3 Cost of one reserved extraction, per Workers AI model

Neurons per call are `input_tokens / 1e6 × input_rate + output_tokens / 1e6 × output_rate`, at the
8,000 / 10,500 sizing above. "Calls per 9,000" is the whole day's budget divided by one reserved
call, rounded down.

| Model | Rate in / out (per M) | Input | Output | Reserved per call | Calls per 9,000 |
|---|---|---|---|---|---|
| `@cf/ibm-granite/granite-4.0-h-micro` | 1,542 / 10,158 | 12.34 | 106.66 | **119.0** | **75** |
| `@cf/google/gemma-4-26b-a4b-it` | 9,091 / 27,273 | 72.73 | 286.37 | **359.1** | **25** |
| `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | 4,119 / 34,868 | 32.95 | 366.11 | 399.1 | 22 |
| `@cf/zai-org/glm-4.7-flash` | 5,500 / 36,400 | 44.00 | 382.20 | 426.2 | 21 |
| `@cf/openai/gpt-oss-120b` | 31,818 / 68,182 | 254.54 | 715.91 | 970.5 | 9 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 26,668 / 204,805 | 213.34 | 2,150.45 | 2,363.8 | 3 |

**2,363.8 ÷ 119.0 = 19.9.** The dearest verified model costs nearly **20x** the cheapest on the
identical call: the extractions one metro gets through in a day on Granite would take nearly three
weeks of the whole account's allowance on Llama 3.3 70B.
Model choice is an architectural decision here, not a tuning knob: pick the 70B and the project
supports no metros at all.

Sizing the call properly also changes the ordering. At the old 2,750-token output Gemma 4 looked
dearer than both Llama 3.1 8B and GLM 4.7 Flash; at the real cap it is the second cheapest model in
the table, because its output rate of 27,273 is a third of theirs and the cap is dominated by
output. That is the practical reason the escalation model is chosen on the escalation-sized call
rather than on a round number.

Notes on the two models we use and the one we do not:

- **Granite 4.0 H Micro** carries extraction and every small job: cheapest by a wide margin,
  131,000 context (7x the 18,500-token standard call), with `response_format` and function calling
  both verified twice.
- **Gemma 4 26B A4B** is the escalation and submission model: 256,000 context, and the only
  Workers AI entry that can hold an escalation at all (10,400 in + 13,650 out = 24,050 tokens,
  against Llama 3.3 70B's 24,000 context). It also carries vision, which v1 does not use: flyer and
  image submissions are out of scope (D-035's answer to Q3, and D-039).
- **Llama 3.1 8B fp8-fast** looks attractive at 4,119 / 34,868 and is **not used**. Its catalogue
  fetch 404s, and both its `response_format` support and its 32,000 context failed re-verification.
  An unverified `response_format` on the path that must return JSON is not a saving. Its
  `contextWindow` in `src/ai/registry.ts` is 0, which now means *unknown* rather than *zero
  capacity*, so it is allowed through the resolver and its limit is logged as unknown.

Two rates that are not per-call: `@cf/baai/bge-m3` embeddings at 1,075 neurons per million tokens
(embedding 200 candidate titles at 40 tokens each is 8,000 tokens, about **9 neurons**) and
`@cf/baai/bge-reranker-base` at 283. Both are cheap enough to be rounding error and are available to
the dedupe path if it ever wants them.

### 2.4 Every job, its tokens and its neurons

One row per `AiJobId`. The tokens are `estimatedInputTokens` and `maxOutputTokens` from
`src/ai/jobs.ts`; the "carries text we did not write?" column is that file's `sendsUntrustedText`,
which is what `routableFor()` routes on.

| Job | Carries text we did not write? | Model | In / out tokens | Reserved neurons | Arithmetic |
|---|---|---|---|---|---|
| `extract` | **yes** | granite | 8,000 / 10,500 | **119.0** | 12.34 + 106.66 |
| `escalate` | **yes** | gemma | 10,400 / 13,650 | **466.8** | 94.55 + 372.28 |
| `submission` | **yes** | gemma | 5,000 / 1,970 | **99.2** | 45.46 + 53.73 |
| `summarise` | no | granite | 700 / 300 | **4.1** | 1.08 + 3.05 |
| `dedupe` | no | granite | 1,200 / 400 | **5.9** | 1.85 + 4.06 |
| `classify_venue` | no | granite | 900 / 300 | **4.4** | 1.39 + 3.05 |
| `map_style` | no | granite | 1,400 / 400 | **6.2** | 2.16 + 4.06 |

Escalation's sizing is the extraction call times PLAN 8.2's 1.3: round(8,000 × 1.3) = 10,400 in and
round(10,500 × 1.3) = 13,650 out. A submission's output cap is `extractOutputTokensFor(3)`, that is
20 + 3 × 650 = 1,970, which leaves room for a short series rather than a single event.

**Two rows in the old small-job table were wrong about the data policy, not just the arithmetic.**
It costed venue classification at 5,000 / 200 tokens "from the venue's own page", and style mapping
at 2,100 / 100 for "an unknown term lifted from a page". Both descriptions imply the job carries
third-party page text. `src/ai/jobs.ts` marks both `sendsUntrustedText: false`, and it is right:
`classify_venue` reads the already-extracted venue record (name, Overture and OSM categories,
address, website host) and `map_style` reads a term out of an extraction that has already passed
zod validation. Neither is ever handed a page. The document is corrected to the code.

The expected, reconciled cost of the two large jobs, using Appendix A1's measured mean output of
900 tokens per extraction:

| Job | In / out tokens | Expected neurons | Arithmetic |
|---|---|---|---|
| `extract` | 8,000 / 900 | **21.5** | 12.34 + 9.14 |
| `escalate` | 10,400 / 1,170 | **126.5** | 94.55 + 31.91 (1,170 = 1.3 × 900) |

The five small jobs cap output at 300 to 400 tokens, close enough to what they actually return that
the cap is used as their budget figure and no second number is kept for them.

Every neuron figure in this document is rounded to one decimal per call and to the nearest whole
neuron per row, so a subtotal can differ from the unrounded arithmetic by a neuron or two. Nothing
here turns on that; the decisions turn on the 19.9x and on the two-metro ceiling.

## 3. A complete day for one metro

A mid metro from Appendix A1: 150 sources harvested daily, 30% change on a given day, 55% of those
need a model because they have no feed or JSON-LD, 12% of extractions escalate, 35 listings verified
day-of with about half unchanged. That is 25 extractions, 3 escalations, 17 day-of re-extractions
and 2 escalations of those, alongside 60 summaries, 15 dedupe adjudications, 3 venue classifications
and 5 style mappings.

Per-call figures are section 2.4's: expected for the two large jobs, the cap for the small ones.

| Job | Calls | Neurons each | Neurons |
|---|---|---|---|
| Extraction (granite) | 25 | 21.5 | 538 |
| Escalation (gemma) | 3 | 126.5 | 380 |
| Day-of re-extraction (granite) | 17 | 21.5 | 366 |
| Day-of escalation (gemma) | 2 | 126.5 | 253 |
| **Untrusted-text subtotal** | **47** | | **1,537** |
| Summaries (granite) | 60 | 4.1 | 246 |
| Dedupe adjudication (granite) | 15 | 5.9 | 89 |
| Venue classification (granite) | 3 | 4.4 | 13 |
| Style mapping (granite) | 5 | 6.2 | 31 |
| **Own-facts subtotal** | **83** | | **379** |
| **Subtotal** | **130** | | **1,916** |
| Retry allowance, 15% — JSON mode is best effort, so a reply that fails zod is sent again once on the same provider and model (D-039, and the client) | | | 287 |
| **Budgeted metro-day** | | | **2,203** |

**Why the own-facts jobs are counted in neurons at all.** They prefer Gemini: `AI_PROVIDER_ORDER`
defaults to `gemini,groq,openrouter,cloudflare`, and on a day when Gemini answers, those 83 calls
cost no neurons whatever. But Gemini's daily allowance is unverified, and this document does not
budget against unverified figures, so the 379 above is the worst case — every own-facts job falling
through the chain to Cloudflare. Read that line as a ceiling, not an expectation.

**The reservation is a separate constraint from the spend.** At the instant an extraction runs the
ledger must have 119.0 free neurons and an escalation 466.8, whatever the average works out to.
Reservations are not additive across the day, because each is released when its call reconciles, so
there is no row for them in the table. What they do is put a floor under the day's last calls: once
fewer than 466.8 neurons remain, no escalation is admitted even though the average escalation spends
126.5.

The old table ended with a 500-neuron "day-of reserve" held back so the 13:00 verification pass
could not be starved by the morning harvest. That line is gone along with the variable that carried
it. `AI_METRO_NEURON_CAP` is a ceiling on what one metro may spend in a day, not a pot withheld from
part of the day; section 6 records the rename and why it was needed.

A mid metro makes about **130 model calls a day**, of which the 47 untrusted-text calls must reach
Cloudflare and the other 83 may. Spread over an eight-hour harvest window that is nowhere near
Cloudflare's 300 requests a minute, and the per-minute limit never binds; the daily neuron total is
the only thing that does.

## 4. The scale ceiling: two metros, not three

The ceiling is set by two constants in `src/ai/ledger.ts` rather than by an estimate:
`DEFAULT_DAILY_NEURON_BUDGET` is 9,000, and `defaultMetroCap(9,000)` returns
floor(9,000 / 2) = 4,500, which is what `AI_METRO_NEURON_CAP` carries unless the owner sets it.
floor(9,000 / 4,500) = **2**.

| Active metros | Budgeted neurons (section 3) | Share of the 9,000 | If each took its whole cap |
|---|---|---|---|
| 1 | 2,203 | 24% | 4,500 — 50% |
| **2** | **4,406** | **49%** | **9,000 — 100%** |
| 3 | 6,609 | 73% | 13,500 — does not fit |

Read the two right-hand columns together, because the answer is in the gap between them. Three mid
metros do fit on an average day. What they cannot do is have a bad day: three cap-sized days are
13,500 neurons against a 9,000 account, so nothing protects the third metro, or the first, when more
pages change than usual. Two metros can each spend their whole permitted day without either
starving the other, and that is exactly what the cap is for.

At two metros the 4,594 neurons left over are not slack to be spent: they are the margin that
absorbs a day with an unusual run of list pages, the room submissions come from, and the room a
capped cold-start wave needs (section 5).

This is the honest headline, and it is a long way from what the dollar model implied. Appendix A
sketched twenty metros at $1,700 to $3,000 a month. At $0 the answer is **two**. A third metro means
one of three things, each a decision for the owner and none of them free: a second Cloudflare
account (which we will not do — see D-039's rejected list), a paid provider switched on, or accepting
that the third metro runs on deterministic adapters alone, with no extraction at all on pages that
have no feed.

An NYC-scale metro (500 sources, Appendix A4) is roughly 3.3x a mid metro on this arithmetic, about
**7,270 neurons a day**. That is 81% of the whole account, but the binding number is nearer: it is
62% above a single metro's 4,500 cap, so New York exhausts its own cap long before it exhausts the
account, and it does so whether or not a second metro is running. New York cannot be run at full
daily refresh at $0. It runs with the source list capped to the highest-yield sources — a cap, not a
sampling, so the list stays explainable — or on a two-day refresh cycle.

## 5. Cold start is its own quota class

A cold start is not a busy day; it is a different shape of day. Nothing is cached, no content hash
matches, and every discovered page needs the full ladder at once. PLAN section 10's full path is
about 150 pages in the first wave, of which 55% need a model: 83 extractions, with the escalation
rate applying to all of them, plus the venue classifications and unknown style terms that a new city
produces in bulk.

| Job | Calls | Neurons each | Neurons |
|---|---|---|---|
| Extraction (granite) | 83 | 21.5 | 1,785 |
| Escalation (gemma) | 10 | 126.5 | 1,265 |
| Venue classification (granite) | 60 | 4.4 | 264 |
| Style mapping (granite) | 30 | 6.2 | 186 |
| **Subtotal** | **183** | | **3,500** |
| Retry allowance, 20% — a new city means unknown platforms and a higher schema-failure rate than the 15% a settled metro sees | | | 700 |
| **One city's first wave** | | | **4,200** |

**4,200 of 9,000 is 47% of the day's budget, and 93% of a single metro's 4,500 cap.** An uncapped
cold start fits inside one metro's cap and leaves that metro nothing at all for its own harvest; run
beside two settled metros it is 4,200 + 4,406 = 8,606 of 9,000, 96% of the day with no margin left
for an unusual list page. And because the reset is 00:00 UTC with no accumulation, there is no
borrowing from tomorrow.

So the first wave is capped and spread. The cap is **40 extractions a night**:

| Job | Calls | Neurons each | Neurons |
|---|---|---|---|
| Extraction | 40 | 21.5 | 860 |
| Escalation | 5 | 126.5 | 633 |
| Venue classification | 20 | 4.4 | 88 |
| Style mapping | 10 | 6.2 | 62 |
| Subtotal | | | 1,643 |
| Retry allowance, 20% | | | 329 |
| **Capped wave** | | | **1,972** |

One active metro (2,203) plus one capped wave (1,972) is 4,175, 46% of the account. Two metros
(4,406) plus a capped wave is 6,378, 71%, leaving 29% spare. At 40 extractions a night the first
wave's 83 extractions take three nights (40, 40, 3), so a new city reaches its first complete
harvest on the **third night** rather than in the first ten minutes. The page says so: the
cold-start status line becomes "Scouting {city}'s dance scene — first listings tonight, the full
picture in a few days", and the metro stays `warming` until the last capped wave finishes.

The fast path is unaffected and still targets under ten seconds, because it is entirely
deterministic: Ticketmaster, SeatGeek, the region-scoped feeds, the Overture bounding-box pull and
`venue_open_night` rows. A new city shows something immediately at zero neurons. It is the full
path, and only the full path, that is rationed.

## 6. Quota budgets and guards

The old section 6 proposed a global cap of 20 cold starts a day; PLAN section 10 proposed a config
default of 50. Both were written against a dollar model and both are impossible at $0: at 4,200
neurons a wave, **one** uncapped cold start is 47% of the day, and twenty would need 84,000 neurons,
more than nine times the whole account. The two documents are reconciled here and in PLAN section 10
to the figure the arithmetic actually allows.

| Budget | Value | Behaviour when reached |
|---|---|---|
| `AI_DAILY_NEURON_BUDGET` | **9,000**, a deliberate margin below Cloudflare's verified 10,000 | untrusted-text jobs return `quota_exhausted` and defer; deterministic adapters carry on; the ledger fires `onExhausted` once for that provider and day and the notifier tells the owner |
| `AI_METRO_NEURON_CAP` | **4,500** = floor(9,000 / 2) | that metro stops extracting for the day; its pages keep their old content hash so tomorrow retries them. Other metros are untouched, which is the whole point of the cap |
| Per metro per day, budgeted | 2,203 of the 4,500 allowed (section 3) | — |
| `AI_DAILY_REQUEST_BUDGET` | 50 | the daily ceiling applied to a request-metered provider whose own figure we could not verify, taken from the lowest free-tier day the survey did verify: OpenRouter's `FREE_MODEL_NO_CREDITS_RPD = 50` |
| `AI_PROVIDER_ORDER` | `gemini,groq,openrouter,cloudflare` | the chain own-facts jobs walk. Untrusted-text jobs are filtered by `routableFor()` before the order is read at all, so they reach Cloudflare and nowhere else however this string is set |
| Cold starts per day, global | **1**, and **2 only on a day when no metro runs its daily harvest** | further requests show "we'll scout this city soon" and queue for tomorrow |
| Cold-start wave per night | 40 extractions, about 1,972 neurons | the wave ends; the metro stays `warming` and continues tomorrow night |
| Submissions | outside the metro budget, from the leftover margin | a submission when the day is gone is drafted deterministically and queued for tonight's reset |
| Paid spend | $0 | `AI_ENABLE_PAID` is false; with it unset, `ANTHROPIC_API_KEY` alone switches nothing on |

**Why 9,000 and not 10,000.** Cloudflare's verified allocation is 10,000 neurons a day, and running
out of it is a hard stop — error 3036 with HTTP 429 — that arrives in the middle of a call. Stopping
1,000 neurons early means the pipeline stops on its own arithmetic instead, which it can defer from
cleanly, and the same margin absorbs the gap between our token estimate and Cloudflare's own
accounting of the identical call. The margin is worth a little over eight reserved extractions
(1,000 ÷ 119.0 = 8.4), which is the price of never meeting the vendor's error in production.

**Why `AI_METRO_NEURON_RESERVE` was renamed.** "Reserve" reads as neurons held back from something,
and that is how the old section 3 and PLAN section 8 both described it: 500 neurons withheld from
the morning harvest so the 13:00 verification pass could not be starved. The code never did that.
`defaultMetroCap()` in `src/ai/ledger.ts` returns the most one metro may spend in a day, and the
ledger refuses any call that would take a metro past it. Held back and spending cap are near-opposite
readings of the same number, so the variable is `AI_METRO_NEURON_CAP` everywhere from here on: in
the code, in `.env.example`, in ACCOUNTS 3a and in PLAN sections 8 and 10.

`.env.example` ships `AI_DAILY_NEURON_BUDGET=9000` and `AI_METRO_NEURON_CAP=4500`. The 10000 and 500
it used to carry came from a second set of defaults in `src/config/env.ts` that no longer exists:
`src/ai/ledger.ts` owns the budget defaults, and `src/config/env.ts` parses the raw strings and
nothing more.

The reset is 00:00 UTC, which is 19:00 or 20:00 in New York and 01:00 or 02:00 in Paris. For a US
metro that is close to ideal — the fresh allowance lands just before the evening's day-of
verification matters least and well before the 03:00 harvest. For a European metro the reset lands
in the middle of the night, mid-harvest, which means a European metro's harvest can be cut off at
its busiest point and resume an hour later with a full tank. The scheduler should therefore treat
00:00 UTC as a boundary and not as a moment to plan work across.

## Appendix A. The dollar model (D-007 era, kept for the day a paid provider is switched on)

**Nothing in this appendix is in force.** It is the cost model as it stood on 2026-09-20, before
D-039 made the build free, and it is kept unchanged because it is the estimate the owner would need
the moment `AI_ENABLE_PAID` is set. Two figures in it are known to be wrong and are corrected in the
sections above rather than edited here: its extraction token counts omit the system prompt and JSON
schema and treat extraction output as one listing per page (section 2 fixes both), and its A5 cap of
20 cold starts a day is superseded by section 6's 1 or 2, which is what the neuron arithmetic allows.

Phase 0 estimate, 2026-09-20. Prices come from the live pricing pages read during the Phase 0 research (URLs in `SOURCES.md`); if a price is marked *unverified* there, it is marked here too. This is a model, not a bill: the `cost_log` table replaces it with measured spend from Phase 3 on, and the admin cost explorer shows both side by side.

### A1. Activity model for one active metro

"Active" means a metro with traffic in the last 14 days, refreshed daily. A large metro (NYC) sits at the top of these ranges; a mid-size city at the bottom. The model uses the mid values; Appendix A4 shows NYC-scale and small-city variants.

| Quantity | Symbol | Small | Mid | NYC-scale | Basis |
|---|---|---|---|---|---|
| Venues seeded (Overture, with OSM enrichment; D-028), once, refreshed monthly | V | 150 | 400 | 1,500 | night clubs, dance halls, studios, dance bars |
| Venues with hours taken from their own site or socials during harvest (no provider SKU; D-028) | V_h | 120 | 300 | 1,000 | only venues classified as likely dance venues |
| First-party sources harvested daily | S | 60 | 150 | 500 | organizer sites, studio schedules, venue calendars, feeds |
| Share of sources that change on a given day | c | 0.3 | 0.3 | 0.3 | conditional GETs and hashes skip the rest |
| Sources needing LLM extraction (no feed or JSON-LD) | s_llm | 0.55 | 0.55 | 0.55 | of the sources that changed |
| Sources needing a rendering service (client-side JS) | s_js | 0.15 | 0.15 | 0.15 | of the LLM-extracted sources |
| Cleaned page text per extraction (input tokens) | T_in | 6,000 | 6,000 | 6,000 | capped at ~12k; list pages are the long ones |
| Extraction output tokens | T_out | 900 | 900 | 900 | structured JSON with evidence snippets |
| Extraction escalation rate to the stronger model | e | 0.12 | 0.12 | 0.12 | low confidence, schema failure, non-Latin scripts |
| SERP queries per day (style × phrasing × language) | Q | 20 | 40 | 60 | Google Events, `date:today` and `date:tomorrow` |
| Ticketmaster calls per day | TM | 20 | 40 | 80 | radius search paged, tonight and next 6 days |
| Meetup / Eventbrite calls per day | ME | 30 | 80 | 200 | per known group or organizer |
| New tonight listings per day | L | 20 | 60 | 200 | after dedupe |
| Listings verified day-of | L_v | 12 | 35 | 120 | rule-inferred, stale or conflicting |
| Summaries generated per day | L_s | 20 | 60 | 200 | one per new listing, Batch API |
| Dedupe pairs sent to LLM per day | D | 5 | 15 | 60 | borderline band only |
| Style families for discovery | F | 13 | 13 | 13 | `config/styles.ts` |
| Languages per metro | Lang | 1 | 1.3 | 2 | discovery runs per family per language |
| Discovery runs per month | F × Lang × 4.3 | 56 | 73 | 112 | weekly per family per language |
| Web searches per discovery run | | 12 | 12 | 12 | `max_uses` 15 |
| Web fetches per discovery run | | 15 | 15 | 15 | `max_uses` 20 |
| Discovery tokens per run (input / output) | | 60k / 4k | 60k / 4k | 60k / 4k | fetched pages dominate input |
| Geocoding calls per month (new addresses only, cached) | G | 100 | 300 | 1,000 | |
| Submissions per month | Sub | 5 | 20 | 80 | URL, text or flyer |
| Cold starts per month (new or dormant metros, global) | | | | | modelled separately in section 5 |

Derived per month (30 days), mid column:

- Pages fetched for harvest: S × 30 = 4,500 fetches; changed: 1,350; LLM extractions: 1,350 × 0.55 ≈ 740; rendered: 740 × 0.15 ≈ 110.
- Extraction tokens: 740 × (6,000 in + 900 out) ≈ 4.4M in, 0.67M out; of which 12% escalated.
- Verification re-fetches: 35 × 30 = 1,050; about half unchanged; ≈ 500 extractions more.
- Summaries: 60 × 30 = 1,800 short calls (≈ 700 in, 120 out tokens each) via Batch.
- Dedupe adjudications: 15 × 30 = 450 short calls (≈ 1,200 in, 150 out).
- SERP: 40 × 30 = 1,200 searches. Ticketmaster: 1,200 calls. Meetup/Eventbrite: 2,400 calls.
- Places: seeding 400 venues costs a burst of Nearby/Text Search calls (≈ 60 searches returning 20 each) plus 300 Place Details with opening hours, then monthly refresh of hours only.

### A2. Unit prices used

"Live" means read on the official page or the vendor's own source repository on 2026-09-20; "mirror" means a dated third-party copy; "unverified" means nothing authoritative could be loaded. Unverified prices are the ones to confirm first (SOURCES.md section 0).

| Item | Price | Verification |
|---|---|---|
| Claude Haiku 4.5 | $1 in / $5 out per million tokens; cache read 0.1×; Batch 0.5× | live |
| Claude Sonnet 5 | $2 / $10; cache read $0.20; Batch 0.5× | live |
| Claude Opus 5 | $5 / $25; cache read $0.50 | live |
| Claude web search tool | $10 per 1,000 searches plus tokens; web fetch free of per-call charge | live |
| Firecrawl | 1 credit per page, +4 for `json`, 2 credits per 10 search results; Free 1,000 credits per month; Standard 100,000 credits at about $99 (unverified) so about $0.001 per credit at plan rate, $0.0025 as overage | credits live; dollars mirror |
| Google Places (New) per 1,000 | Nearby Search Pro $32; Text Search IDs-only $0, Pro $32; Place Details Essentials $5, Pro $17, Enterprise $20; Photos $7; monthly free caps 10,000 / 5,000 / 1,000 per Essentials / Pro / Enterprise SKU | unverified transcriptions |
| SERP discovery | Serper.dev $1 per 1,000; HasData $49 per month for 200,000 credits at 5 credits per call (about $1.23 per 1,000) with 1,000 free credits per month; SerpApi Developer $75 for 5,000 | mirrors and vendor READMEs |
| Meetup Pro | $55 per group per month | mirror |
| Ticketmaster, Eventbrite, Overpass, feeds, Punchpass, Pike13, SeatGeek, Skiddle, Fever | $0 | see SOURCES.md |
| Inngest | Hobby $0 to 50,000 executions per month; pay-as-you-go $0.50 per 1,000 runs beyond; Pro $99 | live source file |
| Vercel | Pro $20 per seat with $20 credit; variable usage about $0.45 per metro-month | mirror |
| Supabase | Pro $25 per month including one Micro instance | live pricing data |
| Plausible | $9 at 10,000 pageviews, $19 at 100,000, $29 at 200,000, $49 at 500,000 per month | live repository data |
| Upstash Redis, Sentry Developer, Resend, Cloudflare Turnstile, GeoNames, OpenFreeMap | $0 at modelled volumes | live or mirror |
| Fixed-IP fetch worker | about $5 to $10 per month (assumption, provider chosen in Phase 2) | assumption |
| Domain and DMCA agent | about $15 per year; $6 per three years | unverified |
| Apify (Tier D, OFF) | Free $5 usage, Starter $29, Scale $199; Facebook events $7 to $13 per 1,000 | mirrors |
| JamBase Startup (evaluation only) | $500 per month for commercial use | mirror |

### A3. Cost per metro-month by source (mid metro, daily refresh)

| Source | Calculation | $ per metro-month |
|---|---|---|
| Anthropic: extraction | 740 pages × (6,000 in at $1 + 900 out at $5) per million on Haiku 4.5 | 7.8 |
| Anthropic: escalation | 12% of pages on Sonnet 5 with 1.3× tokens | 2.4 |
| Anthropic: day-of verification | about 500 re-extractions on Haiku 4.5 | 5.3 |
| Anthropic: summaries | 1,800 short Batch calls on Haiku 4.5 | 1.2 |
| Anthropic: dedupe adjudication and venue classification | 450 pair calls plus about 100 venue classifications on Haiku 4.5 | 1.6 |
| Anthropic: discovery agent | 73 runs on Opus 5 × (60k in at $5 + 4k out at $25) plus 12 web searches each | 38.0 |
| Anthropic: submissions | 20 flyers or URLs on Sonnet 5 with vision | 0.3 |
| **Anthropic subtotal** | | **57** (about 95 if Sonnet 5 does all extraction) |
| Firecrawl (D-026) | about 200 renders plus optional 2,400 search credits; inside Free or Hobby for the first metros | 0.2 to 1 |
| Google Places (D-014, constrained; seed moved to Overture, D-028) | place-ID resolution on the IDs-only SKU ($0) plus occasional Details Essentials for deep links | 0 to 1 |
| Google Places if the live details panel is on | 1,800 Details Enterprise ($36) plus 1,800 photos ($12.60) per month | +49 |
| SERP discovery (D-017) | 1,200 queries on HasData or Serper | 1.5 |
| Meetup | $55 per month shared across active metros (5 assumed) | 11 |
| Ticketmaster, Eventbrite, Overpass, feeds, studio feeds, free event APIs | | 0 |
| Inngest | about 6,000 runs; free until about 8 metros, then $0.50 per 1,000 | 0 to 3 |
| Upstash, Sentry, Supabase storage | | 0 to 0.1 |
| Vercel variable usage | | 0.5 |
| Overture venue seed (D-028) | one bounding-box pull per release, seconds of compute, under 1 MB stored | 0 |
| Recognised calendar platforms: LibCal, Tockify, Teamup, Amilia, open data (9.3) | about 40 feeds a day, keyword pre-filter, about 30 Haiku classifications a day | 1 to 3 |
| Campus platforms (9.4) | about 40 requests a day for 15 institutions; classification tokens | 2 to 6 |
| HelloAsso and European ticketing (9.5; French, Nordic or UK metros only) | about 2,700 HelloAsso calls, 1,200 organiser shop pages through Firecrawl and extraction | 0 (US) to 5 (Paris) |
| Conscious-dance seeds (9.6) | about 60 seed pages once, 12 re-reads a month | 0.3 |
| Chat and newsletter connectors (9.7; after organizer connect ships) | 30 Telegram channels, 10 Discord guilds, 40 feeds; extraction tokens | 0 in v1; 8 to 15 later |
| Regional ticketing (9.8; Australian and New Zealand metros) | daily Moshtix pages | 0 to 2 |
| EDMTrain, Google Calendar API, Foursquare catalog | OFF, free under the threshold, OFF | 0 |
| **Variable total** | | **about $75 to $100** without the live Places panel in v1; **$85 to $115** once the organizer-connect channels run; add about $49 for the live Places panel |

The Anthropic discovery line is the largest and the easiest to tune: running discovery every two weeks instead of weekly halves it; running it on Sonnet 5 cuts it by 60% at some cost in recall. The extraction lines fall with change detection (weekly-updated community calendars skip extraction on most days).

### A4. Small and NYC-scale variants

| Line | Small (60 sources, 1 language) | Mid (150 sources) | NYC-scale (500 sources, 2 languages) |
|---|---|---|---|
| Anthropic | 25 | 57 | 165 |
| Firecrawl | 0.2 | 1 | 3 |
| Google Places (constrained / with live panel) | 1 / 25 | 3 / 52 | 8 / 130 |
| SERP discovery | 0.8 | 1.5 | 2.2 |
| Meetup share | 11 | 11 | 11 |
| Inngest, Upstash, Vercel | 1 | 1 to 4 | 5 |
| Gap-review sources (9.3 to 9.8, v1 set) | 2 to 5 | 3 to 14 | 6 to 25 |
| **Total** | **$41 to $68** | **$77 to $141** | **$200 to $341** |

Not in the tables: the ground-truth census (D-032) is about 16 hours of the owner's or a helper's time per test city per run, quarterly; at $40 an hour that is about $200 a month per metro, more than the automated spend, and it is the number that validates everything above.

### A5. Cold start and fixed costs

**Cold start (one new metro):** discovery for all 13 families at once, about $10 on Opus 5 plus $2 of web searches; Overture seed $0 (Places IDs only); first harvest wave of about 150 pages $2; SERP leads $0.05: about **$15 to $20 per metro**, most of it in the first ten minutes. Proposed guard: a per-metro cold-start budget of $25 and a global cap of 20 cold starts per day (about $400 per day worst case).

**Fixed, shared across metros, per month:**

| Item | $ per month |
|---|---|
| Vercel Pro (one seat) | 20 |
| Supabase Pro | 25 |
| Meetup Pro (one group) | 55 |
| Fixed-IP fetch worker | 5 to 10 |
| Plausible | 9 to 49 by traffic |
| Firecrawl plan (Free until about 2 metros with search, then Hobby $19, Standard $99 past about 10 metros) | 0 to 99 |
| SERP plan floor (HasData $49 beyond the free 200 calls; $0 with Serper credits) | 0 to 49 |
| Inngest (Pro only past about 30 metros) | 0 |
| Upstash, Sentry, Resend, Cloudflare, domain | about 2 |
| **Fixed total** | **about $115 to $310** |

At five active metros the all-in monthly cost is roughly $500 to $900; at twenty metros roughly $1,700 to $3,000, dominated by the Anthropic discovery and extraction lines.

### A6. Budgets proposed (owner to confirm)

| Budget | Proposed value | Behaviour |
|---|---|---|
| Per metro per day | $8 (small), $12 (mid), $25 (NYC-scale) | alert at 80%, hard stop at 100%, admin email |
| Cold start per metro | $25 | hard stop; metro stays `warming` with what it has |
| Cold starts per day, global | 20 | further requests show "we'll scout this city soon" and queue |
| Global per day | $150 during Phases 3 and 4; revisit at launch | hard stop on all paid calls, admin alert |
| Global per month | $2,500 initial | hard stop |
| Anthropic Console spend limit | set at the global monthly figure | the API returns 400 when reached |
| Firecrawl pay-as-you-go cap and Apify usage limit | $50 and $0 | vendor-side caps as a second fence |

## Appendix B. Workers Paid, approved up to $20 a month (D-052)

Prices read on 2026-09-27 from Cloudflare's docs source:

- Workers Paid costs a $5 minimum per month.
- The free 10,000 neurons a day continue on it.
- Usage above that costs $0.011 per 1,000 neurons.
- Workers KV (city snapshots, D-587) is included: 10M reads, 1M writes and 1 GB stored a month, then $0.50 per
  million reads and $5 per million writes (list prices, not re-checked 2026-11-03). We write about 16 cities x a few builds a day (~1,500 a month) and read
  KV about once a minute per data centre per city, so $0 today and a few dollars a month at 1M visitors a day.

The ceiling of 50,000 neurons a day costs at most 31 × 40,000 × $0.011 / 1,000 = $13.64, plus $5, which is **$18.64 a month**.

Estimates for sizing, assuming 65 neurons per page read on average and one page in five changed each day. Both figures are assumptions, not measurements; run 17 measured 21 neurons per page on the pages that finished.

| Sources needing the model | Pages read a day | Month |
|---|---|---|
| 1,000 | 200 | about $6 |
| 3,000 | 600 | about $15 |
| 10,000 | 2,000 | about $45, above the approved $20; the ceiling would defer the rest |

## Appendix C. The one-off re-read of D-074 (prompt version 2026-09-29.1)

The version bump re-reads every page the model reads, once, on the first run after it merges; after that an unchanged page is served from the cache again. Rates from `src/ai/registry.ts` (granite 1,542 in and 10,158 out, gemma 9,091 in and 27,273 out, neurons per million tokens) and reservations from `src/ai/jobs.ts` (extract 8,000 in and 10,500 out, escalate 10,400 in and 13,650 out).

**Parts.** The saved text of 18 of NYC's 19 model-read pages (`evals/links/pages`; dancesport.com has none) cuts into 41 parts under D-074's splitter, against 35 under the old one: This Week in Swing 10 (was 7), Frim Fram Jam 3 (2), RSCDS 3 (2), Big Apple Ranch 2 (1), the rest unchanged.

**Typical: about 740 neurons.** One granite call a part, input 1,390 + characters / 3.6 tokens (82,891 in all), output 0.65 tokens a character (run 21's 6-entry part wrote 0.60): 743 neurons, inside the free 10,000. The earlier estimate of about 610 counted 29 parts on 15 pages under the old splitter. An empty read of a part that writes 3 or more of the window's nights is escalated once: about 91 neurons for a 2,500-in, 2,500-out gemma call (7 parts write that many: This Week in Swing's first four, and one each of The Ronda, CDNY and NYC Swings; all 7 escalated would add about 640).

**Ledger worst case: above the metro cap, so the cap binds.** A failed call is charged at its full reservation (`src/ai/client.ts`): 119.0 neurons for granite (8,000 × 1,542 + 10,500 × 10,158, per million) and 466.8 for gemma (10,400 × 9,091 + 13,650 × 27,273). A part whose base reply fails twice and whose escalation fails once is charged 2 × 119.0 + 466.8 = 704.8; the client retries a failed escalation once too, which makes 2 × 119.0 + 2 × 466.8 = 1,171.6. Over 41 parts that is 28,897, or 48,037, plus dancesport.com's part or two. Both are above the 25,000 a metro may spend in a day (D-058, D-059), so the ledger refuses the calls past 25,000 and those pages are deferred to the next run, not failed; the earlier figure of about 20,400 used 29 parts and one escalation attempt. At Workers Paid's $0.011 per 1,000 neurons above the free 10,000, the most this day can cost NYC is 15,000 × $0.011 / 1,000 = $0.17. The vendor bills the tokens a call used; the ledger's charge for a failed call is our own upper bound, so the real bill is lower.

**Time.** Four parts at a time. A 6-entry part took 61 s in run 21; This Week in Swing's 10 parts are three rounds, about 3 to 4 minutes; the whole re-read should fit the 30-minute `MODEL_TIME_BUDGET_MS` (unverified until the run). A page past it is deferred, and its parts already read stay cached.


## Appendix D. GitHub Actions minutes: the hourly ingest and CI (D-088)

**Superseded schedule (D-089).** The owner chose two full refreshes a day, at 9:27am and 2:27pm New York time, over the hourly schedule this appendix sizes: about 1,900 billed minutes a month for the ingest (D-089), not 3,390. D1 stays as the measured cost of the hourly alternative and of a dispatched due-only run; D2's CI figures stand.

The repository is private, so Actions minutes are the binding constraint (GitHub Free includes 2,000 a month; beyond that Linux 2-core is $0.006 a minute since 1 January 2026, per third-party summaries of GitHub's price cut: **unverified** on docs.github.com from this network). Public repositories pay nothing. GitHub bills each job in whole minutes, rounded up.

**Measured, 1 to 5 October 2026:** 1,154 job-minutes: check 384, e2e 619, ingest 149 over 13 runs (about 11.5 minutes each), discover 2.

### D1. The ingest

Every figure below is re-multipliable: `pnpm eval:refresh` replays a day of the 17 hourly runs (`.github/workflows/ingest.yml`) through the cadence code itself (`src/domain/refresh.ts`, `config/refresh.ts`) over the 30 sources and per-source seconds measured in ingest run 50 (`evals/refresh/run50-sources.json`, Actions run 37334230086, 11:37am to 12:08pm ET on 2026-10-05). Its assumptions are printed at the top of `evals/refresh/replay.ts`:

- A reader's read costs its run-50 seconds every time (median 26 s; Ticketmaster 74 s, nycswings.net's item pages 113 s). A pass over all 10 readers is 406 s.
- A model page costs its run-50 seconds once a day (median 64 s cold) and 10 s on every later read that day (an unchanged page: a 304 and the extraction cache; run 50's cached pages took 1 to 25 s).
- 84 s a run outside the sources: 30 s of job setup and checks, 8 s of seeding, 16 s of dedupe, placing, place IDs and pruning, 30 s of summaries for changed listings.

| Cadence (reader / model / tonight's sources 3pm to midnight) | Reads a day | Median sources a run | Billed min a day | Min a month (×30) |
|---|---|---|---|---|
| **2 h / 6 h / hourly (built, config/refresh.ts)** | 157 | 9 | 113 | **3,390** |
| 3 h / 6 h / hourly | 138 | 9 | 107 | 3,210 |
| 4 h / 12 h / hourly | 112 | 7 | 99 | 2,970 |
| 6 h / 12 h / hourly | 93 | 4 | 86 | 2,580 |
| 12 h / 24 h / hourly | 48 | 1 | 76 | 2,280 |

The 1,500 target is not reachable with 17 runs a day: each costs at least 2 billed minutes (setup plus the round-up) before it reads anything, 34 a day and 1,020 a month, and tonight's sources read hourly from 3pm add about 9 a day. The first three runs of the day (10:17am to 12:17pm) carry the overnight backlog inside their 8-minute time boxes, 10 to 12 billed minutes each; from 1:17pm a run is 5 to 7.

The real number replaces this estimate once runs report it: every report now opens with the run's own minutes (`Run N min`, wall clock inside the ingest step; add about half a minute of setup).

Other quotas, per day at the built cadences (each re-multipliable from the run report's own counters times the reads above): Workers AI neurons barely move, because an unchanged page is a cache hit (run 50's 19 model pages, 7 cached, spent 726 neurons, and the 6-hour cadence reads a changed page once more at most); Geoapify, 44 requests in run 50's full read, scales with readers' reads (about 8 passes a day), roughly 350 a day of its 3,000 (unverified); Ticketmaster about 8 searches a day of 5,000; Google place IDs only for venues not asked in 30 days (D-066).

### D2. CI

- Docs and Markdown alone run nothing (`paths-ignore`).
- e2e runs only after a green check, and only when a path the interface is built from changed (`app/`, `src/ui/`, `src/i18n/`, `src/data/`, `src/domain/`, `src/db/`, `src/config/`, `config/`, `src/pipeline/http.ts`, `public/`, `tests/e2e/`, `package.json`, `pnpm-lock.yaml`, `next.config.*`, `playwright.config.*`, `proxy.ts`, `ci.yml`). The interface imports `src/domain/` (tonight.ts), `src/db/` (the mock repository), both config folders, and `src/pipeline/http.ts` (/bot), so those count too.
- Of the 66 commits on main from 1 to 5 October, 6 were docs only and 29 touched those paths. At that mix the check runs on about 91% of pushes (384 → about 350) and e2e on about 44% (619 → about 270). CI goes from 1,003 to about 620 minutes per 5 days, a cut of about 38%: short of the half asked for. The interface paths alone (without `src/domain/`, `src/db/` and the config folders) would cut 53 to 58%, but would let a change to tonight.ts reach main untested in a browser.

### D3. The month

At October's pace (6 five-day periods): CI about 3,700, the ingest 3,390 at the built cadences, discovery about 30 (one run a day, 1 minute): about 7,100 a month, 5,100 over GitHub Free's 2,000, about $31 at $0.006 (unverified). CI's share falls as the lanes finish. The owner chooses between this and slower cadences or a public repository (the Q4BEN comment on the D-088 pull request).

### D4. One full read a day, measured per metro

| Metro | Run (date, id) | Run minutes (inside the ingest step) | AI spent | Listings written |
|---|---|---|---|---|
| Miami | 2026-10-31, 41205632582 | 13.6 (66 sources) | $0.015 (3 model calls, Bedrock; 6 of 7 model pages cached) | 511 |
| Rio de Janeiro | 2026-10-30, 41063406759 | 34.9 (11 sources) | $0.009 (2 model calls, Bedrock) | 169 |
| Buenos Aires | 2026-10-30, 41063400400 | 20.6 (job 25.6) | $0.026 (7 model calls, Bedrock) | 215 |
| Mexico City | 2026-10-30, 41063403269 | about 8 (27 sources) | $0.013 (Bedrock) | 129 |
| Lisbon | 2026-10-30, 41107033327 | 5.8 (86 sources, job 6.6) | $0.039 (17 model calls) | 165 |
| Barcelona | 2026-10-30, 41067128356 | 12.2 (48 sources) | $0.05 (5 model calls, Bedrock; 7 of 10 model pages cached) | 342 |
| Philadelphia | 2026-10-31, 41159124929 | 16.1 (job 16.9) | $0.052 (14 model calls, Bedrock; 15 of 24 model pages cached) | 274 |
| Raleigh | 2026-10-31, 41179583628 | 2.4 (inside the ingest step) | $0.032 (10 model calls, Bedrock; 5 of 9 model pages cached) | 40 |
| London | 2026-10-31, 41180675028 | 49.6 (232 sources, 220 read; time box 70) | $0.147 (41 model calls, Bedrock; 73 of 89 model pages cached) | 1,781 |
| San Juan | 2026-10-31, 41207121279 | 3.1 (16 sources, job 4.0) | $0 (0 model calls; 2 model pages, both cached) | 88 |
| New Orleans | 2026-10-31, 41205634156 | 12.3 (34 sources, 33 read; job 16.3) | $0.122 (34 extraction calls, Bedrock; 5 of 11 model pages cached) | 259 |
| Hong Kong | 2026-10-31, 41209463374 | 1.6 (5 sources; job 2.1) | $0.0048 (1 extraction + 4 summary calls, Bedrock; 2 of 3 model pages cached) | 31 |
| Tokyo | 2026-11-09, 42712117628 | 8.8 (18 sources) | $0.017 (deepseek.v3.2 on Bedrock; Shinseiki and Leon pages cached) | 529 |
| Dubai | 2026-11-11, 42956111758 | 6.7 (46 sources read) | $0.070 (15 model calls, deepseek.v3.2 on Bedrock; 21 of 31 model pages cached) | 203 |

London is about 50 billed minutes a day (about 1,500 a month), the largest metro (232 sources), and about $4.50 a
month of AI at $0.15 a read.
At one read a day, Miami is about 15 billed minutes a day (about 450 a month) and under $1 a month of AI.
Rio de Janeiro is about 40 billed minutes a day (about 1,200 a month) and about $0.30 a month of AI; most of its
time is Sympla (4 lists of 5 pages, each event page fetched politely).
Buenos Aires is about 26 billed minutes a day (about 780 a month) and under $1 a month of AI; most of its time is
Venti's sitemap (Crawl-delay 10).
Mexico City is about 8 billed minutes a day (about 240 a month) and $0.01 to $0.13 of AI a day, well under its
$1 cap; Salón Los Ángeles is one page a run (Crawl-delay 3600).
Lisbon is about 7 billed minutes a day (about 210 a month) and about $1.20 a month of AI.
San Juan is about 4 billed minutes a day (about 120 a month) and almost no AI: on 2026-10-31 its two model pages
(7eight7, Cambio en Clave) both came from the cache, so the read spent $0 against its $1 a day metro cap.
Barcelona is about 13 billed minutes a day (about 400 a month) and $1 to $4 a month of AI: its three runs of
2026-10-30 spent $0.03, $0.13 (17 model calls, 3 of 10 pages cached) and $0.05, against its $1 a day metro cap.
Philadelphia is about 17 billed minutes a day (about 510 a month) and about $1.60 a month of AI. Its 2026-10-30
read (41063390514) took 11.4 minutes, $0.036 (12 model calls) and wrote 219; the 10-31 read adds the near suburbs
(D-511) and Resident Advisor (D-505).
Raleigh is about 3 billed minutes a day (about 90 a month) and about $1 a month of AI; most of its sources are
Eventbrite organisers read through the API, and only 9 pages go to the model.

New Orleans is about 16 billed minutes a day (about 480 a month) and $0.03 to $0.12 of AI a day, under its $1
metro cap. Its 2026-10-30 daily read (41063397796) took 9m42s, $0.025 and wrote 255; the 10-31 read adds
Resident Advisor (area 606, D-509) and more pages sent to the model. WWOZ Livewire (D-342) and DanceUS (D-343)
give most listings and need no model; the model reads the venue pages (Ohm, Oz, Santos, the WWII Museum).
Its D-496 nights on 2026-10-31: Mon 11, Tue 8, Wed 12, Thu 14, so every weeknight has at least 5.

Hong Kong is about 3 billed minutes a day (about 90 a month) and under $0.20 a month of AI at $0.005 a read.
Resident Advisor (area 71) and the Salsa Vida guide (JSON-LD) need no model; only hksalsa.com, Agozar and the
Fringe Club page go to the model, and two of those three were cached on 2026-10-31.

Tokyo is about 9 billed minutes a day (about 270 a month) and under $1 a month of AI at about $0.02 a read.
Resident Advisor (area 27), the TokyoTango milonga sheet, the Studio JBA and Las Risas Google Calendars, the Meetup ICS
feeds and Salsa Vida's JSON-LD need no model; only the venue pages (Leon, Studio Pepe, Shinseiki and the club pages) go
to the model. Its D-496 nights from the 2026-11-09 read: Mon 17, Tue 31, Wed 37, Thu 36.

Dubai is about 7 billed minutes a day (about 210 a month) and about $2 a month of AI at $0.06 to $0.07 a read,
under its $1 a day metro cap (reads 5 and 6, 2026-11-10/11, 6.7 to 6.9 minutes). Resident Advisor (area 136), Salsa
Vida's JSON-LD, Papa Dubai's JSON-LD and the hand-checked Instagram nights need no model; most listings (154 of 203
on read 6) come from the model reading venue pages (Penthouse, Little Havana, The Phoenix, Avenue Club, Bâoli).
Its D-496 nights from the 2026-11-11 read: Mon 8, Tue 10, Wed 12, Thu 14.
