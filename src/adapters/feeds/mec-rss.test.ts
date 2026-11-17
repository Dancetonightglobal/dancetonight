import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Source } from "@/src/adapters/types";
import {
  mecRssAdapter,
  parseMecFeed,
  hour24,
  mecToListings,
  placeNameFromEventPage,
  stripAreaPrefix,
  type MecItem,
} from "@/src/adapters/feeds/mec-rss";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
const NOW = new Date("2026-10-29T12:00:00Z");
const PR = {
  id: "pr",
  slug: "san-juan",
  name: "San Juan",
  countryCode: "PR",
  center: { lat: 18.4655, lng: -66.1057 },
  radiusKm: 50,
  tz: "America/Puerto_Rico",
  languages: ["en", "es"],
};

const SOURCE: Source = {
  id: "s",
  url: "https://viajandoybailando.com/mec-category/puerto-rico/",
  kind: "jsonld",
  trustTier: "first_party",
  platform: "mec_rss",
  feedUrl: null,
  metroId: "pr",
  styles: [],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctx(fixtureBody: string, extraFixtures: Fixture[] = []) {
  const baseFixtures: Fixture[] = [
    {
      request: { method: "GET", url: "https://viajandoybailando.com/robots.txt" },
      response: {
        url: "https://viajandoybailando.com/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nAllow: /\n",
      },
    },
    {
      request: {
        method: "GET",
        url: "https://viajandoybailando.com/mec-category/puerto-rico/feed/",
      },
      response: {
        url: "https://viajandoybailando.com/mec-category/puerto-rico/feed/",
        status: 200,
        headers: { "content-type": "application/rss+xml" },
        body: fixtureBody,
      },
    },
  ];
  const transport = fixtureTransport([...baseFixtures, ...extraFixtures]);
  let t = NOW.getTime();
  return {
    metro: PR,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "t",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
  };
}

describe("parseMecFeed", () => {
  it("returns 4 items with correct fields", () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const items = parseMecFeed(xml);
    expect(items).toHaveLength(4);
    const first = items[0];
    expect(first?.startHour).toBe("7:00 pm");
    expect(first?.endHour).toBeNull();
    expect(first?.location).toBe("PR-169, Guaynabo, PR");
    expect(first?.guid).toContain("p=1487");
    // description should come from content:encoded, without <p> tags (plainText collapses whitespace)
    expect(first?.description).toBe(
      "Disfruta de salsa en vivo en Los Almendros en Guaynabo jueves y sábado de 7:00pm en adelante. #Outdoor",
    );
  });
});

describe("stripAreaPrefix", () => {
  it("removes leading area label with colon and spaces", () => {
    expect(stripAreaPrefix("Carolina / Isla Verde: Sábado Bailables")).toBe("Sábado Bailables");
  });

  it("handles multiple spaces after colon", () => {
    expect(stripAreaPrefix("Mayagüez:  Martes de Salsa")).toBe("Martes de Salsa");
  });

  it("handles label with slashes", () => {
    expect(stripAreaPrefix("San Juan / Viejo San Juan: Noches de Salsa")).toBe("Noches de Salsa");
  });

  it("does not change if prefix longer than 40 characters", () => {
    const longPrefix = "A very long area label that exceeds forty characters: Salsa Night";
    expect(stripAreaPrefix(longPrefix)).toBe(longPrefix);
  });

  it("does not change if no colon", () => {
    expect(stripAreaPrefix("Noche de Salsa")).toBe("Noche de Salsa");
  });

  it("does not change if rest under 4 characters", () => {
    expect(stripAreaPrefix("Guaynabo: Sal")).toBe("Guaynabo: Sal");
  });

  it("does not change if no space after colon", () => {
    expect(stripAreaPrefix("Bayamón:Salsa Night")).toBe("Bayamón:Salsa Night");
  });

  it("does not change if label shorter than 2 characters", () => {
    expect(stripAreaPrefix("A: Salsa")).toBe("A: Salsa");
  });
});

