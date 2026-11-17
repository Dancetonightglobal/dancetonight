/**
 * Chinese (Hong Kong) clock times: 晚上8時, 凌晨2時, 8點半, 20時 (D-665)
 */
export interface HanTime {
  at: number;
  end: number;
  h: number;
  m: number;
  mer: "am" | "pm" | "24" | null;
}

/**
 * Return [] at once when `text` has no Han character (`/\p{Script=Han}/u`).
 */
export function hanTimeTokens(text: string): HanTime[] {
  // Quick check: if no Han character, return empty
  if (!/\p{Script=Han}/u.test(text)) {
    return [];
  }

  const tokens: HanTime[] = [];
  let i = 0;

  while (i < text.length) {
    // Look for period words (longest first)
    const periodMatch = matchPeriod(text, i);
    const periodStart = i;
    let periodEnd = i;
    let period: "pm" | "am" | "noon" | "midnight" | null = null;
    let periodWord: string | null = null;
    if (periodMatch) {
      period = periodMatch.period;
      periodWord = periodMatch.word;
      periodEnd = periodMatch.end;
      i = periodEnd;
      // Skip spaces
      while (i < text.length && /\s/.test(text[i] ?? "")) i++;
    } else {
      // No period, reset to original position
      i = periodStart;
    }

    // Try to match a clock
    const clockMatch = matchClock(text, i, period !== null);
    if (!clockMatch) {
      // No clock found, advance by one character and continue
      i = periodStart + 1;
      continue;
    }

    const { hour, minute, clockEnd, hourDigits } = clockMatch;
    const hourNum = hour;
    const minuteNum = minute;

    // Skip if it's a duration or date
    if (shouldSkip(text, periodStart, clockEnd, hourDigits)) {
      i = clockEnd;
      continue;
    }

    // Determine mer and compute 24-hour hour
    let mer: "am" | "pm" | "24" | null = null;
    let h24 = hourNum;

    if (period === "pm") {
      // Distinguish between 晚上/夜晚/晚/夜 (midnight) and 下午/傍晚/午後/夕方 (12pm)
      if (periodWord && ["晚上", "夜晚", "晚", "夜"].includes(periodWord)) {
        // These words treat hour 12 as midnight
        if (hourNum === 12) {
          h24 = 0;
          mer = "24";
        } else if (hourNum >= 1 && hourNum <= 11) {
          h24 = hourNum + 12;
          mer = "pm";
        } else if (hourNum >= 13 && hourNum <= 23) {
          h24 = hourNum;
          mer = "pm";
        }
      } else {
        // 下午, 傍晚, 午後, 夕方
        if (hourNum === 12) {
          h24 = 12;
          mer = "pm";
        } else if (hourNum >= 1 && hourNum <= 11) {
          h24 = hourNum + 12;
          mer = "pm";
        } else if (hourNum >= 13 && hourNum <= 23) {
          h24 = hourNum;
          mer = "pm";
        }
      }
    } else if (period === "am") {
      if (periodWord === "深夜" && hourNum >= 8 && hourNum <= 11) {
        // 深夜 runs about 22:00-04:00: 深夜11時 is 23:00, not 11am (D-1223)
        h24 = hourNum + 12;
        mer = "pm";
      } else if (hourNum === 12) {
        h24 = 0;
        mer = "am";
      } else if (hourNum >= 0 && hourNum <= 11) {
        h24 = hourNum;
        mer = "am";
      }
    } else if (period === "noon") {
      if (hourNum === 12) {
        h24 = 12;
        mer = "pm";
      } else if (hourNum === 1 || hourNum === 2) {
        h24 = hourNum + 12;
        mer = "pm";
      } else {
        // Other hours with noon period are invalid
        i = clockEnd;
        continue;
      }
    } else if (period === "midnight") {
      if (hourNum === 12) {
        h24 = 0;
        mer = "24";
      } else {
        i = clockEnd;
        continue;
      }
    } else {
      // No period
      // Handle late-night hours 24-29 (Japanese "25時" = 1am)
      if (hourNum >= 24 && hourNum <= 29) {
        h24 = hourNum - 24;
        mer = "24";
      } else if (hourNum === 0 || hourNum === 24 || (hourNum >= 13 && hourNum <= 23)) {
        mer = "24";
        h24 = hourNum === 24 ? 0 : hourNum;
      } else if (hourNum >= 1 && hourNum <= 12) {
        mer = null;
        h24 = hourNum; // keep as 1-12 for ambiguous
      }
    }

    // Skip if hour is 30 or above (no token)
    if (hourNum >= 30) {
      i = clockEnd;
      continue;
    }

    // For am/pm tokens, we need to store hour as 1-12 for compatibility with existing code
    const storedHour = mer === "am" || mer === "pm" ? (h24 % 12 === 0 ? 12 : h24 % 12) : h24;

    tokens.push({
      at: periodMatch ? periodMatch.start : clockMatch.clockStart,
      end: clockEnd,
      h: storedHour,
      m: minuteNum,
      mer,
      // bare is always false for Han tokens
    });

    i = clockEnd;
  }

  // Merge overlapping tokens (should not happen with our scanning)
  return tokens;
}

// Helper functions

function matchPeriod(
  text: string,
  start: number,
): { period: "pm" | "am" | "noon" | "midnight"; word: string; start: number; end: number } | null {
  const pmWords = ["晚上", "夜晚", "傍晚", "下午", "晚", "夜", "午後", "夕方"];
  const amWords = ["上午", "早上", "朝早", "早晨", "凌晨", "午前", "深夜", "早朝", "明け方"];
  const noonWords = ["中午", "正午"];
  const midnightWords = ["午夜", "半夜"];

  // Try longest first
  const wordLists = [
    { words: pmWords, period: "pm" as const },
    { words: amWords, period: "am" as const },
    { words: noonWords, period: "noon" as const },
    { words: midnightWords, period: "midnight" as const },
  ];

  for (const { words, period } of wordLists) {
    for (const word of words) {
      if (text.startsWith(word, start)) {
        return { period, word, start, end: start + word.length };
      }
    }
  }
  return null;
}

