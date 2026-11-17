// Helpers every structured harvester shares. Pure.

import { createHash } from "node:crypto";

import { addCalendarDays, isValidZone, localDateOf } from "@/src/domain/time";
import { nightDate, NIGHT_BOUNDARY_HOUR } from "@/src/domain/tonight";

/** An http(s) URL as a string, or null for anything else (CLAUDE.md: only http(s) survives). */
export function httpUrl(value: unknown, base?: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let raw = value.trim();
  // D-756: a site href that is a full URL behind one slash ("/https://ra.co/events/1", The Greyhound) is that URL,
  // not a path on the site. Only a relative href is unwrapped; an absolute URL keeps any URL in its path (Wayback).
  const wrapped = /^\/(https?(?::\/\/|%3A%2F%2F).+)$/i.exec(raw);
  if (wrapped) {
    let inner = wrapped[1]!;
    if (/^https?%3A/i.test(inner)) {
      try {
        inner = decodeURIComponent(inner);
      } catch {
        inner = "";
      }
    }
    if (inner && URL.canParse(inner)) raw = inner;
  }
  // D-777: a second scheme glued onto a letter or digit ("https://sevn.ly/xOhttps://www.sevenrooms.com/...", Dubai
  // 11-07) is two links run together, and neither half is the event's page: no link. A URL after "/", "=" or "?"
  // (Wayback, a redirect parameter) is not glued.
  if (/[A-Za-z0-9]https?:\/\//i.test(raw)) return null;
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** "HH:MM" of an instant in a zone. */
export function clockIn(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export interface LocalMoment {
  /** Calendar day in the zone. */
  day: string;
  /** Night date: the day, or the day before when the clock reads before 06:00 (D-004). */
  night: string;
  /** "HH:MM", or null for a date with no time. */
  time: string | null;
  /** The zone the day and time are in. */
  zone: string;
  /** True when the source gave an absolute instant (an offset or Z), false for wall-clock text. */
  absolute: boolean;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * An ISO 8601 date or date-time as local parts. With an offset or Z it is an instant, shown in
 * `zone`; without one it is wall-clock time in `zone`; a bare date has no time.
 */
export function isoToLocal(value: unknown, zone: string): LocalMoment | null {
  if (typeof value !== "string") return null;
  const m = ISO.exec(value.trim());
  if (!m) return null;
  const tz = isValidZone(zone) ? zone : "UTC";
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined) return { day, night: day, time: null, zone: tz, absolute: false };
  if (m[7]) {
    const instant = new Date(value.trim().replace(" ", "T"));
    if (Number.isNaN(instant.getTime())) return null;
    return {
      day: localDateOf(instant, tz),
      night: nightDate(instant, tz),
      time: clockIn(instant, tz),
      zone: tz,
      absolute: true,
    };
  }
  const hour = Number(m[4]);
  if (hour > 23 || Number(m[5]) > 59) return null;
  return {
    day,
    night: hour < NIGHT_BOUNDARY_HOUR ? addCalendarDays(day, -1) : day,
    time: `${m[4]}:${m[5]}`,
    zone: tz,
    absolute: false,
  };
}

/** Collapses whitespace and strips tags, for titles and names that arrive as HTML. */
export function plainText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}
