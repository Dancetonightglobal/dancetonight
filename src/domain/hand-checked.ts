// Hand-checked Instagram nights: only listed while the check is fresh (< 35 days).
// See D-797 for the requirement.

import { calendarDaysBetween } from "@/src/domain/time";

/** A hand check lists its night for this many days from `checkedOn` (D-797). */
export const HAND_CHECKED_MAX_AGE_DAYS = 35;

/** The fields of a fixed night this module reads; config nights carry more. */
export interface HandCheckedNight {
  title: string;
  line: string;
  /** "YYYY-MM-DD": the day a person read the venue's own Instagram and saw this night. */
  checkedOn?: string;
  /** The Instagram post URL that shows the night (never fetched). */
  evidenceUrl?: string;
}

export interface HandCheckedPage<T extends HandCheckedNight> {
  /** The fresh nights' `line`s joined with "\n" ("" when none is fresh). */
  pageText: string;
  fresh: T[];
  /** Nights not listed: stale, future-dated, or missing/invalid checkedOn or evidenceUrl. */
  expired: T[];
  notes: string[];
}

function isValidIsoDate(dateStr: string): boolean {
  // Must match YYYY-MM-DD pattern
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + "T00:00:00Z");
  const iso = d.toISOString().slice(0, 10);
  return iso === dateStr;
}

export function handCheckedPage<T extends HandCheckedNight>(
  nights: readonly T[],
  today: string,
): HandCheckedPage<T> {
  const fresh: T[] = [];
  const expired: T[] = [];
  const notes: string[] = [];

  for (const night of nights) {
    // Rule 1: missing or invalid checkedOn
    if (
      night.checkedOn === undefined ||
      night.checkedOn.trim() === "" ||
      !isValidIsoDate(night.checkedOn)
    ) {
      expired.push(night);
      notes.push(`${night.title}: hand-checked night has no valid checkedOn (D-797); not listed`);
      continue;
    }

    // Rule 2: missing evidenceUrl or not https://
    if (
      night.evidenceUrl === undefined ||
      night.evidenceUrl.trim() === "" ||
      !night.evidenceUrl.startsWith("https://")
    ) {
      expired.push(night);
      notes.push(`${night.title}: hand-checked night has no evidenceUrl (D-797); not listed`);
      continue;
    }

    // Rule 3: checkedOn after today
    const days = calendarDaysBetween(night.checkedOn, today);
    if (days < 0) {
      expired.push(night);
      notes.push(
        `${night.title}: hand-checked on ${night.checkedOn}, after today (${today}); not listed`,
      );
      continue;
    }

    // Rule 4: age >= max age
    if (days >= HAND_CHECKED_MAX_AGE_DAYS) {
      expired.push(night);
      notes.push(
        `${night.title}: hand-checked on ${night.checkedOn}, ${days} days ago; recheck the venue's Instagram (D-797); not listed`,
      );
      continue;
    }

    // Rule 5: fresh
    fresh.push(night);
  }

  const pageText = fresh.map((n) => n.line).join("\n");
  return { pageText, fresh, expired, notes };
}
