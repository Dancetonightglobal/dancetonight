import type { Point } from "@/src/domain/listing";
import type { EventPagePlace } from "@/src/adapters/feeds/jsonld";

/** Fever event pages: read the night, venue and point from the page's own data. */

/** Whether a URL's host is Fever's (feverup.com or a subdomain of it). */
export function isFeverHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "feverup.com" || hostname.endsWith(".feverup.com");
  } catch {
    return false;
  }
}

/**
 * Extract the first place from a Fever page's plan data.
 * Returns null when there is no "places":[ , the array does not parse, places[0] is not an object,
 * or its address is missing or blank after trim.
 */
export function feverPlace(
  html: string,
): { name: string | null; address: string; location: Point | null } | null {
  const placesIndex = html.indexOf('"places":[');
  if (placesIndex === -1) {
    return null;
  }
  // Scan for balanced JSON array
  let i = placesIndex + '"places":['.length;
  let depth = 1;
  let inString = false;
  let escapeNext = false;
  while (i < html.length && depth > 0) {
    const ch = html[i];
    if (escapeNext) {
      escapeNext = false;
    } else if (ch === "\\") {
      escapeNext = true;
    } else if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "[") {
        depth++;
      } else if (ch === "]") {
        depth--;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      }
    }
    i++;
  }
  if (depth !== 0) {
    return null;
  }
  const arrayText = html.substring(placesIndex + '"places":['.length - 1, i);
  try {
    const places = JSON.parse(arrayText);
    if (Array.isArray(places) && places.length > 0 && places[0] && typeof places[0] === "object") {
      const p = places[0] as Record<string, unknown>;
      const pAddress = typeof p.address === "string" ? p.address.trim() : undefined;
      if (!pAddress) {
        return null;
      }
      const pName = typeof p.name === "string" ? p.name.trim() : undefined;
      const lat =
        typeof p.latitude === "number" && Number.isFinite(p.latitude) ? p.latitude : undefined;
      const lng =
        typeof p.longitude === "number" && Number.isFinite(p.longitude) ? p.longitude : undefined;
      const location: Point | null =
        lat !== undefined && lng !== undefined && Number.isFinite(lat) && Number.isFinite(lng)
          ? { lat, lng }
          : null;
      return {
        name: pName || null,
        address: pAddress,
        location,
      };
    }
  } catch {
    // ignore parse failure
  }
  return null;
}

/**
 * Schema.org Event objects built from a Fever event page's inline plan data, for `jsonLdToListings`.
 * [] when the URL is not Fever's, or when the page has no plan name or no session start.
 */
export function feverEventBlocks(html: string, pageUrl: string): Record<string, unknown>[] {
  if (!isFeverHost(pageUrl)) {
    return [];
  }

  // 1. Extract plan name
  const nameMatch = /"multipleSessions":(?:true|false),"name":("(?:[^"\\]|\\.)*")/.exec(html);
  if (!nameMatch) {
    return [];
  }
  let name: string;
  try {
    name = JSON.parse(nameMatch[1]!).trim();
  } catch {
    return [];
  }
  if (!name) {
    return [];
  }

  // 2. Extract place using feverPlace
  const feverPlaceResult = feverPlace(html);
  let place: { name?: string; address?: string; latitude?: number; longitude?: number } | null =
    null;
  if (feverPlaceResult && feverPlaceResult.address) {
    place = {
      name: feverPlaceResult.name || undefined,
      address: feverPlaceResult.address,
      latitude: feverPlaceResult.location?.lat,
      longitude: feverPlaceResult.location?.lng,
    };
  }

  // 3. Collect sessions
  const sessions: Array<{ start: string; end?: string }> = [];
  // Pattern for "starts_at_iso":"...","ends_at_iso":"..."
  const regex1 = /"starts_at_iso":"([^"]+)","ends_at_iso":"([^"]+)"/g;
  let match;
  while ((match = regex1.exec(html)) !== null) {
    const start = match[1]!;
    const end = match[2]!;
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(start)) {
      sessions.push({ start, end });
    }
  }
  // Fallback to startsAtIso / endsAtIso
  if (sessions.length === 0) {
    const startMatch = /"startsAtIso":"([^"]+)"/.exec(html);
    const endMatch = /"endsAtIso":"([^"]+)"/.exec(html);
    if (startMatch && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(startMatch[1]!)) {
      sessions.push({
        start: startMatch[1]!,
        end:
          endMatch?.[1] && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(endMatch[1]) ? endMatch[1] : undefined,
      });
    }
  }
  // Dedupe by start, keep first occurrence
  const deduped = new Map<string, { start: string; end?: string }>();
  for (const s of sessions) {
    if (!deduped.has(s.start)) {
      deduped.set(s.start, s);
    }
  }
  const kept = Array.from(deduped.values()).slice(0, 60);
  if (kept.length === 0) {
    return [];
  }

  // 4. Build events
  return kept.map((session) => {
    const event: Record<string, unknown> = {
      "@type": "Event",
      name,
      startDate: session.start,
      url: pageUrl,
    };
    if (session.end && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(session.end)) {
      event.endDate = session.end;
    }
    if (place && place.address) {
      const location: Record<string, unknown> = {
        "@type": "Place",
      };
      if (place.name) {
        location.name = place.name;
      }
      location.address = place.address;
      if (
        place.latitude !== undefined &&
        place.longitude !== undefined &&
        Number.isFinite(place.latitude) &&
        Number.isFinite(place.longitude)
      ) {
        location.geo = {
          "@type": "GeoCoordinates",
          latitude: place.latitude,
          longitude: place.longitude,
        };
      }
      event.location = location;
    }
    return event;
  });
}

/**
 * Decide which venue place to use for a Fever page.
 * - If pageUrl is not a Fever host, return fromJsonLd unchanged.
 * - If fromJsonLd's address contains a digit (street number or postcode), return fromJsonLd.
 * - Otherwise try feverPlace(html); if null, return fromJsonLd.
 * - Otherwise return a new EventPagePlace with:
 *     name = fever name ?? fromJsonLd?.name ?? null,
 *     address = fever address,
 *     location = fever location ?? fromJsonLd?.location ?? null,
 *     evidence = `location ${name ? `${name}, ` : ""}${address}` truncated to 300 characters.
 */
export function feverPagePlace(
  html: string,
  pageUrl: string,
  fromJsonLd: EventPagePlace | null,
): EventPagePlace | null {
  if (!isFeverHost(pageUrl)) {
    return fromJsonLd;
  }
  if (fromJsonLd && /\d/.test(fromJsonLd.address)) {
    return fromJsonLd;
  }
  const fp = feverPlace(html);
  if (!fp) {
    return fromJsonLd;
  }
  const name = fp.name ?? fromJsonLd?.name ?? null;
  const address = fp.address;
  const location = fp.location ?? fromJsonLd?.location ?? null;
  let evidence = `location ${name ? `${name}, ` : ""}${address}`;
  if (evidence.length > 300) {
    evidence = evidence.substring(0, 300);
  }
  return { name, address, location, evidence };
}