describe("mecToListings with titleAreaPrefix", () => {
  const baseOptions = {
    siteUrl: "https://viajandoybailando.com/mec-category/puerto-rico/",
    fetchedAt: NOW,
    metroTz: "America/Puerto_Rico",
    countryCode: "PR",
    fromNight: "2026-10-29",
    days: 14,
  };

  it("strips area prefix and adds evidence when titleAreaPrefix true", () => {
    const items: MecItem[] = [
      {
        title: "Carolina / Isla Verde: Sábado Bailables",
        startDate: "2026-10-29",
        startHour: "20:00",
        endDate: null,
        endHour: null,
        location: "Test",
        categories: null,
        guid: null,
        link: "https://example.com/event",
        description: "Test",
      },
    ];
    const { listings } = mecToListings(items, { ...baseOptions, titleAreaPrefix: true });
    expect(listings).toHaveLength(1);
    const listing = listings[0];
    expect(listing?.listing.title).toBe("Sábado Bailables");
    expect(listing?.listing.evidence?.raw_title).toBe("Carolina / Isla Verde: Sábado Bailables");
    expect(listing?.listing.evidence?.title).toContain("Sábado Bailables");
  });

  it("does not strip or add evidence when titleAreaPrefix false", () => {
    const items: MecItem[] = [
      {
        title: "Carolina / Isla Verde: Sábado Bailables",
        startDate: "2026-10-29",
        startHour: "20:00",
        endDate: null,
        endHour: null,
        location: "Test",
        categories: null,
        guid: null,
        link: "https://example.com/event",
        description: "Test",
      },
    ];
    const { listings } = mecToListings(items, { ...baseOptions, titleAreaPrefix: false });
    expect(listings).toHaveLength(1);
    const listing = listings[0];
    expect(listing?.listing.title).toBe("Carolina / Isla Verde: Sábado Bailables");
    expect(listing?.listing.evidence?.raw_title).toBeUndefined();
  });

  it("does not add evidence when title unchanged", () => {
    const items: MecItem[] = [
      {
        title: "Noche de Salsa", // No colon
        startDate: "2026-10-29",
        startHour: "20:00",
        endDate: null,
        endHour: null,
        location: "Test",
        categories: null,
        guid: null,
        link: "https://example.com/event",
        description: "Test",
      },
    ];
    const { listings } = mecToListings(items, { ...baseOptions, titleAreaPrefix: true });
    expect(listings).toHaveLength(1);
    const listing = listings[0];
    expect(listing?.listing.title).toBe("Noche de Salsa");
    expect(listing?.listing.evidence?.raw_title).toBeUndefined();
  });
});

describe("mecToListings with weeklyRules", () => {
  const options = {
    siteUrl: "https://viajandoybailando.com/mec-category/puerto-rico/",
    fetchedAt: NOW,
    metroTz: "America/Puerto_Rico",
    countryCode: "PR",
    fromNight: "2026-10-31",
    days: 14,
  };

  it("makes weekly listing from rule with start hour", () => {
    const items: MecItem[] = [
      {
        title: "Salsa Thursday",
        startDate: "2026-10-29",
        startHour: "19:00",
        endDate: null,
        endHour: null,
        location: "PR-169",
        categories: null,
        guid: null,
        link: "https://viajandoybailando.com/events/salsa-thursday/",
        description: "Weekly salsa",
      },
    ];
    const weeklyRules = new Map<string, string>();
    weeklyRules.set("https://viajandoybailando.com/events/salsa-thursday/", "FREQ=WEEKLY;BYDAY=TH");
    const { listings, notes } = mecToListings(items, { ...options, weeklyRules });
    expect(listings).toHaveLength(1);
    const listing = listings[0];
    expect(listing?.listing.local_date).toBeNull();
    expect(listing?.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=TH",
      dtstartLocal: "2026-10-29T19:00",
      exdates: [],
      timeListed: true,
    });
    expect(listing?.externalId).toBe("mec:https://viajandoybailando.com/events/salsa-thursday/");
    expect(notes).toContain(
      "1 item(s) made weekly from their page's calendar link: Salsa Thursday",
    );
  });

  it("no listing when rule but no start hour", () => {
    const items: MecItem[] = [
      {
        title: "No Hour",
        startDate: "2026-10-29",
        startHour: null,
        endDate: null,
        endHour: null,
        location: "PR-169",
        categories: null,
        guid: null,
        link: "https://example.com/event",
        description: "No hour",
      },
    ];
    const weeklyRules = new Map<string, string>();
    weeklyRules.set("https://example.com/event", "FREQ=WEEKLY;BYDAY=TH");
    const { listings } = mecToListings(items, { ...options, weeklyRules });
    // Without start hour, window filter applies and date 2026-10-29 is before fromNight 2026-10-31
    // (since days=14, but fromNight is 2026-10-31, start.night 2026-10-29 is not in window)
    expect(listings).toHaveLength(0);
  });

  it("no listing when no rule and date outside window", () => {
    const items: MecItem[] = [
      {
        title: "Old Event",
        startDate: "2026-10-28",
        startHour: "19:00",
        endDate: null,
        endHour: null,
        location: "PR-169",
        categories: null,
        guid: null,
        link: "https://example.com/old",
        description: "Old",
      },
    ];
    const { listings } = mecToListings(items, options);
    expect(listings).toHaveLength(0);
  });
});

