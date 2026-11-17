import { inArray, eq, and } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import type { Listing } from "@/src/domain/listing";
import { eventLink } from "@/src/ui/links";
import { linkKey } from "@/src/pipeline/link-check";
import { linkChecks } from "@/src/db/schema/ops";

/**
 * Attach `linkBrokenAt` to listings whose card link is marked broken in `link_checks`.
 *
 * For each listing, the card link is `eventLink(listing)`. When that link exists, its key
 * (`linkKey(link.href)`) is looked up in `link_checks` where `broken = true`. If a broken row
 * exists, the listing is returned with `linkBrokenAt` set to the row's `checked_at` (ISO string).
 *
 * If the `link_checks` table does not exist (migration not yet applied), the function returns
 * the input unchanged.
 */
export async function attachLinkFlags(db: Db, listings: Listing[]): Promise<Listing[]> {
  if (listings.length === 0) return [];

  // Gather unique keys from each listing's card link
  const keys = new Set<string>();
  const keyByListing: (string | null)[] = [];

  for (const listing of listings) {
    const link = eventLink(listing);
    const key = link ? linkKey(link.href) : null;
    keyByListing.push(key);
    if (key !== null) keys.add(key);
  }

  if (keys.size === 0) return listings;

  const keyArray = Array.from(keys);

  try {
    const chunkSize = 500;
    const brokenMap = new Map<string, Date>();

    for (let i = 0; i < keyArray.length; i += chunkSize) {
      const chunk = keyArray.slice(i, i + chunkSize);
      const rows = await db
        .select({
          url: linkChecks.url,
          checkedAt: linkChecks.checkedAt,
        })
        .from(linkChecks)
        .where(and(inArray(linkChecks.url, chunk), eq(linkChecks.broken, true)));

      for (const row of rows) {
        brokenMap.set(row.url, row.checkedAt);
      }
    }

    // Build new array with linkBrokenAt where applicable
    return listings.map((listing, index) => {
      const key = keyByListing[index] ?? null;
      if (key === null) return listing;
      const checkedAt = brokenMap.get(key);
      if (checkedAt === undefined) return listing;
      return {
        ...listing,
        linkBrokenAt: checkedAt.toISOString(),
      };
    });
  } catch (error) {
    // The deploy can run before the migration: no table yet means no flags (Postgres 42P01).
    if (isUndefinedTable(error)) return listings;
    throw error;
  }
}

/** Postgres "undefined_table" (42P01), on the error itself or on the driver error drizzle wraps. */
function isUndefinedTable(error: unknown): boolean {
  const code = (e: unknown): unknown =>
    typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  const cause =
    typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  return code(error) === "42P01" || code(cause) === "42P01";
}
