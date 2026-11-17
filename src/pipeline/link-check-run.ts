import { inArray } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import type { Listing } from "@/src/domain/listing";
import type { HttpClient } from "@/src/pipeline/http";
import { linkKey, checkLink, nextLinkState, type LinkCheckState } from "@/src/pipeline/link-check";
import { eventLink } from "@/src/ui/links";
import { linkChecks } from "@/src/db/schema/ops";

/** Maximum number of hosts checked in parallel (D-814). */
export const LINK_CHECK_HOST_WORKERS = 8;

/** Format an error's message and its cause (D-814). */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause: unknown = error.cause;
    if (cause !== undefined) {
      const causeText = cause instanceof Error ? cause.message : String(cause);
      return `${error.message}; cause: ${causeText}`;
    }
    return error.message;
  }
  return String(error);
}

export function cardLinkUrls(listings: readonly Listing[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const listing of listings) {
    const link = eventLink(listing);
    if (!link) continue;
    try {
      const url = new URL(link.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const key = linkKey(link.href);
      if (!seen.has(key)) {
        seen.add(key);
        urls.push(key);
      }
    } catch {
      // invalid URL, skip
    }
  }
  return urls;
}

export interface LinkRunStats {
  checked: number;
  broken: number;
  unknown: number;
  skipped: number;
  writeErrors: number;
  firstError: string | null;
}

export async function runLinkChecks(options: {
  db: Db;
  http: HttpClient;
  urls: readonly string[];
  now?: () => Date;
  deadline: number;
  write?: (
    url: string,
    state: { checkedAt: Date; broken: boolean; failures: number; reason: string | null },
  ) => Promise<void>;
}): Promise<LinkRunStats> {
  const now = options.now ?? (() => new Date());
  const stats: LinkRunStats = {
    checked: 0,
    broken: 0,
    unknown: 0,
    skipped: 0,
    writeErrors: 0,
    firstError: null,
  };

  if (options.urls.length === 0) {
    return stats;
  }

  // Default writer: upsert into link_checks
  const write =
    options.write ??
    (async (
      url: string,
      state: { checkedAt: Date; broken: boolean; failures: number; reason: string | null },
    ) => {
      await options.db
        .insert(linkChecks)
        .values({
          url,
          checkedAt: state.checkedAt,
          broken: state.broken,
          failures: state.failures,
          reason: state.reason,
        })
        .onConflictDoUpdate({
          target: linkChecks.url,
          set: {
            checkedAt: state.checkedAt,
            broken: state.broken,
            failures: state.failures,
            reason: state.reason,
          },
        });
    });

  // Load existing rows in chunks of 500
  const existing = new Map<string, LinkCheckState>();
  const chunkSize = 500;
  for (let i = 0; i < options.urls.length; i += chunkSize) {
    const chunk = options.urls.slice(i, i + chunkSize);
    const rows = await options.db.select().from(linkChecks).where(inArray(linkChecks.url, chunk));
    for (const row of rows) {
      existing.set(row.url, {
        checkedAt: row.checkedAt,
        broken: row.broken,
        failures: row.failures,
        reason: row.reason,
      });
    }
  }

  // Order: URLs with no row first, then by checked_at ascending
  const ordered = [...options.urls].sort((a, b) => {
    const hasA = existing.has(a);
    const hasB = existing.has(b);
    if (hasA && !hasB) return 1;
    if (!hasA && hasB) return -1;
    if (hasA && hasB) {
      const stateA = existing.get(a)!;
      const stateB = existing.get(b)!;
      return stateA.checkedAt.getTime() - stateB.checkedAt.getTime();
    }
    return 0;
  });

  // Group by host
  const byHost = new Map<string, string[]>();
  for (const url of ordered) {
    try {
      const host = new URL(url).hostname;
      const list = byHost.get(host);
      if (list) {
        list.push(url);
      } else {
        byHost.set(host, [url]);
      }
    } catch {
      // skip invalid URL
    }
  }

  // Worker pool: process hosts in parallel, URLs within a host sequentially
  const hostEntries = Array.from(byHost.entries());
  const workerCount = Math.min(LINK_CHECK_HOST_WORKERS, hostEntries.length);
  const workers: Promise<void>[] = [];

  for (let i = 0; i < workerCount; i++) {
    workers.push(
      (async () => {
        while (true) {
          const entry = hostEntries.shift();
          if (!entry) break;
          const [, urlsForHost] = entry;
          for (const url of urlsForHost) {
            if (now().getTime() > options.deadline) {
              stats.skipped++;
              continue;
            }
            const prev = existing.get(url) ?? null;
            const verdict = await checkLink(options.http, url);
            const state = nextLinkState(prev, verdict, now());
            if (state === null) {
              stats.unknown++;
              continue;
            }
            stats.checked++;
            if (state.broken) stats.broken++;
            try {
              await write(url, state);
            } catch (error) {
              stats.writeErrors++;
              if (stats.firstError === null) {
                stats.firstError = errorText(error);
              }
            }
          }
        }
      })(),
    );
  }

  await Promise.all(workers);

  return stats;
}