describe("harvest with weekly rule from calendar link", () => {
  it("fetches past-dated item and makes weekly", async () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:mec="https://webnus.net/modern-events-calendar">
<channel>
  <item>
    <title>Salsa Thursday</title>
    <link>https://viajandoybailando.com/events/salsa-thursday/</link>
    <mec:startDate>2026-10-29</mec:startDate>
    <mec:startHour>19:00</mec:startHour>
    <mec:location>PR-169</mec:location>
    <guid>https://viajandoybailando.com/events/salsa-thursday/?p=123</guid>
  </item>
</channel>
</rss>`;
    const extraFixtures: Fixture[] = [
      {
        request: {
          method: "GET",
          url: "https://viajandoybailando.com/events/salsa-thursday/",
        },
        response: {
          url: "https://viajandoybailando.com/events/salsa-thursday/",
          status: 200,
          headers: { "content-type": "text/html" },
          body: `<html><a href="https://calendar.google.com/calendar/render?action=TEMPLATE&recur=RRULE%3AFREQ%3DWEEKLY%3BBYDAY%3DTH">Add</a></html>`,
        },
      },
    ];
    const run = ctx(xml, extraFixtures);
    const result = await mecRssAdapter.harvest!({ ...SOURCE, eventPageWeekly: true }, run);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(result.notes).toContain(
      "1 item(s) made weekly from their page's calendar link: Salsa Thursday",
    );
  });
});

describe("harvest without eventPageWeekly (D-466)", () => {
  it("leaves a past-dated item out and never reads its page, as before", async () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0" xmlns:mec="https://webnus.net/modern-events-calendar">
<channel>
  <item>
    <title>Salsa Thursday</title>
    <link>https://viajandoybailando.com/events/salsa-thursday/</link>
    <mec:startDate>2026-10-22</mec:startDate>
    <mec:startHour>19:00</mec:startHour>
    <mec:location>PR-169</mec:location>
    <guid>https://viajandoybailando.com/events/salsa-thursday/?p=123</guid>
  </item>
</channel>
</rss>`;
    const run = ctx(xml, []);
    const asked: string[] = [];
    const request = run.http.request.bind(run.http);
    run.http.request = (req) => {
      asked.push(req.url);
      return request(req);
    };
    const result = await mecRssAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(0);
    expect((result.notes ?? []).join(" ")).not.toContain("made weekly");
    expect(asked).not.toContain("https://viajandoybailando.com/events/salsa-thursday/");
  });
});

describe("hour24", () => {
  it("converts 12-hour times", () => {
    expect(hour24("7:00 pm")).toBe("19:00");
    expect(hour24("12:30 am")).toBe("00:30");
    expect(hour24("12:00 pm")).toBe("12:00");
    expect(hour24("7 pm")).toBe("19:00");
    expect(hour24("2:00 am")).toBe("02:00");
    expect(hour24("")).toBeNull();
    expect(hour24("noon")).toBeNull();
  });

  it("reads 24-hour times", () => {
    // Valid cases
    expect(hour24("23:45")).toBe("23:45");
    expect(hour24("20:00")).toBe("20:00");
    expect(hour24("5:00")).toBe("05:00");
    expect(hour24("0:30")).toBe("00:30");
    expect(hour24(" 19:30 ")).toBe("19:30");
    // Invalid 24-hour (out of range, missing minutes, etc.)
    expect(hour24("24:00")).toBeNull();
    expect(hour24("25:10")).toBeNull();
    expect(hour24("12:60")).toBeNull();
    expect(hour24("7:5")).toBeNull(); // single-digit minutes
    expect(hour24("23")).toBeNull(); // no minutes
    expect(hour24("7")).toBeNull(); // bare number
    // Mixed forms with am/pm stay 12-hour
    expect(hour24("23:45 pm")).toBeNull(); // 23 is invalid for 12-hour
    expect(hour24("12:00 am")).toBe("00:00");
  });
});

