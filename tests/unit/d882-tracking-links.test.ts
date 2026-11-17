import { describe, expect, it } from "vitest";

import { icsToListings, parseIcs } from "@/src/adapters/feeds/ics";
import type { Metro, Source } from "@/src/adapters/types";
import { normalizeListing } from "@/src/pipeline/normalize";

// D-882: an Instagram "link in bio" copy of an RA event (?utm_source=ig&...) made a second,
// placeless card beside the RA card (NYC Discostan 11-19, daily check 2026-11-13, C). The stored
// links drop tracking parameters, so the exact-link dedupe clause pairs the two.

const NOW = new Date("2026-11-13T18:00:00Z");
const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};
const SOURCE: Source = {
  id: "s",
  url: "https://club.example/",
  kind: "feed_ics",
  trustTier: "first_party",
  platform: null,
  feedUrl: "https://club.example/events/?ical=1",
  metroId: "m",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function stored(url: string) {
  const text = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "X-WR-TIMEZONE:America/New_York",
    "BEGIN:VEVENT",
    "UID:discostan@club.example",
    "SUMMARY:Discostan Salsa Night",
    "DTSTART;TZID=America/New_York:20261119T223000",
    "DTEND;TZID=America/New_York:20261120T030000",
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const { listings } = icsToListings(parseIcs(text), {
    sourceUrl: SOURCE.url,
    fetchedAt: NOW,
    metroTz: NYC.tz,
    countryCode: "US",
    fromNight: "2026-11-13",
    days: 14,
  });
  const outcome = normalizeListing(listings[0]!, { metro: NYC, source: SOURCE, now: NOW });
  if (!outcome.ok) throw new Error(`not normalized: ${JSON.stringify(outcome)}`);
  return outcome.event;
}

describe("stored links drop tracking parameters (D-882)", () => {
  it("stores an RA link with ?utm_... as the plain RA link", () => {
    const event = stored(
      "https://ra.co/events/2538187?utm_source=ig&utm_medium=social&utm_content=link_in_bio",
    );
    expect(event.canonicalUrl).toBe("https://ra.co/events/2538187");
  });

  it("keeps a query parameter that names the page", () => {
    const event = stored("https://club.example/event?id=7&fbclid=abc");
    expect(event.canonicalUrl).toBe("https://club.example/event?id=7");
  });
});
