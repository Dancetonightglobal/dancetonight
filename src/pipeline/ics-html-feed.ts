import type { Source } from "@/src/adapters/types";

/** The note the run's line gets when a source is switched (D-780). */
export const PAGE_INSTEAD_NOTE =
  "its calendar link answers with a web page, not an iCalendar file: from the next run its own page is read (D-780)";

/** The columns written when a source is switched (D-780). */
export const PAGE_INSTEAD = { kind: "html", platform: "probed", feedUrl: null } as const;

/**
 * True when a failed read means the source's found calendar link is a web page (D-780): the source is
 * kind "feed_ics", has no platform (null or ""), has a feedUrl that differs from its url, the failure detail
 * contains "not an iCalendar file" (case-insensitive), and it has now failed at least 2 runs in a row
 * (`failures` is the streak after this failure).
 */
export function readsPageInstead(
  source: Pick<Source, "kind" | "platform" | "feedUrl" | "url">,
  detail: string,
  failures: number,
): boolean {
  // Must be kind "feed_ics"
  if (source.kind !== "feed_ics") {
    return false;
  }

  // Platform must be unset (null or empty string)
  if (source.platform != null && source.platform !== "") {
    return false;
  }

  // feedUrl must exist and differ from url
  if (source.feedUrl == null || source.feedUrl === source.url) {
    return false;
  }

  // Need at least 2 consecutive failures
  if (failures < 2) {
    return false;
  }

  // Detail must contain the phrase case-insensitively
  if (!detail.toLowerCase().includes("not an icalendar file")) {
    return false;
  }

  return true;
}