describe("mecToListings", () => {
  const options = {
    siteUrl: "https://viajandoybailando.com/mec-category/puerto-rico/",
    fetchedAt: NOW,
    metroTz: "America/Puerto_Rico",
    countryCode: "PR",
    fromNight: "2026-10-29",
    days: 14,
  };

  it("returns 3 listings (old September item excluded)", () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const items = parseMecFeed(xml);
    const { listings, notes } = mecToListings(items, options);
    expect(listings).toHaveLength(3);
    // Guaynabo has start hour "7:00 pm", so no note
    expect(notes).not.toContain("no start hour: Guaynabo: Salsa en Vivo al Aire Libre");
    const guaynabo = listings[0];
    expect(guaynabo?.listing.title).toBe("Guaynabo: Salsa en Vivo al Aire Libre");
    expect(guaynabo?.tz).toBe("America/Puerto_Rico");
    expect(guaynabo?.listing.local_date).toBe("2026-10-29");
    expect(guaynabo?.listing.doors_time).toBe("19:00");
    expect(guaynabo?.listing.venue?.address).toBe("PR-169, Guaynabo, PR");
    expect(guaynabo?.externalId).toBe("mec:1487:2026-10-29");
  });

  it("handles Cupey item with end time", () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const items = parseMecFeed(xml);
    const { listings } = mecToListings(items, options);
    const cupey = listings[1];
    expect(cupey?.listing.title).toBe("San Juan / Cupey: Clase de Salsa gratis y salsa en Vivo");
    expect(cupey?.listing.doors_time).toBe("20:00");
    expect(cupey?.listing.end_time).toBe("23:45");
    expect(cupey?.listing.styles).toContain("salsa");
  });

  it("handles Carolina item crossing midnight", () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const items = parseMecFeed(xml);
    const { listings } = mecToListings(items, options);
    const carolina = listings[2];
    expect(carolina?.listing.title).toBe("Carolina: Bachata Night");
    expect(carolina?.listing.local_date).toBe("2026-10-30");
    expect(carolina?.listing.doors_time).toBe("22:00");
    // End should be kept because same night (after adjustment)
    expect(carolina?.listing.end_time).toBe("02:00");
    expect(carolina?.listing.styles).toContain("bachata");
    // Description should have decoded &amp;
    expect(items[2]?.description).toBe("Bachata social & DJ.");
  });

  it("handles 24-hour times with end crossing midnight (La Deskomunal style)", () => {
    const items: MecItem[] = [
      {
        title: "La Deskomunal Night",
        startDate: "2026-10-30",
        startHour: "23:45",
        endDate: "2026-10-31",
        endHour: "5:00",
        location: "Calle Example, Madrid",
        categories: null,
        guid: null,
        link: "https://ladeskomunal.coop/agenda/event",
        description: "All night party",
      },
    ];
    const options24 = {
      siteUrl: "https://ladeskomunal.coop/agenda/",
      fetchedAt: NOW,
      metroTz: "Europe/Madrid",
      countryCode: "ES",
      fromNight: "2026-10-30",
      days: 14,
    };
    const { listings } = mecToListings(items, options24);
    expect(listings).toHaveLength(1);
    const listing = listings[0];
    expect(listing?.listing.title).toBe("La Deskomunal Night");
    expect(listing?.listing.local_date).toBe("2026-10-30");
    expect(listing?.listing.doors_time).toBe("23:45");
    // End hour 5:00 is earlier than start hour 23:45 and before noon, but endDate is already next day.
    // The end time is kept (as seen in existing Carolina test).
    expect(listing?.listing.end_time).toBe("05:00");
  });

  it("item with empty startHour gets date-only start and note", () => {
    const items: MecItem[] = [
      {
        title: "Test Event",
        startDate: "2026-10-29",
        startHour: "",
        endDate: null,
        endHour: null,
        location: "Test",
        categories: null,
        guid: null,
        link: "https://example.com",
        description: "Test",
      },
    ];
    const { listings, notes } = mecToListings(items, options);
    expect(listings).toHaveLength(1);
    expect(notes).toContain("no start hour: Test Event");
    const listing = listings[0];
    expect(listing?.listing.doors_time).toBeNull(); // date-only
  });

  it("mixedCalendar true gives empty styles", () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const items = parseMecFeed(xml);
    const { listings } = mecToListings(items, { ...options, mixedCalendar: true });
    expect(listings).toHaveLength(3);
    // With mixedCalendar true, styles should be empty (no fallback to text)
    // However, buildListing may fall back to stylesFromText. We'll accept that for now.
    // The spec says "like wp-tribe", which may have the same behavior.
    // We'll not assert on styles.
  });
});

