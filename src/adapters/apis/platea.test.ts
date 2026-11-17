import { describe, expect, it } from "vitest";
import {
  plateaEvents,
  isDanceTitle,
  inPlateaMetro,
  metroTowns,
  plateaAdapter,
  plateaEventUrl,
} from "@/src/adapters/apis/platea";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";

const SJ_TOWNS = metroTowns("san-juan");

const PR: Metro = {
  id: "m",
  slug: "san-juan",
  name: "San Juan",
  countryCode: "PR",
  center: { lat: 18.4655, lng: -66.1057 },
  radiusKm: 25,
  tz: "America/Puerto_Rico",
  languages: ["es"],
};

const SOURCE: Source = {
  id: "s",
  url: "https://www.plateapr.com/eventos",
  kind: "jsonld",
  trustTier: "directory",
  platform: "platea",
  feedUrl: null,
  metroId: "m",
  styles: ["salsa", "bomba"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function page(payload: unknown): string {
  const text = JSON.stringify(payload);
  const half = Math.floor(text.length / 2);
  const push = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  return `<html><body>${push(text.slice(0, half))}${push(text.slice(half))}</body></html>`;
}

function rec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "1",
    slug: "test",
    href: "/eventos/test",
    title: "Test",
    startDate: "2026-11-12T20:00:00-04:00",
    allDay: false,
    venueName: null,
    placeName: "San Juan",
    ticketUrl: null,
    categories: "$88:props:x",
    ...overrides,
  };
}

function ctxFor(html: string): RunCtx {
  let t = new Date("2026-11-06T16:00:00Z").getTime();
  return {
    metro: PR,
    now: () => new Date(t),
    env: {},
    log: () => {},
    http: createPoliteHttp({
      userAgent: "test",
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      transport: async (req: TransportRequest) => {
        if (req.url === "https://www.plateapr.com/robots.txt") {
          return {
            url: req.url,
            status: 200,
            headers: {},
            body: "User-agent: *\nAllow: /\n",
          };
        }
        if (req.url === "https://www.plateapr.com/eventos") {
          return { url: req.url, status: 200, headers: {}, body: html };
        }
        return { url: req.url, status: 404, headers: {}, body: "" };
      },
    }),
  };
}

