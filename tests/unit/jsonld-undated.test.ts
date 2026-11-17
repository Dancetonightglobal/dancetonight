import { describe, expect, it } from "vitest";
import { hasDatedEvent, findEvents, extractJsonLd } from "@/src/adapters/feeds/jsonld";
import { probePage } from "@/src/pipeline/probe";
import { jsonLdAdapter } from "@/src/adapters/feeds/jsonld";
import type { Source, RunCtx } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { currentNightDate } from "@/src/domain/tonight";

const NYC = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

function ctxWith(fixtures: Fixture[]): RunCtx {
  const t = Date.now();
  return {
    metro: NYC,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport(fixtures),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => {
        // no-op
      },
    }),
    env: {},
    log: () => {},
  };
}

describe("hasDatedEvent", () => {
  it("returns false for empty array", () => {
    expect(hasDatedEvent([])).toBe(false);
  });

  it("returns false for undated EventSeries", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"EventSeries","name":"Salsa Paris Night — Événements",
       "organizer":{"@type":"Organization","name":"Salsa Paris Night","url":"https://salsaparisnight.com"},
       "location":{"@type":"Place","name":"Paris","address":{"@type":"PostalAddress","addressLocality":"Paris","addressCountry":"FR"}}}
    </script></head></html>`;
    const { blocks } = extractJsonLd(html);
    const events = findEvents(blocks);
    expect(hasDatedEvent(events)).toBe(false);
  });

  it("returns true for Event with startDate", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event","name":"SALSA DE LOS MUERTOS - 31/10 TiTi Palacio","startDate":"2026-10-31 20:00:00"}
    </script></head></html>`;
    const { blocks } = extractJsonLd(html);
    const events = findEvents(blocks);
    expect(hasDatedEvent(events)).toBe(true);
  });

  it("returns false for Event with empty startDate", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event","name":"Test","startDate":""}
    </script></head></html>`;
    const { blocks } = extractJsonLd(html);
    const events = findEvents(blocks);
    expect(hasDatedEvent(events)).toBe(false);
  });

  it("returns true for Event with eventSchedule", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event","name":"Weekly Dance","eventSchedule":{"@type":"Schedule","repeatFrequency":"P1W"}}
    </script></head></html>`;
    const { blocks } = extractJsonLd(html);
    const events = findEvents(blocks);
    expect(hasDatedEvent(events)).toBe(true);
  });

  it("returns true for EventSeries with dated subEvent", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"EventSeries","name":"Series",
       "subEvent":{"@type":"Event","name":"Sub","startDate":"2026-10-31 20:00:00"}}
    </script></head></html>`;
    const { blocks } = extractJsonLd(html);
    const events = findEvents(blocks);
    expect(hasDatedEvent(events)).toBe(true);
  });

  it("returns false for EventSeries with undated subEvent", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"EventSeries","name":"Series",
       "subEvent":{"@type":"Event","name":"Sub"}}
    </script></head></html>`;
    const { blocks } = extractJsonLd(html);
    const events = findEvents(blocks);
    expect(hasDatedEvent(events)).toBe(false);
  });
});

describe("probePage with undated events", () => {
  it("returns html kind for page with undated EventSeries", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"EventSeries","name":"Salsa Paris Night — Événements",
       "organizer":{"@type":"Organization","name":"Salsa Paris Night","url":"https://salsaparisnight.com"},
       "location":{"@type":"Place","name":"Paris","address":{"@type":"PostalAddress","addressLocality":"Paris","addressCountry":"FR"}}}
    </script></head><body><h2>Samedi 15 novembre - Soirée Salsa</h2></body></html>`;
    const result = probePage("https://salsaparisnight.com/agenda-evenements", html);
    expect(result.kind).toBe("html");
    expect(result.reason).toBe("no feed or structured events on the page");
  });

  it("returns jsonld kind for page with dated Event", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event","name":"SALSA DE LOS MUERTOS - 31/10 TiTi Palacio","startDate":"2026-10-31 20:00:00"}
    </script></head></html>`;
    const result = probePage("https://www.titipalacio.com/", html);
    expect(result.kind).toBe("jsonld");
    expect(result.reason).toBe("schema.org events in the page");
  });
});

describe("jsonLdAdapter.harvest with undated events", () => {
  const SOURCE: Source = {
    id: "s",
    url: "https://salsaparisnight.com/agenda-evenements",
    kind: "jsonld",
    trustTier: "first_party",
    platform: null,
    feedUrl: null,
    metroId: "m",
    styles: [],
    etag: null,
    lastModified: null,
    contentHash: null,
  };

  it("returns readWithModel for page with undated EventSeries", async () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"EventSeries","name":"Salsa Paris Night — Événements",
       "organizer":{"@type":"Organization","name":"Salsa Paris Night","url":"https://salsaparisnight.com"},
       "location":{"@type":"Place","name":"Paris","address":{"@type":"PostalAddress","addressLocality":"Paris","addressCountry":"FR"}}}
    </script></head><body><h2>Samedi 15 novembre - Soirée Salsa</h2></body></html>`;
    const fixtures: Fixture[] = [
      {
        request: { method: "GET", url: "https://salsaparisnight.com/robots.txt" },
        response: {
          url: "https://salsaparisnight.com/robots.txt",
          status: 404,
          headers: {},
          body: "",
        },
      },
      {
        request: { method: "GET", url: "https://salsaparisnight.com/agenda-evenements" },
        response: {
          url: "https://salsaparisnight.com/agenda-evenements",
          status: 200,
          headers: { "content-type": "text/html" },
          body: html,
        },
      },
    ];
    const ctx = ctxWith(fixtures);
    const result = await jsonLdAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(0);
    expect(result.readWithModel).toBe("schema.org events on the page state no date");
    expect(result.notes).toContain(
      "schema.org events on the page state no date: read by the model",
    );
    expect(result.doc).toBeUndefined();
  });

  it("returns normal result for page with dated Event", async () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Event","name":"SALSA DE LOS MUERTOS - 31/10 TiTi Palacio","startDate":"2026-10-31 20:00:00"}
    </script></head></html>`;
    const fixtures: Fixture[] = [
      {
        request: { method: "GET", url: "https://www.titipalacio.com/robots.txt" },
        response: {
          url: "https://www.titipalacio.com/robots.txt",
          status: 404,
          headers: {},
          body: "",
        },
      },
      {
        request: { method: "GET", url: "https://www.titipalacio.com/" },
        response: {
          url: "https://www.titipalacio.com/",
          status: 200,
          headers: { "content-type": "text/html" },
          body: html,
        },
      },
    ];
    const source: Source = {
      ...SOURCE,
      url: "https://www.titipalacio.com/",
    };
    const ctx = ctxWith(fixtures);
    const result = await jsonLdAdapter.harvest!(source, ctx);
    // The event is in the past, so no listings for tonight onward
    expect(result.listings).toHaveLength(0);
    expect(result.readWithModel).toBeUndefined();
    expect(result.doc).toBeDefined();
  });
});