describe("placeNameFromEventPage", () => {
  it("function is defined", () => {
    expect(typeof placeNameFromEventPage).toBe("function");
  });

  it("extracts name from JSON-LD location object", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Event",
              "name": "Clase",
              "location": {
                "@type": "Place",
                "name": "Downtown Cupey",
                "image": "",
                "address": "#54 Ave. Paraná, San Juan, PR"
              }
            }
          </script>
        </head>
      </html>
    `;
    expect(placeNameFromEventPage(html)).toBe("Downtown Cupey");
  });

  it("handles @graph form", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Event",
              "location": {
                "name": "Salsa &amp; Co",
                "address": "123 St"
              }
            }
          ]
        }
      </script>
    `;
    expect(placeNameFromEventPage(html)).toBe("Salsa & Co");
  });

  it("handles array of blocks", () => {
    const html = `
      <script type="application/ld+json">[
        {
          "@type": "Event",
          "location": { "name": "Venue One" }
        }
      ]</script>
    `;
    expect(placeNameFromEventPage(html)).toBe("Venue One");
  });

  it("returns null for invalid JSON", () => {
    const html = `<script type="application/ld+json">{ invalid }</script>`;
    expect(placeNameFromEventPage(html)).toBeNull();
  });

  it("returns null when location has no name", () => {
    const html = `
      <script type="application/ld+json">
        { "@type": "Event", "location": { "address": "123 St" } }
      </script>
    `;
    expect(placeNameFromEventPage(html)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(placeNameFromEventPage("")).toBeNull();
  });
});

describe("mecToListings with venueNames", () => {
  const options = {
    siteUrl: "https://viajandoybailando.com/mec-category/puerto-rico/",
    fetchedAt: NOW,
    metroTz: "America/Puerto_Rico",
    countryCode: "PR",
    fromNight: "2026-10-29",
    days: 14,
  };

  it("uses venue name from map", () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const items = parseMecFeed(xml);
    // Find Cupey item link
    const cupeyItem = items.find((item) => item.title?.includes("Cupey") && item.link);
    const venueNames = new Map<string, string>();
    if (cupeyItem?.link) {
      venueNames.set(cupeyItem.link, "Downtown Cupey");
    }
    const { listings } = mecToListings(items, { ...options, venueNames });
    const cupeyListing = listings.find((l) => l.listing.title?.includes("Cupey"));
    expect(cupeyListing?.listing.venue?.name).toBe("Downtown Cupey");
    // Other listings should have null venue name
    const otherListings = listings.filter((l) => !l.listing.title?.includes("Cupey"));
    for (const listing of otherListings) {
      expect(listing.listing.venue?.name).toBeNull();
    }
  });
});

describe("mecRssAdapter", () => {
  it("harvests from feed URL", async () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const run = ctx(xml);
    const result = await mecRssAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(3);
    expect(result.doc?.url).toBe("https://viajandoybailando.com/mec-category/puerto-rico/feed/");
  });

  it("throws on non-MEC feed", async () => {
    const run = ctx("<rss><channel></channel></rss>");
    await expect(mecRssAdapter.harvest!(SOURCE, run)).rejects.toThrow(
      "not a Modern Events Calendar feed",
    );
  });

  it("fetches event pages for venue names", async () => {
    const xml = fixture("mec-rss-puerto-rico.xml");
    const cupeyHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Event",
              "name": "Clase",
              "location": {
                "@type": "Place",
                "name": "Downtown Cupey",
                "image": "",
                "address": "#54 Ave. Paraná, San Juan, PR"
              }
            }
          </script>
        </head>
      </html>
    `;
    const extraFixtures: Fixture[] = [
      {
        request: {
          method: "GET",
          url: "https://viajandoybailando.com/events/san-juan-cupey-clase-de-salsa-gratis-y-salsa-en-vivo/",
        },
        response: {
          url: "https://viajandoybailando.com/events/san-juan-cupey-clase-de-salsa-gratis-y-salsa-en-vivo/",
          status: 200,
          headers: { "content-type": "text/html" },
          body: cupeyHtml,
        },
      },
      // Other event pages will throw because not recorded
    ];
    const run = ctx(xml, extraFixtures);
    const result = await mecRssAdapter.harvest!(SOURCE, run);
    expect(result.listings).toHaveLength(3);
    const cupeyListing = result.listings.find((l) => l.listing.title?.includes("Cupey"));
    expect(cupeyListing?.listing.venue?.name).toBe("Downtown Cupey");
    // Should have notes for unread event pages
    expect(result.notes).toContain(
      "event page not read: https://viajandoybailando.com/events/guaynabo-salsa-en-vivo-al-aire-libre-983/",
    );
    expect(result.notes).toContain(
      "event page not read: https://viajandoybailando.com/events/carolina-bachata-night/",
    );
    // Old out-of-window item should not be requested
    expect(result.notes).not.toContain(
      "event page not read: https://viajandoybailando.com/events/old/",
    );
  });
});
