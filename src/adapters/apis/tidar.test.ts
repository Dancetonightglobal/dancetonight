import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  tidarEvents,
  isMarrakechCity,
  isTidarDance,
  tidarAdapter,
  type TidarEvent,
} from "@/src/adapters/apis/tidar";
import type { RunCtx, Source } from "@/src/adapters/types";

function harvest(...args: Parameters<NonNullable<typeof tidarAdapter.harvest>>) {
  const fn = tidarAdapter.harvest;
  if (!fn) throw new Error("tidarAdapter has no harvest");
  return fn(...args);
}

function testSource(overrides?: Partial<Source>): Source {
  return {
    id: "test",
    url: "https://buy.tidar.ma/city/marrakech",
    styles: [],
    ...overrides,
  } as unknown as Source;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = join(__dirname, "__fixtures__", "tidar-marrakech.html");
const fixtureHtml = readFileSync(fixturePath, "utf8");

describe("tidarEvents", () => {
  it("extracts events from __NEXT_DATA__", () => {
    const html = `
      <html>
        <script id="__NEXT_DATA__" type="application/json">
          {
            "props": {
              "pageProps": {
                "events": [
                  {
                    "id": 528,
                    "name": "MONTROUGE @ LEONE DISCOTECA",
                    "address": "Leone Discoteca Marrakech, Rue Abdelaziz Ettaalibi, Marrakech, Maroc",
                    "city": "Marrakech",
                    "coordinates": "31.6259689,-8.0045516",
                    "from": "2026-11-13 00:00:00",
                    "to": "2026-11-14 05:00:00",
                    "tags": null,
                    "slug": "montrouge-at-leone-discoteca",
                    "published": 1,
                    "category": {"slug": "electronique"}
                  },
                  {
                    "id": 530,
                    "name": "Sol Sundays - Vol 3",
                    "address": "El Fenn Hotel, Restaurant and Rooftop Bar, Marrakech, Maroc",
                    "city": "Marrakech",
                    "coordinates": "31.6269525,-7.9931709",
                    "from": "2026-11-08 17:00:00",
                    "to": "2026-11-08 22:00:00",
                    "category": {"slug": "electronique"}
                  },
                  {
                    "id": 522,
                    "name": "BO9AL SHOW",
                    "address": "Salle Abdeljabbar Louzir, Mhamid",
                    "city": "Marrakech",
                    "from": "2026-11-21 00:00:00",
                    "to": "2026-11-21 00:00:00",
                    "tags": "Trap,Bo9al",
                    "category": {"slug": "art-et-culture"}
                  }
                ]
              }
            }
          }
        </script>
      </html>
    `;
    const events = tidarEvents(html);
    expect(events).toHaveLength(3);
    const [first, second, third] = events;
    expect(first?.name).toBe("MONTROUGE @ LEONE DISCOTECA");
    expect(first?.slug).toBe("montrouge-at-leone-discoteca");
    expect(second?.name).toBe("Sol Sundays - Vol 3");
    expect(third?.name).toBe("BO9AL SHOW");
  });

  it("returns [] for no __NEXT_DATA__", () => {
    const html = "<html><body>No script</body></html>";
    expect(tidarEvents(html)).toEqual([]);
  });

  it("returns [] for broken JSON", () => {
    const html = '<script id="__NEXT_DATA__">invalid json</script>';
    expect(tidarEvents(html)).toEqual([]);
  });
});

describe("isMarrakechCity", () => {
  it("accepts Marrakech and Marrakesh", () => {
    expect(isMarrakechCity("Marrakech")).toBe(true);
    expect(isMarrakechCity("Marrakesh")).toBe(true);
    expect(isMarrakechCity("Casablanca")).toBe(false);
    expect(isMarrakechCity(null)).toBe(false);
    expect(isMarrakechCity("")).toBe(false);
  });
});

const tidarRecord = (fields: Partial<TidarEvent> & { id: number; name: string }): TidarEvent => ({
  address: null,
  city: "Marrakech",
  coordinates: null,
  from: null,
  to: null,
  tags: null,
  slug: null,
  published: 1,
  category: null,
  ...fields,
});

describe("isTidarDance", () => {
  it("keeps electronique category", () => {
    const rec = tidarRecord({
      id: 1,
      name: "Test",
      category: { slug: "electronique" },
    });
    expect(isTidarDance(rec)).toBe(true);
  });

  it("keeps dance word in name", () => {
    const rec = tidarRecord({
      id: 1,
      name: "Salsa Night",
      category: { slug: "other" },
    });
    expect(isTidarDance(rec)).toBe(true);
  });

  it("rejects non-dance", () => {
    const rec = tidarRecord({
      id: 1,
      name: "BO9AL SHOW",
      category: { slug: "art-et-culture" },
    });
    // hasDanceWord("BO9AL SHOW") likely returns false.
    expect(isTidarDance(rec)).toBe(false);
  });
});

describe("tidarAdapter harvest", () => {
  const mockHttp = {
    request: vi.fn(),
  };

  const mockCtx: RunCtx = {
    now: () => new Date("2026-11-07T10:00:00Z"),
    metro: {
      id: "marrakesh",
      name: "Marrakesh",
      tz: "Africa/Casablanca",
      slug: "marrakesh",
      countryCode: "MA",
      center: { lat: 31.6258, lng: -7.9892 },
      radiusKm: 60,
      languages: ["ar", "fr"],
    },
    http: mockHttp,
  } as unknown as RunCtx;

  const source = testSource();

  it("lists Montrouge and Sol Sundays, not BO9AL SHOW", async () => {
    const html = `
      <script id="__NEXT_DATA__">
        {
          "props": {
            "pageProps": {
              "events": [
                {
                  "id": 528,
                  "name": "MONTROUGE @ LEONE DISCOTECA",
                  "address": "Leone Discoteca Marrakech, Rue Abdelaziz Ettaalibi, Marrakech, Maroc",
                  "city": "Marrakech",
                  "coordinates": "31.6259689,-8.0045516",
                  "from": "2026-11-13 00:00:00",
                  "to": "2026-11-14 05:00:00",
                  "slug": "montrouge-at-leone-discoteca",
                  "published": 1,
                  "category": {"slug": "electronique"}
                },
                {
                  "id": 530,
                  "name": "Sol Sundays - Vol 3",
                  "address": "El Fenn Hotel, Restaurant and Rooftop Bar, Marrakech, Maroc",
                  "city": "Marrakech",
                  "coordinates": "31.6269525,-7.9931709",
                  "from": "2026-11-08 17:00:00",
                  "to": "2026-11-08 22:00:00",
                  "slug": "sol-sundays-vol-3",
                  "published": 1,
                  "category": {"slug": "electronique"}
                },
                {
                  "id": 522,
                  "name": "BO9AL SHOW",
                  "address": "Salle Abdeljabbar Louzir, Mhamid",
                  "city": "Marrakech",
                  "from": "2026-11-21 00:00:00",
                  "to": "2026-11-21 00:00:00",
                  "published": 1,
                  "category": {"slug": "art-et-culture"}
                }
              ]
            }
          }
        }
      </script>
    `;
    mockHttp.request.mockResolvedValue({
      body: html,
      fetchedAt: new Date(),
      status: 200,
      etag: null,
      lastModified: null,
    });

    const result = await harvest(source, mockCtx);
    const [first, second] = result.listings;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(result.listings).toHaveLength(2);
    expect(first?.listing.title).toBe("MONTROUGE @ LEONE DISCOTECA");
    const time = first?.listing.doors_time;
    expect(time === null || time === undefined).toBe(true);
    expect(first?.listing.local_date).toBe("2026-11-13");
    expect(first?.listing.venue?.name).toBe("Leone Discoteca Marrakech");
    expect(first?.venueLocation?.lat).toBeCloseTo(31.6259689);
    expect(first?.eventUrl).toBe("https://buy.tidar.ma/event/montrouge-at-leone-discoteca");

    expect(second?.listing.title).toBe("Sol Sundays - Vol 3");
    expect(second?.listing.doors_time).toBe("17:00");
    expect(second?.listing.end_time).toBe("22:00");

    expect(result.notes?.[0]).toMatch(
      /3 events on the page; 2 in the window; 0 other city; 0 not dance; 0 outside the metro; 0 without a date; 2 listed/,
    );
  });

  it("filters by city and published", async () => {
    const html = `
      <script id="__NEXT_DATA__">
        {
          "props": {
            "pageProps": {
              "events": [
                {
                  "id": 1,
                  "name": "Event in Casablanca",
                  "city": "Casablanca",
                  "published": 1,
                  "from": "2026-11-08 20:00:00",
                  "category": {"slug": "electronique"}
                },
                {
                  "id": 2,
                  "name": "Unpublished",
                  "city": "Marrakech",
                  "published": 0,
                  "from": "2026-11-08 20:00:00",
                  "category": {"slug": "electronique"}
                }
              ]
            }
          }
        }
      </script>
    `;
    mockHttp.request.mockResolvedValue({
      body: html,
      fetchedAt: new Date(),
      status: 200,
      etag: null,
      lastModified: null,
    });

    const result = await harvest(source, mockCtx);
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(
      /2 events on the page; 0 in the window; 1 other city; 0 not dance; 0 outside the metro; 0 without a date; 0 listed/,
    );
  });

  it("handles missing keys without throwing", async () => {
    const html = `
      <script id="__NEXT_DATA__">
        {
          "props": {
            "pageProps": {
              "events": [
                {"title": "X", "start": "2026-11-08 20:00:00"},
                {"name": "Y", "from": "2026-11-09 21:00:00"}
              ]
            }
          }
        }
      </script>
    `;
    mockHttp.request.mockResolvedValue({
      body: html,
      fetchedAt: new Date(),
      status: 200,
      etag: null,
      lastModified: null,
    });

    const result = await harvest(source, mockCtx);
    // No records pass city filter (city missing) => other city count
    expect(result.listings).toHaveLength(0);
    expect(result.notes?.[0]).toMatch(
      /2 events on the page; 0 in the window; 2 other city; 0 not dance; 0 outside the metro; 0 without a date; 0 listed/,
    );
  });

  it("throws when no records", async () => {
    const html = "<html>No data</html>";
    mockHttp.request.mockResolvedValue({
      body: html,
      fetchedAt: new Date(),
      status: 200,
      etag: null,
      lastModified: null,
    });

    await expect(harvest(source, mockCtx)).rejects.toThrow("buy.tidar.ma shows no event records");
  });

  it("time zone test: night before 6am", async () => {
    const html = `
      <script id="__NEXT_DATA__">
        {
          "props": {
            "pageProps": {
              "events": [
                {
                  "id": 999,
                  "name": "Late Night",
                  "city": "Marrakech",
                  "published": 1,
                  "from": "2026-11-08 23:30:00",
                  "to": "2026-11-09 04:00:00",
                  "category": {"slug": "electronique"},
                  "coordinates": "31.6258,-7.9892"
                },
                {
                  "id": 998,
                  "name": "Early Morning",
                  "city": "Marrakech",
                  "published": 1,
                  "from": "2026-11-09 02:00:00",
                  "category": {"slug": "electronique"},
                  "coordinates": "31.6258,-7.9892"
                }
              ]
            }
          }
        }
      </script>
    `;
    mockHttp.request.mockResolvedValue({
      body: html,
      fetchedAt: new Date(),
      status: 200,
      etag: null,
      lastModified: null,
    });

    const result = await harvest(source, mockCtx);
    // Both records are within window (2026-11-08 to 2026-11-21)
    expect(result.listings).toHaveLength(2);
    const late = result.listings.find((l) => l.listing.title === "Late Night");
    const early = result.listings.find((l) => l.listing.title === "Early Morning");
    expect(late?.listing.local_date).toBe("2026-11-08");
    expect(late?.listing.doors_time).toBe("23:30");
    expect(late?.listing.end_time).toBe("04:00");
    expect(early?.listing.local_date).toBe("2026-11-08");
    expect(early?.listing.doors_time).toBe("02:00");
  });

  it("lists a morning start with a span over 12 h untimed (D-794)", async () => {
    const rec = (id: number, name: string, from: string, to: string) => ({
      id,
      name,
      city: "Marrakech",
      published: 1,
      from,
      to,
      category: { slug: "electronique" },
      coordinates: "31.6258,-7.9892",
    });
    const events = [
      rec(901, "Placeholder Clock", "2026-11-13 06:00:00", "2026-11-14 14:00:00"),
      rec(902, "Real Day Party", "2026-11-14 11:00:00", "2026-11-14 20:00:00"),
      rec(903, "Long Night", "2026-11-14 22:00:00", "2026-11-15 14:00:00"),
    ];
    const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { events } } })}</script>`;
    mockHttp.request.mockResolvedValue({
      body: html,
      fetchedAt: new Date(),
      status: 200,
      etag: null,
      lastModified: null,
    });

    const result = await harvest(source, mockCtx);
    const by = (t: string) => result.listings.find((l) => l.listing.title === t)?.listing;
    expect(by("Placeholder Clock")?.local_date).toBe("2026-11-13");
    expect(by("Placeholder Clock")?.doors_time ?? null).toBeNull();
    expect(by("Real Day Party")?.doors_time).toBe("11:00");
    expect(by("Long Night")?.doors_time).toBe("22:00");
  });

  it("lists exactly the electronique events from fixture", async () => {
    mockHttp.request.mockResolvedValue({
      body: fixtureHtml,
      fetchedAt: new Date(),
      status: 200,
      etag: null,
      lastModified: null,
    });

    const result = await harvest(source, mockCtx);
    // Hand-checked against the fixture (2026-11-07): nights 11-07..11-20, electronique, inside the prefecture.
    // ECHO7000 (Villa Marco) and Back To House (Les Asnouss) are south of the outline; DREAMERS and BO9AL SHOW are
    // art-et-culture with no dance word; MARTEN LOU (11-06) and the October rows are past; Cartoon, Agoria and NYE are
    // after the window.
    expect(result.listings.map((l) => l.listing.title).sort()).toEqual([
      "FRQNCY OBSESSION",
      "MONTROUGE @ LEONE DISCOTECA",
      "Sol Sundays - Vol 3",
    ]);
    expect(result.notes?.[0]).toContain("2 outside the metro");
  });
});

describe("tidarAdapter registration", () => {
  it("has correct id and countries", () => {
    expect(tidarAdapter.id).toBe("tidar");
    expect(tidarAdapter.tier).toBe("A");
    expect(tidarAdapter.countries).toEqual(["MA"]);
  });
});
