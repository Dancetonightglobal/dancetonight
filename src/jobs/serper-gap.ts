// `pnpm eval:serper-gap --metro nyc`: measure once what the retired search-driven discovery would
// find that the deterministic path misses (D-040, D-125; the run is
// src/pipeline/discovery/serp-gap.ts).
//
//   --metro <slug>         required
//   --max-queries <n>      searches this run (default SERP_GAP_MAX_QUERIES, one credit each)
//   --probe-limit <n>      missed hosts probed, best-placed first (default 200)
//   --out <dir>            where the CSV and the summary go (default evals/recall/serper-gap)
//
// Needs SERPER_API_KEY (ACCOUNTS 3f: the free sign-up grant) and DATABASE_URL, read only: the
// sources we hold and the seeded venues' websites. Writes nothing to the database. Not scheduled:
// the integrator dispatches .github/workflows/serper-gap.yml once per test metro.

import { mkdir, writeFile } from "node:fs/promises";

import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { closeDb, getDb } from "@/src/db/client";
import { localDateOf } from "@/src/domain/time";
import { loadKnownHosts, loadVenueSites } from "@/src/pipeline/discovery/run";
import { siteHost } from "@/src/pipeline/discovery/hosts";
import {
  formatGapReport,
  gapCsv,
  runSerpGap,
  SERP_GAP_MAX_QUERIES,
} from "@/src/pipeline/discovery/serp-gap";
import { discoveryTransport, manualFetchTransport } from "@/src/pipeline/discovery/transport";
import { buildUserAgent, createPoliteHttp } from "@/src/pipeline/http";
import { loadBlocklist, loadMetro } from "@/src/pipeline/store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function whole(name: string, fallback: number): number | null {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

async function main(): Promise<number> {
  const slug = arg("metro");
  const maxQueries = whole("max-queries", SERP_GAP_MAX_QUERIES);
  const probeLimit = whole("probe-limit", 200);
  if (!slug || maxQueries === null || probeLimit === null) {
    console.error(
      "usage: pnpm eval:serper-gap --metro nyc [--max-queries 130] [--probe-limit 200] [--out <dir>]",
    );
    return 2;
  }
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) {
    console.error("SERPER_API_KEY is not set (docs/ACCOUNTS.md 3f)");
    return 2;
  }
  const db = getDb();
  const metro = await loadMetro(db, slug);
  if (!metro) {
    console.error(`no metro "${slug}" in the database; run pnpm db:seed first`);
    return 1;
  }
  const seedUrls = [
    ...(METRO_SOURCES[metro.slug] ?? []).map((s) => s.url),
    ...(METRO_RETIRED_SOURCES[metro.slug] ?? []).map((s) => s.url),
  ];
  const sources = new Set((await loadKnownHosts(db, seedUrls)).keys());
  const venueSites = new Set(
    (await loadVenueSites(db, metro.id))
      .map((v) => siteHost(v.websiteUrl))
      .filter((h): h is string => !!h),
  );

  const env = process.env as Record<string, string | undefined>;
  const http = createPoliteHttp({
    // The key travels in a header to Serper only; nothing here records requests.
    transport: discoveryTransport({ inner: manualFetchTransport }),
    userAgent: buildUserAgent(
      env.PUBLIC_BASE_URL?.trim() || "https://dancetonightglobal.com",
      env.BOT_CONTACT_EMAIL?.trim() || undefined,
    ),
    blocklist: await loadBlocklist(db),
    // Serper's /resolve waits for Google: ~30 s (D-512).
    timeoutMs: 60_000,
  });
  const report = await runSerpGap({
    metro,
    http,
    apiKey,
    held: { sources, venueSites },
    now: () => new Date(),
    maxQueries,
    probeLimit,
    log: (line) => console.log(line),
  });
  const text = formatGapReport(report);
  console.log("");
  console.log(text);
  const out = arg("out") ?? "evals/recall/serper-gap";
  await mkdir(out, { recursive: true });
  const base = `${out}/${metro.slug}-${localDateOf(new Date(), metro.tz)}`;
  await writeFile(`${base}.csv`, gapCsv(report));
  await writeFile(`${base}.txt`, `${text}\n`);
  console.log(`wrote ${base}.csv and ${base}.txt`);
  return 0;
}

if (process.argv[1]?.endsWith("serper-gap.ts")) {
  main()
    .then(async (code) => {
      await closeDb();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      await closeDb();
      process.exit(1);
    });
}
