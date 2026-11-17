// GSI 国土地理院 address search, used under 国土地理院コンテンツ利用規約 (CC BY 4.0 compatible,
// attribution "出典：国土地理院"), no key, requests spaced 1 s, only for addresses Geoapify refused
// in a JP metro (D-1241).

import type { Metro } from "@/src/adapters/types";
import type { Point } from "@/src/domain/listing";
import { insideMetro } from "@/src/domain/metro-bounds";
import type { HttpClient } from "@/src/pipeline/http";
import { normalizeAddress, isPlaceholderAddress } from "@/src/pipeline/geocode";
import type { Geocoder } from "@/src/pipeline/geocode";

export const GSI_SEARCH = "https://msearch.gsi.go.jp/address-search/AddressSearch";

export function gsiUrl(address: string): string {
  return `${GSI_SEARCH}?q=${encodeURIComponent(address)}`;
}

/**
 * What GSI is asked: the address without its postcode, from its first Japanese-script character
 * to its last lot number ("〒111-0051 東京都台東区蔵前２丁目１−２３ 3F K2B" -> "東京都台東区蔵前2丁目1-23").
 * GSI answers nothing when a postcode or floor follows (probed 2026-11-10).
 */
export function gsiQuery(address: string): string {
  const text = normalizeJapanese(address).replace(/〒?\s*\d{3}-\d{4}/g, " ");
  const lot = text.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^\d]*?\d+(?:(?:丁目|番地|番|号|-)\s*\d+)*(?:号|番地|番)?/u,
  );
  return lot ? lot[0] : address.trim();
}

function normalizeJapanese(text: string): string {
  // Full-width digits to ASCII
  let normalized = text.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  // Various dash/hyphen characters to ASCII hyphen
  normalized = normalized.replace(/[−ー‐–—－]/g, "-");
  return normalized;
}

function toNumber(s: string): number | null {
  // ASCII digits
  if (/^\d+$/.test(s)) {
    return parseInt(s, 10);
  }
  // Kanji digits 一..九
  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  // Single digit
  if (digitMap[s] !== undefined) {
    return digitMap[s];
  }
  // 十 alone
  if (s === "十") return 10;
  // Patterns like 十二 (10+2), 二十 (2*10), 二十三 (2*10+3)
  // Match (X?)十(Y?) where X and Y are optional digits
  const match = s.match(/^(?<x>[一二三四五六七八九]?)十(?<y>[一二三四五六七八九]?)$/);
  if (match) {
    const x = match.groups?.x;
    const y = match.groups?.y;
    const tens = x ? (digitMap[x] ?? 0) : 1; // 十 = 1*10, 二十 = 2*10
    const units = y ? (digitMap[y] ?? 0) : 0;
    return tens * 10 + units;
  }
  return null;
}

function extractChomeBan(title: string): { chome: number | null; ban: number | null } {
  let chome: number | null = null;
  let ban: number | null = null;

  // Look for 丁目 pattern: kanji or digit before 丁目
  const chomeMatch = title.match(/([一二三四五六七八九十\d]+)丁目/);
  const chomeNum = chomeMatch?.[1];
  if (chomeNum) chome = toNumber(chomeNum);

  // Look for 番 pattern: number before 番 (番地 also matches)
  const banMatch = title.match(/([一二三四五六七八九十\d]+)番/);
  const banNum = banMatch?.[1];
  if (banNum) ban = toNumber(banNum);

  return { chome, ban };
}

function titleContainsLotLevel(title: string): boolean {
  return /番|号/.test(title);
}

function titleWard(title: string): string | null {
  // Find the shortest leading part ending in 区, 市, 町, 村 after a prefecture prefix
  const match = title.match(
    /^(?:東京都|北海道|(?:京都|大阪)府|[^都道府県]{2,3}県)?(.+?[区市町村])/,
  );
  return match?.[1] ?? null;
}