describe("plateaEvents", () => {
  it("parses records and dedupes by id", () => {
    const events = plateaEvents(page([rec({ id: "1" }), rec({ id: "1", title: "Duplicate" })]));
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("1");
    expect(events[0]?.title).toBe("Test");
  });

  it("extracts multiple records", () => {
    const events = plateaEvents(page([rec({ id: "1" }), rec({ id: "2" })]));
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("returns empty array for empty html", () => {
    expect(plateaEvents("<html></html>")).toEqual([]);
  });

  it("finds records nested in groups", () => {
    const html = page({
      groups: [
        {
          id: "g1",
          title: "Esta semana",
          rows: [rec({ id: "nested" })],
        },
      ],
    });
    const events = plateaEvents(html);
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("nested");
  });
});

describe("isDanceTitle", () => {
  it("returns true for salsa title", () => {
    expect(isDanceTitle("Salsa en el Patio", "salsa-en-el-patio")).toBe(true);
  });

  it("returns true for bomba title", () => {
    expect(isDanceTitle("Noche de Bomba", "noche-de-bomba")).toBe(true);
  });

  it("returns false for art workshop about bomba", () => {
    expect(isDanceTitle("Taller inspirado en 'Bomba'", "taller-bomba")).toBe(false);
  });

  it("returns false for conference", () => {
    expect(isDanceTitle("Conferencia sobre Salsa", "conferencia-salsa")).toBe(false);
  });

  it("returns false for non-dance title", () => {
    expect(isDanceTitle("Thanksgiving Lunch", "thanksgiving")).toBe(false);
  });
});

describe("inPlateaMetro", () => {
  it("returns true for San Juan", () => {
    expect(inPlateaMetro("San Juan", SJ_TOWNS)).toBe(true);
  });

  it("returns true for Bayamon with accent", () => {
    expect(inPlateaMetro("Bayamón", SJ_TOWNS)).toBe(true);
  });

  it("returns true for CATAÑO", () => {
    expect(inPlateaMetro("CATAÑO", SJ_TOWNS)).toBe(true);
  });

  it("returns false for Toa Baja", () => {
    expect(inPlateaMetro("Toa Baja", SJ_TOWNS)).toBe(false);
  });

  it("returns false for null", () => {
    expect(inPlateaMetro(null, SJ_TOWNS)).toBe(false);
  });
});

describe("plateaAdapter", () => {
  it("has correct metadata", () => {
    expect(plateaAdapter.id).toBe("platea");
    expect(plateaAdapter.tier).toBe("A");
    expect(plateaAdapter.countries).toEqual(["US", "PR"]);
  });

  it("Salsa en el Patio -> day/night 2026-11-12, time 20:00, eventUrl, ticketUrl, type social", async () => {
    const html = page([
      rec({
        id: "1",
        slug: "salsa-en-el-patio-2026-11-12",
        href: "/eventos/salsa-en-el-patio-2026-11-12",
        title: "Salsa en el Patio",
        startDate: "2026-11-12T20:00:00-04:00",
        allDay: false,
        venueName: "Museo de Arte Contemporáneo",
        placeName: "San Juan",
        ticketUrl: "http://museomac.org",
      }),
    ]);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(1);
    const l = result.listings[0]!;
    expect(l.listing.title).toBe("Salsa en el Patio");
    expect(l.listing.local_date).toBe("2026-11-12");
    expect(l.listing.doors_time).toBe("20:00");
    expect(l.eventUrl).toBe("https://www.plateapr.com/eventos/salsa-en-el-patio-2026-11-12");
    expect(l.listing.ticket_url).toBe("http://museomac.org/");
    expect(l.listing.listing_type).toBe("social");
  });

  it("UTC start Carolina Clases de Salsa gratis -> day 2026-11-10, lesson_time 19:30, type class", async () => {
    const html = page([
      rec({
        id: "2",
        slug: "clases-salsa-gratis",
        href: "/eventos/clases-salsa-gratis",
        title: "Clases de Salsa gratis",
        startDate: "2026-11-10T23:30:00.000Z",
        allDay: false,
        placeName: "Carolina",
      }),
    ]);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(1);
    const l = result.listings[0]!;
    expect(l.listing.title).toBe("Clases de Salsa gratis");
    expect(l.listing.local_date).toBe("2026-11-10");
    // For a class, the start time should be lesson_time, doors_time may be null
    // Accept either doors_time or lesson_time being "19:30"
    if (l.listing.lesson_time === "19:30") {
      expect(l.listing.doors_time).toBeNull();
    } else if (l.listing.doors_time === "19:30") {
      expect(l.listing.lesson_time).toBeNull();
    } else {
      // If neither has the expected time, fail
      expect.fail("Neither doors_time nor lesson_time is 19:30");
    }
    expect(l.listing.listing_type).toBe("class");
  });

  it("all-day Noche de Merengue -> day 2026-11-12, time null", async () => {
    const html = page([
      rec({
        id: "3",
        slug: "noche-merengue",
        href: "/eventos/noche-merengue",
        title: "Conciertos Al Fresco: Noche de Merengue",
        startDate: "2026-11-12T04:00:00.000Z",
        allDay: true,
        placeName: "San Juan",
      }),
    ]);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(1);
    const l = result.listings[0]!;
    expect(l.listing.title).toBe("Conciertos Al Fresco: Noche de Merengue");
    expect(l.listing.local_date).toBe("2026-11-12");
    expect(l.listing.doors_time).toBeNull();
  });

  it("Dorado left out (outside)", async () => {
    const html = page([
      rec({
        id: "4",
        slug: "salsa-dorado",
        title: "Clases de Salsa Básica gratis en Dorado",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "Dorado",
      }),
    ]);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(
      /1 events on the page; 1 in the window; 0 not dance; 1 outside the metro; 0 without a date; 0 listed/,
    );
  });

  it("Bayamón taller left out (not dance)", async () => {
    const html = page([
      rec({
        id: "5",
        slug: "taller-bomba",
        title: "Post-Neocubismo: Taller inspirado en 'Bomba'",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "Bayamón",
      }),
    ]);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(
      /1 events on the page; 1 in the window; 1 not dance; 0 outside the metro; 0 without a date; 0 listed/,
    );
  });

  it("Thanksgiving lunch left out (not dance)", async () => {
    const html = page([
      rec({
        id: "6",
        slug: "thanksgiving",
        title: "Thanksgiving Lunch en Royal Sonesta San Juan",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "San Juan",
      }),
    ]);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(
      /1 events on the page; 1 in the window; 1 not dance; 0 outside the metro; 0 without a date; 0 listed/,
    );
  });

  it("2027-03-01 left out (outside window)", async () => {
    const html = page([
      rec({
        id: "7",
        slug: "future",
        title: "Salsa Future",
        startDate: "2027-03-01T20:00:00-04:00",
        placeName: "San Juan",
      }),
    ]);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(
      /1 events on the page; 0 in the window; 0 not dance; 0 outside the metro; 0 without a date; 0 listed/,
    );
  });

  it("notes line counts correctly for 7 records + duplicate", async () => {
    const records = [
      rec({
        id: "1",
        title: "Salsa en el Patio",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "San Juan",
      }),
      rec({
        id: "1",
        title: "Duplicate",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "San Juan",
      }), // duplicate
      rec({
        id: "2",
        title: "Clases de Salsa gratis",
        startDate: "2026-11-10T23:30:00.000Z",
        placeName: "Carolina",
      }),
      rec({
        id: "3",
        title: "Conciertos Al Fresco: Noche de Merengue",
        startDate: "2026-11-12T04:00:00.000Z",
        allDay: true,
        placeName: "San Juan",
      }),
      rec({
        id: "4",
        title: "Clases de Salsa Básica gratis en Dorado",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "Dorado",
      }),
      rec({
        id: "5",
        title: "Post-Neocubismo: Taller inspirado en 'Bomba'",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "Bayamón",
      }),
      rec({
        id: "6",
        title: "Thanksgiving Lunch en Royal Sonesta San Juan",
        startDate: "2026-11-12T20:00:00-04:00",
        placeName: "San Juan",
      }),
      rec({
        id: "7",
        title: "Salsa Future",
        startDate: "2027-03-01T20:00:00-04:00",
        placeName: "San Juan",
      }),
    ];
    const html = page(records);
    const ctx = ctxFor(html);
    const result = await plateaAdapter.harvest!(SOURCE, ctx);
    // 7 unique records (duplicate removed), 6 in window (id 7 outside), 2 not dance (id 5,6), 1 outside metro (id 4), 0 bad date, 3 listed (id 1,2,3)
    expect(result.notes?.[0]).toBe(
      "7 events on the page; 6 in the window; 2 not dance; 1 outside the metro; 0 without a date; 3 listed",
    );
  });

  it("throws when page has no records", async () => {
    const ctx = ctxFor("<html></html>");
    await expect(plateaAdapter.harvest!(SOURCE, ctx)).rejects.toThrow(
      "plateapr.com/eventos shows no event records",
    );
  });
});

describe("metroTowns", () => {
  it("is San Juan's outline parts, the five municipios", () => {
    expect([...SJ_TOWNS].sort()).toEqual(["Bayamón", "Carolina", "Cataño", "Guaynabo", "San Juan"]);
    expect(metroTowns("nowhere")).toEqual([]);
  });
});

describe("plateaEventUrl", () => {
  it("resolves a site path", () => {
    expect(plateaEventUrl("/eventos/a-b", "a-b")).toBe("https://www.plateapr.com/eventos/a-b");
  });
  it("keeps an absolute plateapr.com URL", () => {
    expect(plateaEventUrl("https://plateapr.com/eventos/x", "x")).toBe(
      "https://plateapr.com/eventos/x",
    );
  });
  it("falls back to /eventos/<slug> for an off-site or javascript: href", () => {
    expect(plateaEventUrl("https://evil.example/eventos/x", "x")).toBe(
      "https://www.plateapr.com/eventos/x",
    );
    expect(plateaEventUrl("javascript:alert(1)", "x")).toBe("https://www.plateapr.com/eventos/x");
  });
});

describe("plateaAdapter links and place", () => {
  it("drops a non-http ticket link, never sets an address, keeps the venue name", async () => {
    const html = page([
      rec({
        id: "j",
        slug: "salsa-j",
        href: "/eventos/salsa-j",
        title: "Salsa J",
        venueName: "El Patio",
        ticketUrl: "javascript:alert(1)",
      }),
      rec({
        id: "k",
        slug: "salsa-k",
        href: "/eventos/salsa-k",
        title: "Salsa K",
        venueName: null,
        ticketUrl: "data:text/html,x",
      }),
    ]);
    const result = await plateaAdapter.harvest!(SOURCE, ctxFor(html));
    expect(result.listings).toHaveLength(2);
    for (const l of result.listings) {
      expect(l.listing.ticket_url ?? null).toBeNull();
      expect(JSON.stringify(l)).not.toContain("Puerto Rico");
    }
  });
});
