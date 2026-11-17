import type { Listing } from "@/src/domain/listing";
import { formatCalendarDate, localDateOf } from "@/src/domain/time";
import { t } from "@/src/i18n";

/**
 * The "Link not working" line under a card's own link (D-768), or null when the link is not broken.
 *
 * Pure: no JSX, no I/O.
 */
export function linkNotWorkingText(listing: Listing, now: Date): string | null {
  const brokenAt = listing.linkBrokenAt;
  if (brokenAt === null || brokenAt === undefined) {
    return null;
  }

  const checkedDate = localDateOf(new Date(brokenAt), listing.tz);
  const today = localDateOf(now, listing.tz);

  if (checkedDate === today) {
    return t("links.notWorkingToday");
  }

  return t("links.notWorkingOn", {
    date: formatCalendarDate(checkedDate),
  });
}
