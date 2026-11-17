// The daily check of each card's own link (D-768, the owner 2026-11-06 "flag, keep card"): every city's
// listed cards, their one link out, checked politely; a broken link flags the card, never hides it.
// `pnpm link:check [--metro <slug>]`, run by .github/workflows/link-check.yml.
import { closeDb, getDb } from "@/src/db/client";
import { DbListingsRepository } from "@/src/data/db-repository";
import { jobRuns } from "@/src/db/schema/ops";
import { createPoliteHttp, fetchTransport, buildUserAgent } from "@/src/pipeline/http";
import { cardLinkUrls, runLinkChecks, errorText } from "@/src/pipeline/link-check-run";

/** The daily check's time box (the owner 2026-11-06). */
const LINK_CHECK_MINUTES = 10;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const db = getDb();
  const repo = new DbListingsRepository(getDb);
  const now = new Date();

  // Determine which metros to process
  const metroSlug = arg("metro");
  const cities = metroSlug ? [metroSlug] : (await repo.listCities(now)).map((c) => c.slug);

  const allUrls: string[] = [];
  const metroIds: string[] = [];

  for (const slug of cities) {
    const snapshot = await repo.buildCitySnapshot(slug, now);
    if (!snapshot) {
      console.error(`No snapshot for ${slug}`);
      continue;
    }
    const urls = cardLinkUrls(snapshot.listings);
    allUrls.push(...urls);
    metroIds.push(snapshot.metroId);
  }

  // Unique URLs while preserving order (first seen)
  const uniqueUrls = Array.from(new Set(allUrls));

  // As src/jobs/ingest.ts: an unset repository variable arrives as an empty string (D-021).
  const baseUrl = process.env.PUBLIC_BASE_URL?.trim() || "https://dancetonightglobal.com";
  const contact = process.env.BOT_CONTACT_EMAIL?.trim() || undefined;
  const userAgent = buildUserAgent(baseUrl, contact);
  const http = createPoliteHttp({
    transport: fetchTransport,
    userAgent,
  });

  // the owner 2026-11-06: a 10-minute box a day (Actions minutes); the oldest checks go first, so the
  // links not reached today are checked on a later day.
  const deadline = Date.now() + LINK_CHECK_MINUTES * 60_000;
  const stats = await runLinkChecks({
    db,
    http,
    urls: uniqueUrls,
    deadline,
  });

  // One job_runs row per city read: its snapshot rebuilds with the new flags (D-768).
  const contributingMetroIds = new Set(metroIds);

  for (const metroId of contributingMetroIds) {
    await db.insert(jobRuns).values({
      job: "link-check",
      metroId,
      startedAt: now,
      finishedAt: new Date(),
      status: "succeeded",
      stats: { errors: stats.writeErrors, ...stats },
    });
  }

  console.log(
    `Checked ${stats.checked} links (${stats.broken} broken, ${stats.unknown} unknown, ${stats.skipped} skipped, ${stats.writeErrors} write errors) for ${contributingMetroIds.size} cities.`,
  );
  if (stats.firstError !== null) {
    console.error(`first write error: ${stats.firstError}`);
  }
  return 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error("link check failed:", errorText(error));
    await closeDb();
    process.exit(1);
  });
