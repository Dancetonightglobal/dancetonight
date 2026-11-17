import { weeklyGridOpenRule } from "./weekly-grid";

function byDaySet(rrule: string): Set<string> {
  const bydayMatch = rrule.match(/BYDAY=([^;]+)/);
  if (!bydayMatch) return new Set();
  return new Set((bydayMatch[1] ?? "").split(",").map((d) => d.replace(/^[+-]?\d+/, "")));
}

/** Clock times written on a line ("8:30 PM", "3:00 a.m.", "19:00"). */
function clockCount(line: string): number {
  return (line.match(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|\b\d{1,2}:\d{2}\b/gi) ?? [])
    .length;
}

/**
 * The line's one time range: the whole line when it writes at most two clock times, else the part from its last
 * "Club" label ("Night Club 7:00 pm - 1:00 am" after "Beach club 11:00 am - 6:00 pm"), else null.
 */
function nightRange(line: string): string | null {
  if (clockCount(line) <= 2) return line;
  const labels = [...line.matchAll(/\bclub\b/gi)];
  const last = labels[labels.length - 1];
  if (last?.index === undefined) return null;
  const part = line.slice(last.index);
  return clockCount(part) > 0 && clockCount(part) <= 2 ? part : null;
}

/**
 * The club's own "Open:" line, as the time block of a listing whose rule names the same nights (D-800). A line with
 * two ranges vouches only for its night club's (Vagalume: "Beach club 11:00 am - 6:00 pm | Night Club 7:00 pm - 1:00 am").
 */
export function openLineSection(
  pageText: string,
  lang: string | null | undefined,
  rrule: string,
): string | null {
  const rule = weeklyGridOpenRule(pageText, lang);
  if (!rule) return null;
  const section = nightRange(rule.section ?? "");
  if (section === null) return null;
  // Compare BYDAY sets
  const givenSet = byDaySet(rrule);
  const ruleSet = byDaySet(rule.rrule);
  // If both are DAILY (no BYDAY), treat as equal
  const givenIsDaily = rrule === "FREQ=DAILY" || !rrule.includes("BYDAY=");
  const ruleIsDaily = rule.rrule === "FREQ=DAILY" || !rule.rrule.includes("BYDAY=");
  if (givenIsDaily && ruleIsDaily) {
    return section;
  }
  // Compare sets
  if (givenSet.size !== ruleSet.size) return null;
  for (const day of givenSet) {
    if (!ruleSet.has(day)) return null;
  }
  return section;
}