function matchClock(
  text: string,
  start: number,
  hasPeriod: boolean,
): {
  hour: number;
  minute: number;
  clockStart: number;
  clockEnd: number;
  hourDigits: string;
  minuteDigits: string | null;
} | null {
  const originalStart = start;
  let i = start;

  // Try ASCII clock first when there is a period
  if (hasPeriod) {
    const asciiMatch = /^(\d{1,2})([:：])(\d{2})/.exec(text.slice(i));
    if (asciiMatch) {
      const hourNum = parseInt(asciiMatch[1] ?? "", 10);
      const minuteNum = parseInt(asciiMatch[3] ?? "", 10);
      if (hourNum > 24 || minuteNum > 59) {
        // Not valid
      } else {
        return {
          hour: hourNum,
          minute: minuteNum,
          clockStart: originalStart,
          clockEnd: i + asciiMatch[0].length,
          hourDigits: asciiMatch[1] ?? "",
          minuteDigits: asciiMatch[3] ?? null,
        };
      }
    }
  }

  // Match hour digits (ASCII 0-9, full-width ０-９, or Chinese numerals)
  const hourMatch = matchHour(text, i);
  if (!hourMatch) return null;
  const hourDigits = hourMatch.digits;
  const hourNum = hourMatch.value;
  i = hourMatch.end;

  // Check for clock word: 時|时|點|点
  const clockWordMatch = /^(?:時|时|點|点)/.test(text.slice(i, i + 1));
  if (!clockWordMatch) {
    // No clock word, and not ASCII clock (already tried)
    return null;
  }
  i += 1; // consume clock word

  // Check for 鐘/钟 (點鐘/点钟)
  if (/^(?:鐘|钟)/.test(text.slice(i, i + 1))) {
    i += 1;
  }

  let minuteNum = 0;
  let minuteDigits: string | null = null;

  // Check for minutes
  const nextChar = text[i];
  if (nextChar === "半") {
    minuteNum = 30;
    i += 1;
  } else if (nextChar === "正") {
    minuteNum = 0;
    i += 1;
  } else {
    // Try to match minutes digits
    const minuteMatch = matchMinutes(text, i);
    if (minuteMatch) {
      minuteNum = minuteMatch.value;
      minuteDigits = minuteMatch.digits;
      i = minuteMatch.end;
      // Optional 分
      if (/^(?:分)/.test(text.slice(i, i + 1))) {
        i += 1;
      }
    }
  }

  return {
    hour: hourNum,
    minute: minuteNum,
    clockStart: originalStart,
    clockEnd: i,
    hourDigits,
    minuteDigits,
  };
}

function matchHour(
  text: string,
  start: number,
): { digits: string; value: number; end: number } | null {
  // Try Chinese numerals first (longest first)
  const cnNumerals: Array<{ pattern: RegExp; value: number }> = [
    { pattern: /^十二/, value: 12 },
    { pattern: /^十一/, value: 11 },
    { pattern: /^十/, value: 10 },
    { pattern: /^兩/, value: 2 },
    { pattern: /^一/, value: 1 },
    { pattern: /^二/, value: 2 },
    { pattern: /^三/, value: 3 },
    { pattern: /^四/, value: 4 },
    { pattern: /^五/, value: 5 },
    { pattern: /^六/, value: 6 },
    { pattern: /^七/, value: 7 },
    { pattern: /^八/, value: 8 },
    { pattern: /^九/, value: 9 },
  ];
  for (const { pattern, value } of cnNumerals) {
    const m = pattern.exec(text.slice(start));
    if (m) {
      return { digits: m[0], value, end: start + m[0].length };
    }
  }

  // ASCII digits or full-width digits
  const digitMatch = /^[0-9０-９]{1,2}/.exec(text.slice(start));
  if (digitMatch) {
    const digits = digitMatch[0];
    // Convert full-width to ASCII
    const asciiDigits = digits.replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    );
    const value = parseInt(asciiDigits, 10);
    return { digits, value, end: start + digits.length };
  }

  return null;
}

function matchMinutes(
  text: string,
  start: number,
): { digits: string; value: number; end: number } | null {
  const digitMatch = /^[0-9０-９]{1,2}/.exec(text.slice(start));
  if (digitMatch) {
    const digits = digitMatch[0];
    const asciiDigits = digits.replace(/[０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    );
    const value = parseInt(asciiDigits, 10);
    if (value > 59) return null;
    return { digits, value, end: start + digits.length };
  }
  return null;
}

function shouldSkip(
  text: string,
  periodStart: number,
  clockEnd: number,
  hourDigits: string,
): boolean {
  // Check for price before
  const before = text.slice(Math.max(0, periodStart - 4), periodStart);
  if (/HK\$|HKD|\$/.test(before)) {
    return true;
  }

  // Check for date: 月 or 日 directly after hour digits
  const afterHour = text.slice(periodStart, clockEnd);
  if (/月|日/.test(afterHour)) {
    return true;
  }

  // Check for duration: 小 before 時/时
  const hourPos = text.indexOf(hourDigits, periodStart);
  if (hourPos > 0 && text.slice(hourPos - 1, hourPos) === "小") {
    return true;
  }
  // 個鐘/个钟 after hour
  if (text.slice(clockEnd, clockEnd + 2).match(/^(?:個鐘|个钟)/)) {
    return true;
  }

  return false;
}
