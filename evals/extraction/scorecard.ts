// Extraction scorecard (D-897): the same real pages, read by each model that may read page text, scored side by side.
//   pnpm -s eval:scorecard [pages=40]
// Pages: the newest model-read page of a random sample of sources from the last 14 days (raw_documents, read-only),
// at most 3 per metro, one chunk long (500..4,000 characters, so no chunking differs between models). Each page goes
// to every model with the pipeline's own prompt (EXTRACT_SYSTEM, extractUserTurn) and schema. Only Workers AI and
// Bedrock are called: the providers whose terms forbid training on input (routableFor, CLAUDE.md). Nothing is written.
//
// There is no hand-labelled answer for these pages, so the scores are proxies:
//   valid      the reply parsed and passed the schema;
//   events     listings returned;
//   grounded   share of listings whose title words (3+ letters) are at least 60% on the page (a made-up title fails);
//   vs DeepSeek recall and precision against DeepSeek V3.2's listings on the same page (same date, title words 50%
//              alike), and, for matched listings, whether the stated times agree.
import postgres from "postgres";

import { BEDROCK_META, createBedrockProvider } from "@/src/ai/providers/bedrock";
import { CLOUDFLARE_MODELS, createCloudflareProvider } from "@/src/ai/providers/cloudflare";
import { EXTRACT_JSON_SCHEMA, EXTRACT_SYSTEM, extractUserTurn } from "@/src/ai/prompts";
import { jobById } from "@/src/ai/jobs";
import type { AiModel, AiProvider } from "@/src/ai/types";
import { rawExtractionSchema, type RawExtraction } from "@/src/domain/listing";
import { currentNightDate } from "@/src/domain/tonight";

const NEURON_USD = 0.011 / 1000;
const BEDROCK_IN = 0.62 / 1e6;
const BEDROCK_OUT = 1.85 / 1e6;

interface Contender {
  label: string;
  provider: AiProvider;
  model: AiModel;
}

interface Page {
  url: string;
  slug: string;
  tz: string;
  fetchedAt: Date;
  platform: string | null;
  text: string;
}

interface Read {
  ok: boolean;
  detail: string;
  ms: number;
  usd: number;
  extraction: RawExtraction | null;
}

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const words = (s: string) =>
  norm(s)
    .split(" ")
    .filter((w) => w.length >= 3);

function grounded(title: string, pageWords: Set<string>): boolean {
  const w = words(title);
  if (w.length === 0) return true;
  return w.filter((x) => pageWords.has(x)).length / w.length >= 0.6;
}

function alike(a: string, b: string): boolean {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (x.size === 0 || y.size === 0) return norm(a) === norm(b);
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / Math.min(x.size, y.size) >= 0.5;
}

type Listing = RawExtraction["listings"][number];
const times = (l: Listing) => JSON.stringify([l.doors_time, l.lesson_time, l.dancing_time]);

/** Greedy one-to-one match of a model's listings to the reference's: same date (or both undated) and alike titles. */
function match(model: Listing[], ref: Listing[]): Array<[Listing, Listing]> {
  const used = new Set<number>();
  const pairs: Array<[Listing, Listing]> = [];
  for (const m of model) {
    const i = ref.findIndex(
      (r, k) => !used.has(k) && r.local_date === m.local_date && alike(r.title, m.title),
    );
    if (i >= 0) {
      used.add(i);
      pairs.push([m, ref[i]!]);
    }
  }
  return pairs;
}

async function read(c: Contender, page: Page): Promise<Read> {
  const today = currentNightDate(page.fetchedAt, page.tz);
  const started = Date.now();
  const outcome = await c.provider.call(
    {
      job: jobById("extract"),
      system: EXTRACT_SYSTEM,
      user: extractUserTurn(
        { url: page.url, platform: page.platform, today, tz: page.tz },
        page.text,
      ),
      schema: rawExtractionSchema,
      jsonSchema: EXTRACT_JSON_SCHEMA,
    },
    c.model,
  );
  const ms = Date.now() - started;
  const usage = outcome.usage;
  const usd = !usage
    ? 0
    : c.provider.meta.id === "cloudflare"
      ? usage.cost * NEURON_USD
      : usage.inputTokens * BEDROCK_IN + usage.outputTokens * BEDROCK_OUT;
  if (!outcome.ok)
    return {
      ok: false,
      detail: `${outcome.reason}: ${outcome.detail.slice(0, 120)}`,
      ms,
      usd,
      extraction: null,
    };
  return { ok: true, detail: "", ms, usd, extraction: outcome.value };
}

