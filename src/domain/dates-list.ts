import type { HarvestedListing } from "@/src/adapters/types";
import { isDateHeading, statesDate, statesAnyDate } from "@/src/domain/text-facts";
import { readBlockTimes } from "@/src/domain/stated-times";

/**
 * Whether a model's recurrence_text is a rule ("Every Wednesday"), not a list of dates. The Fringe
 * Club's read writes its rows there ("Wed 04-11-2026, Wed 11-11-2026", production 2026-10-31), and
 * a list of dates is what the steps below expand.
 */
function statesRule(text: string | null | undefined, lang?: string | null): boolean {
  if (text == null || text.trim() === "") return false;
  const parts = text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const isDate = (part: string) =>
    statesAnyDate(part, lang) || /(?<!\d)\d{1,2}-\d{1,2}-\d{4}(?!\d)/.test(part);
  return !(parts.length > 0 && parts.every(isDate));
}

/**
 * For a dates-only list under one title, adds one listing per listed date that the model missed.
 *
 * @param listings The model's harvested listings.
 * @param pageText The full page text.
 * @param nights ISO dates (`YYYY-MM-DD`) of the read window, in order.
 * @param lang Optional page language.
 * @returns New array with added copies, and count of added listings.
 */
export function withListedDates(
  listings: HarvestedListing[],
  pageText: string,
  nights: readonly string[],
  lang?: string | null,
): { listings: HarvestedListing[]; added: number } {
  // No listings to copy from: return unchanged.
  if (listings.length === 0) {
    return { listings: [...listings], added: 0 };
  }

  // Split page into lines.
  const lines = pageText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Group listings by normalized title.
  const groups = new Map<string, HarvestedListing[]>();
  for (const listing of listings) {
    const title = listing.listing.title.trim().toLowerCase().replace(/\s+/g, " ");
    const group = groups.get(title);
    if (group) {
      group.push(listing);
    } else {
      groups.set(title, [listing]);
    }
  }

  const added: HarvestedListing[] = [];
  // Nights the ROW step added, per group: the HEADING step does not add them again.
  const rowAddedNights = new Map<string, Set<string>>();

  // --- ROW step ---
  for (const [normTitle, groupListings] of groups) {
    // Skip groups where any listing has a weekly rule; a list of dates is not one.
    if (groupListings.some((l) => statesRule(l.listing.recurrence_text, lang))) {
      continue;
    }
    const template = groupListings[0];
    if (!template) continue;

    // Find the first page line that matches the normalized title.
    const titleLineIndex = lines.findIndex(
      (line) => line.trim().toLowerCase().replace(/\s+/g, " ") === normTitle,
    );
    if (titleLineIndex === -1) continue;

    // Collect consecutive ROW lines after the title.
    const rowLines: string[] = [];
    for (const line of lines.slice(titleLineIndex + 1)) {
      // Check if line is a ROW line.
      const trimmed = line.replace(/^[-*\u2022]\s+/, "").trim();
      if (trimmed.length > 80) break;

      // Check if line contains a date.
      const hasDate =
        statesAnyDate(trimmed, lang) || /(?<!\d)\d{1,2}-\d{1,2}-\d{4}(?!\d)/.test(trimmed);
      if (!hasDate) break;

      // Check if line has at least one start time.
      const mentions = readBlockTimes(trimmed, lang);
      const hasStart = mentions.some((m) => m.role === "start" && m.value !== null);
      if (!hasStart) break;

      rowLines.push(trimmed);
    }

    if (rowLines.length === 0) continue;

    // Process each ROW line.
    const usedNights = new Set<string>();
    for (const row of rowLines) {
      // Find the first night in the window that matches the row.
      const night = nights.find((n) => statesDate(row, n, lang));
      if (!night) continue;
      if (usedNights.has(night)) continue;

      // Check if group already has this night.
      const alreadyHas = groupListings.some((l) => l.listing.local_date === night);
      if (alreadyHas) {
        usedNights.add(night);
        continue;
      }

      // Create a copy of the template.
      const copy: HarvestedListing = {
        ...template,
        listing: {
          ...template.listing,
          local_date: night,
          recurrence_text: null,
        },
        externalId: null,
      };

      // Get times from the row.
      const mentions = readBlockTimes(row, lang);
      const startMention = mentions.find((m) => m.role === "start" && m.value !== null);
      const endMention = mentions.find((m) => m.role === "end" && m.value !== null);

      if (startMention) {
        // Determine which start field to use.
        const startField =
          template.listing.dancing_time != null
            ? "dancing_time"
            : template.listing.lesson_time != null
              ? "lesson_time"
              : template.listing.doors_time != null
                ? "doors_time"
                : "dancing_time";
        // A row gives its night's one start: the template's other starts are another night's.
        for (const f of ["doors_time", "lesson_time", "dancing_time"] as const)
          copy.listing[f] = null;
        copy.listing[startField] = startMention.value;
      }

      copy.listing.end_time = endMention?.value ?? null;

      added.push(copy);
      usedNights.add(night);
      if (!rowAddedNights.has(normTitle)) rowAddedNights.set(normTitle, new Set());
      rowAddedNights.get(normTitle)!.add(night);
    }
  }

  // --- HEADING step ---
  const dateLines = lines.filter((line) => isDateHeading(line, lang));
  if (dateLines.length >= 2) {
    // Determine which nights in the window are listed on the page.
    const listedNights = nights.filter((night) =>
      dateLines.some((line) => statesDate(line, night, lang)),
    );

    for (const [normTitle, groupListings] of groups) {
      // Skip groups where any listing has a weekly rule; a list of dates is not one.
      if (groupListings.some((l) => statesRule(l.listing.recurrence_text, lang))) {
        continue;
      }
      const template = groupListings[0];
      if (!template) continue;

      // For each listed night not already present in the group.
      for (const night of listedNights) {
        const alreadyHas =
          groupListings.some((l) => l.listing.local_date === night) ||
          (rowAddedNights.get(normTitle)?.has(night) ?? false);
        if (!alreadyHas) {
          // Create a deep copy of the template with new date and cleared recurrence_text.
          const copy: HarvestedListing = {
            ...template,
            listing: {
              ...template.listing,
              local_date: night,
              recurrence_text: null,
            },
            externalId: null,
          };
          // D-492 (Newham): the model may split times across multiple same-title listings.
          // Fill each time field from the first listing in the group that has a non-null value,
          // but only if the template's field is null/undefined.
          const timeFields = ["doors_time", "lesson_time", "dancing_time", "end_time"] as const;
          for (const field of timeFields) {
            if (template.listing[field] == null) {
              // Find the first listing in the group (including the template) that has a non-null value
              for (const listing of groupListings) {
                if (listing.listing[field] != null) {
                  copy.listing[field] = listing.listing[field];
                  break;
                }
              }
            }
          }
          added.push(copy);
        }
      }
    }
  }

  // Keep original listings unchanged, then append added copies.
  const result = [...listings, ...added];
  return { listings: result, added: added.length };
}
