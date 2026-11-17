// `pnpm discover --metro nyc`: probe the seeded venues' own websites for calendars (D-040 step 3,
// D-120; the run is src/pipeline/discovery/run.ts).
//
//   --metro <slug>      required
//   --limit <n>         hosts to probe this run (default DISCOVERY_PROBES_PER_RUN)
//   --record <dir>      write every request and response to <dir> as fixtures
//   --report <file.txt> also write the report as text and as JSON beside it
//
// Needs DATABASE_URL (or DIRECT_DATABASE_URL) and a seeded `venues` table (`pnpm seed:venues`).
// No key and no model: discovery calls no model (D-040). The `adapter.venue_websites` flag
// switches it off.

import { writeFile } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { venueWebsitesAdapter } from "@/src/adapters/registry/discovery";
import { closeDb, getDb } from "@/src/db/client";
import { jobRuns } from "@/src/db/schema";
import {
  formatDiscoveryReport,
  runVenueDiscovery,
  DISCOVERY_PROBES_PER_RUN,
} from "@/src/pipeline/discovery/run";
import { buildUserAgent, createPoliteHttp, recordingTransport } from "@/src/pipeline/http";
import { discoveryTransport, manualFetchTransport } from "@/src/pipeline/discovery/transport";
import { loadFlags, mayRun } from "@/src/pipeline/runner";
import { loadBlocklist, loadMetro } from "@/src/pipeline/store";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const slug = arg("metro");
  if (!slug) {
    console.error(
      "usage: pnpm discover --metro nyc [--limit 80] [--record <dir>] [--report <file>]",
    );
    return 2;
  }
  const limitArg = arg("limit");
  const limit = limitArg === undefined ? DISCOVERY_PROBES_PER_RUN : Number(limitArg);
  if (!Number.isInteger(limit) || limit < 0) {
    console.error(`--limit must be a whole number, not "${limitArg}"`);
    return 2;
  }
  const db = getDb();
  const metro = await loadMetro(db, slug);
  if (!metro) {
    console.error(`no metro "${slug}" in the database; run pnpm db:seed first`);
    return 1;
  }
  const env = process.env as Record<string, string | undefined>;
  const gate = mayRun(venueWebsitesAdapter, metro, env, await loadFlags(db, metro.id));
  if (!gate.run) {
    console.log(`venue-website discovery does not run for ${metro.name}: ${gate.detail}`);
    return 0;
  }

  const baseUrl = env.PUBLIC_BASE_URL?.trim() || "https://dancetonightglobal.com";
  const contact = env.BOT_CONTACT_EMAIL?.trim() || undefined;
  const recordDir = arg("record");
  // Redirects are followed within a site only, and never to a private address (transport.ts).
  // Discovery sends no key, so recorded fixtures need no mask.
  const transport = discoveryTransport({
    inner: recordDir ? recordingTransport(manualFetchTransport, recordDir) : manualFetchTransport,
  });
  const http = createPoliteHttp({
    transport,
    userAgent: buildUserAgent(baseUrl, contact),
    blocklist: await loadBlocklist(db),
  });

  const [run] = await db
    .insert(jobRuns)
    .values({ job: "discover_venues", metroId: metro.id })
    .returning({ id: jobRuns.id });
  try {
    const report = await runVenueDiscovery({
      db,
      metro,
      http,
      now: () => new Date(),
      limit,
      seedUrls: [
        ...(METRO_SOURCES[metro.slug] ?? []).map((s) => s.url),
        ...(METRO_RETIRED_SOURCES[metro.slug] ?? []).map((s) => s.url),
      ],
      log: (line) => console.log(line),
    });
    const text = formatDiscoveryReport(report);
    console.log("");
    console.log(text);
    const reportPath = arg("report");
    if (reportPath) {
      await writeFile(reportPath, `${text}\n`);
      await writeFile(
        reportPath.replace(/\.txt$/, "") + ".json",
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    if (run) {
      await db
        .update(jobRuns)
        .set({
          finishedAt: new Date(),
          status: "succeeded",
          stats: {
            listingsBySource: {},
            newEvents: 0,
            mergedEvents: 0,
            errors: report.probed.filter((l) => l.status === "unreachable").length,
            costUsd: 0,
          },
        })
        .where(eq(jobRuns.id, run.id));
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

if (process.argv[1]?.endsWith("discover.ts")) {
  main()
    .then(async (code) => {
      await closeDb();
      process.exit(code);
    })
    .catch(async (error: unknown) => {
      console.error("discover failed:", error instanceof Error ? error.message : error);
      await closeDb();
      process.exit(1);
    });
}