async function pages(url: string, n: number): Promise<Page[]> {
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5 });
  try {
    return (await sql.begin("read only", async (tx) => {
      const rows = await tx`
        with latest as (
          select distinct on (d.source_id) d.source_id, d.url, d.fetched_at, d.cleaned_text, s.platform, m.slug, m.tz
          from raw_documents d join sources s on s.id = d.source_id join metros m on m.id = s.metro_id
          where d.extraction_method = 'llm' and d.cleaned_text is not null
            and length(d.cleaned_text) between 500 and 4000 and d.fetched_at >= now() - interval '14 days'
          order by d.source_id, d.fetched_at desc),
        ranked as (select *, row_number() over (partition by slug order by random()) as k from latest)
        select url, fetched_at, cleaned_text, platform, slug, tz from ranked where k <= 3 order by random() limit ${n}`;
      return rows.map((r) => ({
        url: String(r.url),
        slug: String(r.slug),
        tz: String(r.tz),
        fetchedAt: new Date(r.fetched_at as string),
        platform: (r.platform as string | null) ?? null,
        text: String(r.cleaned_text),
      }));
    })) as Page[];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i]!);
      }
    }),
  );
  return out;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log("DATABASE_URL is not set");
    return 2;
  }
  const n = Number(process.argv[2] ?? 40) || 40;
  const cf = createCloudflareProvider();
  const br = createBedrockProvider();
  const contenders: Contender[] = [];
  for (const id of [
    "@cf/ibm-granite/granite-4.0-h-micro",
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/openai/gpt-oss-120b",
  ]) {
    const model = CLOUDFLARE_MODELS[id];
    if (model && cf.isConfigured())
      contenders.push({ label: id.split("/").pop()!, provider: cf, model });
  }
  const deepseek = Object.values(BEDROCK_META.models)[0];
  if (deepseek && br.isConfigured())
    contenders.push({ label: "deepseek-v3.2 (bedrock)", provider: br, model: deepseek });
  console.log(`contenders: ${contenders.map((c) => c.label).join(", ")}`);
  if (!contenders.some((c) => c.provider === br))
    console.log("WARNING: Bedrock is not configured; no DeepSeek reference");

  const sample = await pages(url, n);
  const metros = [...new Set(sample.map((p) => p.slug))];
  console.log(`pages: ${sample.length} from ${metros.length} metros (${metros.join(", ")})`);

  // Every page through every model; pages four at a time, a page's models one after another.
  const results = await pool(sample, 4, async (page) => {
    const reads: Read[] = [];
    for (const c of contenders) reads.push(await read(c, page));
    const line = contenders
      .map((c, i) => `${c.label}=${reads[i]!.ok ? reads[i]!.extraction!.listings.length : "fail"}`)
      .join(" ");
    console.log(`  ${page.slug} ${page.url.slice(0, 70)} : ${line}`);
    return reads;
  });

  const refIndex = contenders.findIndex((c) => c.provider === br);
  console.log("");
  console.log(
    "model | valid | events | grounded titles | recall vs DeepSeek | precision vs DeepSeek | times agree | avg seconds | cost for these pages | cost per page",
  );
  contenders.forEach((c, ci) => {
    let valid = 0;
    let events = 0;
    let groundedN = 0;
    let refTotal = 0;
    let matchedRef = 0;
    let modelTotalOnRefPages = 0;
    let timesAgree = 0;
    let ms = 0;
    let usd = 0;
    sample.forEach((page, pi) => {
      const r = results[pi]![ci]!;
      ms += r.ms;
      usd += r.usd;
      if (!r.ok || !r.extraction) return;
      valid += 1;
      const pageWords = new Set(words(page.text));
      events += r.extraction.listings.length;
      groundedN += r.extraction.listings.filter((l) => grounded(l.title, pageWords)).length;
      const ref = refIndex >= 0 ? results[pi]![refIndex]! : null;
      if (ref?.ok && ref.extraction) {
        const pairs = match(r.extraction.listings, ref.extraction.listings);
        refTotal += ref.extraction.listings.length;
        modelTotalOnRefPages += r.extraction.listings.length;
        matchedRef += pairs.length;
        timesAgree += pairs.filter(([a, b]) => times(a) === times(b)).length;
      }
    });
    const pct = (a: number, b: number) => (b === 0 ? "-" : `${Math.round((a / b) * 100)}%`);
    console.log(
      `${c.label} | ${valid}/${sample.length} | ${events} | ${pct(groundedN, events)} | ${pct(matchedRef, refTotal)} | ${pct(matchedRef, modelTotalOnRefPages)} | ${pct(timesAgree, matchedRef)} | ${(ms / 1000 / Math.max(1, sample.length)).toFixed(1)} | $${usd.toFixed(4)} | ${((usd / Math.max(1, sample.length)) * 100).toFixed(3)}c`,
    );
  });
  console.log("");
  console.log("failures:");
  contenders.forEach((c, ci) =>
    sample.forEach((page, pi) => {
      const r = results[pi]![ci]!;
      if (!r.ok) console.log(`  ${c.label} ${page.slug} ${page.url.slice(0, 60)}: ${r.detail}`);
    }),
  );
  // A few listings DeepSeek found that each other model missed, and titles a model gave that are not on its page.
  if (refIndex >= 0) {
    console.log("");
    console.log(
      "examples (first 3 per model): missed = DeepSeek has it, the model does not; not on page = title words absent",
    );
    contenders.forEach((c, ci) => {
      if (ci === refIndex) return;
      const missed: string[] = [];
      const invented: string[] = [];
      sample.forEach((page, pi) => {
        const r = results[pi]![ci]!;
        const ref = results[pi]![refIndex]!;
        if (!r.ok || !r.extraction) return;
        const pageWords = new Set(words(page.text));
        for (const l of r.extraction.listings)
          if (!grounded(l.title, pageWords))
            invented.push(`${l.local_date ?? "undated"} "${l.title}" (${page.slug})`);
        if (!ref.ok || !ref.extraction) return;
        const pairs = match(r.extraction.listings, ref.extraction.listings);
        const got = new Set(pairs.map(([, b]) => b));
        for (const l of ref.extraction.listings)
          if (!got.has(l)) missed.push(`${l.local_date ?? "undated"} "${l.title}" (${page.slug})`);
      });
      console.log(`  ${c.label}: missed ${missed.length}, not on page ${invented.length}`);
      for (const m of missed.slice(0, 3)) console.log(`    missed ${m}`);
      for (const m of invented.slice(0, 3)) console.log(`    not on page ${m}`);
    });
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error("scorecard failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
