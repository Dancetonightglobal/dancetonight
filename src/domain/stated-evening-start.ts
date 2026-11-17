// D-867: a structured morning start its own description contradicts with a stated evening
// opening is a placeholder, not the night's time (London incognitodance "Tuesdays at
// FULHAM SALSA & BACHATA CLUB": iCal DTSTART 09:00-10:00, DESCRIPTION "Open 7:00pm ...",
// daily site check 2026-11-11).

import { quoteAround, readClock } from "@/src/domain/text-facts";

export function statedEveningStart(
  startTime: string | null,
  description: string | null,
): { time: string; quote: string } | null {
  // 1. startTime must be 05:00 <= time < 12:00
  if (!startTime) return null;
  const clock = /^(\d{2}):(\d{2})$/.exec(startTime);
  if (!clock) return null;
  const hourStr = clock[1] ?? "";
  const minuteStr = clock[2] ?? "";
  const hour = parseInt(hourStr, 10);
  if (hour < 5 || hour >= 12) return null;

  // 2. description must be non-empty
  if (!description || description.trim() === "") return null;

  const desc = description;

  // 3. No explicit morning clock in description
  const morningClock = /\b\d{1,2}(?:[:.]\d{2})?\s*a\.?\s?m\.?\b/i;
  if (morningClock.test(desc)) return null;

  // 4. Description must not write the start's own clock
  // Build pattern for startTime: "09:00" -> "09:00", "9:00", "09.00", "9.00"
  const hourPart = hourStr.startsWith("0") ? `0?${hourStr.slice(1)}` : hourStr;
  const startPattern = new RegExp(`(?<!\\d)${hourPart}(?:[:.]${minuteStr})(?!\\s*p)`, "i");
  if (startPattern.test(desc)) return null;

  // 5. Find opening phrase
  const openingWords = [
    "open",
    "opens",
    "opening",
    "doors",
    "doors open",
    "start",
    "starts",
    "starting",
    "starting from",
    "from",
  ];
  // Build regex: opening word, optional joiner, then clock
  const wordPattern = openingWords.join("|");
  // Clock patterns:
  //   - H[:.MM] followed by optional spaces and pm/p.m. (explicit pm marker)
  //   - HH:MM/HH.MM with HH 12-23 (24-hour)
  const clockPattern = String.raw`(?:(?:\d{1,2})(?:[:.]\d{2})?\s*(?:pm|p\.\s?m\.)|(?:1[2-9]|2[0-3])[:.]\d{2})`;
  const openingRe = new RegExp(
    `\\b(${wordPattern})\\b\\s*(?:at|from|:|-|–)?\\s*(${clockPattern})`,
    "gi",
  );

  const match = openingRe.exec(desc);
  if (!match) return null;

  // Extract clock part (group 2)
  const clockText = match[2]!;
  // Parse clock
  // For pm clock: extract hours, minutes, marker
  const pmMatch = /(\d{1,2})(?:[:.](\d{2}))?\s*(pm|p\.\s?m\.)/i.exec(clockText);
  let parsedTime: string | null = null;
  if (pmMatch) {
    const hours = pmMatch[1] ?? "";
    const minutes = pmMatch[2] ?? "00";
    parsedTime = readClock(hours, minutes, "pm");
  } else {
    // 24-hour clock: HH:MM or HH.MM with HH 12-23
    const hourMatch = /(1[2-9]|2[0-3])[:.](\d{2})/.exec(clockText);
    if (hourMatch) {
      parsedTime = `${hourMatch[1]}:${hourMatch[2]}`;
    }
  }

  if (!parsedTime) return null;

  // 6. Clock must be >= 17:00
  if (parsedTime < "17:00") return null;

  return {
    time: parsedTime,
    quote: quoteAround(desc, match.index, match[0].length),
  };
}