function judge(
  body: unknown,
  address: string,
  metro: Metro,
): { point: Point } | { refusal: string } {
  // Check body is an array with at least one feature
  if (!Array.isArray(body) || body.length === 0) {
    return { refusal: "gsi: no answer" };
  }
  const feature = body[0];
  if (
    !feature ||
    typeof feature !== "object" ||
    !feature.geometry ||
    !Array.isArray(feature.geometry.coordinates) ||
    feature.geometry.coordinates.length < 2
  ) {
    return { refusal: "gsi: no answer" };
  }
  const coords = feature.geometry.coordinates;
  const lng = coords[0];
  const lat = coords[1];
  if (
    typeof lng !== "number" ||
    typeof lat !== "number" ||
    !Number.isFinite(lng) ||
    !Number.isFinite(lat)
  ) {
    return { refusal: "gsi: no answer" };
  }
  const title = feature.properties?.title;
  if (typeof title !== "string") {
    return { refusal: "gsi: no answer" };
  }

  // Normalize both strings
  const normTitle = normalizeJapanese(title);
  const normAddress = normalizeJapanese(address);

  // Rule 1: title must contain 番 or 号 (lot level)
  if (!titleContainsLotLevel(normTitle)) {
    return { refusal: "gsi: too vague" };
  }

  // Extract chome and ban from title
  const { chome, ban } = extractChomeBan(normTitle);
  if (ban === null) {
    return { refusal: "gsi: too vague" };
  }

  // Rule 4: ward/city name must appear in address
  const ward = titleWard(normTitle);
  if (!ward) {
    return { refusal: "gsi: too vague" };
  }
  const wardIndex = normAddress.indexOf(ward);
  if (wardIndex === -1) {
    return { refusal: "gsi: too vague" };
  }

  // The title's town (蔵前, 道玄坂, 神田佐久間町: between the ward and its first number) must follow
  // the ward in the address: same ward and numbers in another town is another door.
  const afterWard = normAddress.slice(wardIndex + ward.length);
  const titleRest = normTitle.slice(normTitle.indexOf(ward) + ward.length);
  const town = titleRest.match(/^(.+?)[一二三四五六七八九十\d]+(?:丁目|番)/)?.[1];
  if (!town || !afterWard.trimStart().startsWith(town)) {
    return { refusal: "gsi: too vague" };
  }

  // Extract numbers after the ward
  const numberMatches = afterWard.match(/\d+/g);
  if (!numberMatches) {
    return { refusal: "gsi: too vague" };
  }
  const addressNumbers = numberMatches.map((m) => parseInt(m, 10));

  // Rule 3: match numbers
  let matches = false;
  if (chome !== null) {
    // Title has 丁目: need first two numbers to match (chome, ban)
    if (addressNumbers.length >= 2) {
      matches = addressNumbers[0] === chome && addressNumbers[1] === ban;
    }
  } else {
    // No 丁目 in title: first number must equal ban
    matches = addressNumbers[0] === ban;
  }
  if (!matches) {
    return { refusal: "gsi: too vague" };
  }

  // Rule 5: point must be inside metro
  const point = { lat, lng };
  if (!insideMetro(metro, point)) {
    return { refusal: "gsi: outside metro" };
  }

  return { point };
}

export function gsiAnswer(body: unknown, address: string, metro: Metro): Point | null {
  const result = judge(body, address, metro);
  return "point" in result ? result.point : null;
}

export function gsiRefusal(body: unknown, address: string, metro: Metro): string | null {
  const result = judge(body, address, metro);
  return "refusal" in result ? result.refusal : null;
}

function hasJapaneseScript(text: string): boolean {
  // Check for Han, Hiragana, Katakana characters
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text);
}

export function gsiGeocoder(http: HttpClient, metro: Metro): Geocoder & { requests: () => number } {
  const cache = new Map<string, Promise<{ point: Point | null; refusal: string | null }>>();
  let requestCount = 0;

  const readFor = async (
    address: string,
  ): Promise<{ point: Point | null; refusal: string | null }> => {
    const key = normalizeAddress(address);
    if (!key) {
      return { point: null, refusal: null };
    }
    if (isPlaceholderAddress(address)) {
      return { point: null, refusal: "gsi: no answer" };
    }
    if (!hasJapaneseScript(address)) {
      return { point: null, refusal: "gsi: not in Japanese script" };
    }
    let entry = cache.get(key);
    if (!entry) {
      requestCount += 1;
      entry = (async () => {
        try {
          const response = await http.request({
            url: gsiUrl(gsiQuery(address)),
            purpose: "api",
            intervalMs: 1000,
            headers: { accept: "application/json" },
          });
          const body = JSON.parse(response.body) as unknown;
          const point = gsiAnswer(body, address, metro);
          const refusal = point === null ? gsiRefusal(body, address, metro) : null;
          return { point, refusal };
        } catch {
          return { point: null, refusal: "gsi: request failed" };
        }
      })();
      cache.set(key, entry);
    }
    return entry;
  };

  const geocode = async (address: string): Promise<Point | null> => {
    const result = await readFor(address);
    return result.point;
  };

  const building = async (): Promise<Point | null> => {
    return null;
  };

  const refusal = async (address: string): Promise<string | null> => {
    const result = await readFor(address);
    return result.refusal;
  };

  return {
    id: "gsi",
    geocode,
    building,
    refusal,
    requests: () => requestCount,
  };
}

export function withJapanFallback<G extends Geocoder & { requests?: () => number }>(
  primary: G,
  fallback: Geocoder & { requests: () => number },
  metro: Metro,
): G {
  // GSI covers Japan only: elsewhere the primary is returned unchanged and GSI is never asked.
  if (metro.countryCode !== "JP") return primary;

  const combined: Geocoder & { requests: () => number } = {
    id: primary.id,
    geocode: async (address: string) => {
      const primaryPoint = await primary.geocode(address);
      if (primaryPoint !== null) {
        return primaryPoint;
      }
      return fallback.geocode(address);
    },
    building: (address: string) => primary.building(address),
    refusal: async (address: string) => {
      const primaryPoint = await primary.geocode(address);
      if (primaryPoint !== null) {
        return null;
      }
      const fallbackPoint = await fallback.geocode(address);
      if (fallbackPoint !== null) {
        return null;
      }
      const primaryRefusal = primary.refusal ? await primary.refusal(address) : null;
      const fallbackRefusal = fallback.refusal ? await fallback.refusal(address) : null;
      if (primaryRefusal === null && fallbackRefusal === null) {
        return null;
      }
      const parts = [primaryRefusal, fallbackRefusal].filter((r): r is string => r !== null);
      return parts.join("; ");
    },
    requests: () => (primary.requests ? primary.requests() : 0) + fallback.requests(),
  };

  // Add elsewhere if primary has it
  if (primary.elsewhere) {
    combined.elsewhere = (address: string) => primary.elsewhere!(address);
  }

  return combined as G;
}
