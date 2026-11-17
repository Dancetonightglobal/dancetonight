// What a pin and a cluster say, printed and aloud (DESIGN.md section 5, D-068). Pure, so the words
// are tested rather than trusted; every piece of copy comes from src/i18n.

import { t } from "@/src/i18n";
import type { MapPlace } from "@/src/ui/map/types";

/** English only in v1, as src/i18n is: "2, 3, and 5", "Stepping Out Studios and SOB's". */
const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/**
 * The most characters a cluster prints, "+4" included, so a sticker never grows past about two
 * targets wide however many places it gathers (review, 2026-09-28): "1·3·6·8–11" prints
 * "1·3·6 +4".
 */
export const CLUSTER_TEXT_MAX_CHARS = 9;

/**
 * The numbers a cluster prints, as parts: a run of three or more reads "2–5", anything shorter is
 * its numbers one by one. [2, 3] gives [2, 3]; [1, 4, 5, 6] gives [1, [4, 6]].
 */
export function numberParts(numbers: readonly number[]): Array<number | [number, number]> {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: Array<number | [number, number]> = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === (sorted[end] ?? 0) + 1) end += 1;
    const first = sorted[index] ?? 0;
    const last = sorted[end] ?? 0;
    if (end - index >= 2) {
      parts.push([first, last]);
    } else {
      for (let each = index; each <= end; each += 1) parts.push(sorted[each] ?? 0);
    }
    index = end + 1;
  }
  return parts;
}

function partText(part: number | [number, number]): string {
  return typeof part === "number"
    ? String(part)
    : t("map.cluster.run", { first: String(part[0]), last: String(part[1]) });
}

function joined(parts: readonly string[]): string {
  return parts.reduce((before, after) => t("map.cluster.join", { before, after }));
}

/**
 * What a cluster prints: the list numbers it holds, never a count, so a cluster cannot be read as
 * a pin with that number. "2·3", "2–5", "1·4–6". Past CLUSTER_TEXT_MAX_CHARS it prints the first
 * of them and how many more it holds, "1·3·6 +4"; its accessible name still lists every number.
 */
export function clusterText(numbers: readonly number[]): string {
  const parts = numberParts(numbers);
  const whole = joined(parts.map(partText));
  if ([...whole].length <= CLUSTER_TEXT_MAX_CHARS) return whole;

  const size = (part: number | [number, number]) =>
    typeof part === "number" ? 1 : part[1] - part[0] + 1;
  const total = new Set(numbers).size;
  const more = (shown: readonly string[], covered: number) =>
    t("map.cluster.more", { shown: joined(shown), count: total - covered });
  const shown: string[] = [];
  let covered = 0;
  for (const part of parts) {
    const next = more([...shown, partText(part)], covered + size(part));
    // The first part is always printed, so a sticker never holds only "+12".
    if (shown.length > 0 && [...next].length > CLUSTER_TEXT_MAX_CHARS) break;
    shown.push(partText(part));
    covered += size(part);
  }
  return more(shown, covered);
}

/** A pin's accessible name: its printed time (or title if no time) and the night it stands for. */
export function pinName(place: MapPlace, selected: boolean): string {
  if (place.time !== null) {
    const params = { time: place.time, title: place.title };
    return selected ? t("a11y.pinSelected", params) : t("a11y.pin", params);
  } else {
    const params = { title: place.title };
    return selected ? t("a11y.pinNoTimeSelected", params) : t("a11y.pinNoTime", params);
  }
}

/** A cluster's accessible name: "2 places, Stepping Out Studios". */
export function clusterName(places: readonly MapPlace[]): string {
  const count = places.length;
  const venues = [...new Set(places.map((place) => place.venueName.trim()))].filter(
    (name) => name !== "",
  );
  return venues.length === 0
    ? t("a11y.pinClusterNoVenue", { count })
    : t("a11y.pinCluster", { count, venues: list.format(venues) });
}
