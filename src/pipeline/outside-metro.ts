import { normalizeForMatch } from "@/config/styles";

export type OutsideListing = { title: string; night: string };

/**
 * Whether a stored row of this source is one of the listings a read left out as outside the
 * metro. Exact: same trimmed title and night. Loose: same night, and one normalized title
 * contains the other, the shorter at least 8 characters; never for a row this run listed.
 */
export function outsideMatch(
  outside: readonly OutsideListing[],
  row: { id: string; title: string; nightDate: string },
  listedIds: ReadonlySet<string>,
): boolean {
  // 1. exact match (today's behaviour, kept even for a listed row)
  const trimmedRowTitle = row.title.trim();
  const exact = outside.some(
    (entry) => entry.night === row.nightDate && entry.title.trim() === trimmedRowTitle,
  );
  if (exact) return true;

  // 2. row was listed this run (written or kept) -> false
  if (listedIds.has(row.id)) return false;

  // 3. loose match
  const rowNorm = normalizeForMatch(row.title);
  if (rowNorm.length === 0) return false;

  for (const entry of outside) {
    if (entry.night !== row.nightDate) continue;
    const entryNorm = normalizeForMatch(entry.title);
    if (entryNorm.length === 0) continue;

    const shorter = rowNorm.length < entryNorm.length ? rowNorm : entryNorm;
    const longer = rowNorm.length < entryNorm.length ? entryNorm : rowNorm;
    if (shorter.length >= 8 && longer.includes(shorter)) {
      return true;
    }
  }

  // 4. no match
  return false;
}
