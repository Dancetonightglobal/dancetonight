// `pnpm ingest --metro nyc`: run the ingestion pipeline for one metro (SPEC section 11,
// Phase 2; the pipeline is src/pipeline/ingest.ts).
//
//   --metro <slug>      required
//   --only <url>        harvest one source (repeatable), for a quick check
//   --full              read every enabled source, due or not, with no time box (D-088)
//   --record <dir>      write every request and response to <dir> as fixtures, keys masked
//   --report <file.txt> also write the report as text and as JSON beside it
//
// Needs DATABASE_URL (or DIRECT_DATABASE_URL). Keys are read from the environment; an adapter
// whose key is missing is reported as not configured, and the run carries on. Exits 1 only when
// the run itself cannot proceed (no database, no metro); a failing source is reported, not fatal.

import { writeFile } from "node:fs/promises";

import { closeDb, getDb } from "@/src/db/client";
import { jobRuns } from "@/src/db/schema";
import {
  buildUserAgent,
  createPoliteHttp,
  fetchTransport,
  recordingTransport,
} from "@/src/pipeline/http";
import { MODEL_TIME_BUDGET_MS, formatReport, runIngest } from "@/src/pipeline/ingest";
import { REFRESH } from "@/config/refresh";
import {
  allAiProviders,
  consoleAiLogger,
  createAiClient,
  createQuotaLedger,
  readAiBudgetConfig,
} from "@/src/ai";
import { postgresExtractionCache, postgresQuotaStore } from "@/src/pipeline/ai-stores";
import { loadMetro } from "@/src/pipeline/store";
import { robotsWaivedHosts } from "@/src/pipeline/robots-waiver";
import { METRO_SOURCES } from "@/config/sources";
import { eq } from "drizzle-orm";

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((value, i) => {
    if (value === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}

/** The keys an adapter may put in a URL: masked in recorded fixtures. */
const SECRET_ENV = [
  "TICKETMASTER_API_KEY",
  "SKIDDLE_API_KEY",
  "SABAKI_API_KEY",
  "GEOAPIFY_API_KEY",
  "GOOGLE_MAPS_SERVER_KEY",
  "GOOGLE_CALENDAR_API_KEY",
  "EVENTBRITE_PRIVATE_TOKEN",
  "CLOUDFLARE_AI_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
];

async function main(): Promise<number> {
  const slug = args("metro")[0];
  if (!slug) {
    console.error("usage: pnpm ingest --metro nyc [--only <url>] [--full] [--record <dir>]");
    return 2;
  }
  const db = getDb();
  const metro = await loadMetro(db, slug);
  if (!metro) {
    console.error(`no metro "${slug}" in the database; run pnpm db:seed first`);
    return 1;
  }

  const env = process.env as Record<string, string | undefined>;
  // An unset repository variable arrives as an empty string, not undefined.
  const baseUrl = env.PUBLIC_BASE_URL?.trim() || "https://dancetonightglobal.com";
  const contact = env.BOT_CONTACT_EMAIL?.trim() || undefined;
  if (!contact)
    console.warn(
      "BOT_CONTACT_EMAIL is not set: the crawler identifies itself without a contact address (D-021).",
    );
  const recordDir = args("record")[0];
  const secrets = SECRET_ENV.map((name) => env[name]).filter((v): v is string => !!v);
  const transport = recordDir
    ? recordingTransport(fetchTransport, recordDir, secrets)
    : fetchTransport;
  const http = createPoliteHttp({
    transport,
    userAgent: buildUserAgent(baseUrl, contact),
    // D-831: hosts whose owner gave written permission despite robots.txt (each cites a decision).
    robotsWaivedHosts: robotsWaivedHosts(METRO_SOURCES[slug] ?? []),
  });

  // Model extraction runs when the Cloudflare keys are present: it is the only provider allowed to
  // read a fetched page (D-039). The ledger's counters live in Postgres so the morning run and the
  // afternoon re-check share one day's allowance (PLAN 8.5).
  // An hourly run reads only what is due, inside its time box; --full reads everything (D-088).
  // A full read has its own 70-minute box (D-159).
  const full = process.argv.includes("--full");
  const timeBoxMs = REFRESH.runTimeBoxMinutes * 60_000;
  const fullTimeBoxMs = REFRESH.fullReadTimeBoxMinutes * 60_000;
  const aiOn = !!(env.CLOUDFLARE_ACCOUNT_ID?.trim() && env.CLOUDFLARE_AI_TOKEN?.trim());
  const ai = aiOn
    ? {
        client: createAiClient({
          providers: allAiProviders(),
          ledger: createQuotaLedger({
            store: postgresQuotaStore(db),
            config: readAiBudgetConfig(),
          }),
          logger: consoleAiLogger,
          mock: false,
        }),
        cache: postgresExtractionCache(db),
        // A scheduled run's model time is inside its time box; a full read keeps D-050's 30 minutes.
        timeBudgetMs: full ? MODEL_TIME_BUDGET_MS : timeBoxMs,
        // Summaries of the whole window (D-109): not on a quick check of a few sources.
        summarize: !args("only")?.length,
      }
    : null;
  if (!ai) console.warn("Cloudflare keys are not set: pages without a feed wait for extraction.");

  const [run] = await db
    .insert(jobRuns)
    .values({ job: "ingest", metroId: metro.id })
    .returning({ id: jobRuns.id });
  try {
    const report = await runIngest({
      db,
      metro,
      http,
      env,
      now: () => new Date(),
      log: (line) => console.log(line),
      only: args("only"),
      full,
      timeBoxMs,
      fullTimeBoxMs,
      runId: run?.id,
      ai,
      concurrency: REFRESH.harvestConcurrency,
    });
    const text = formatReport(report);
    console.log("");
    console.log(text);
    const reportPath = args("report")[0];
    if (reportPath) {
      await writeFile(reportPath, `${text}\n`);
      await writeFile(
        reportPath.replace(/\.txt$/, "") + ".json",
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (run) {
      await db
        .update(jobRuns)
        .set({ status: "failed", finishedAt: new Date(), error: message })
        .where(eq(jobRuns.id, run.id));
    }
    throw error;
  }
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error("ingest failed:", error instanceof Error ? error.message : error);
    await closeDb();
    process.exit(1);
  });
