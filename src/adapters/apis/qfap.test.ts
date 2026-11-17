import { describe, it, expect, vi } from "vitest";
import { qfapAdapter, qfapQueryUrl, parseQfapOccurrences, qfapToListings } from "./qfap";
import type { Metro, NightDate, RunCtx } from "@/src/adapters/types";
import fixture from "./__fixtures__/qfap/records-2026-11-06.json";
import { addCalendarDays } from "@/src/domain/time";

const PARIS_METRO: Metro = {
  id: "paris",
  slug: "paris",
  name: "Paris",
  countryCode: "FR",
  center: { lat: 48.8566, lng: 2.3522 },
  radiusKm: 15,
  tz: "Europe/Paris",
  languages: ["fr"],
};

const NON_PARIS_METRO: Metro = {
  id: "london",
  slug: "london",
  name: "London",
  countryCode: "GB",
  center: { lat: 51.5074, lng: -0.1278 },
  radiusKm: 15,
  tz: "Europe/London",
  languages: ["en"],
};

describe("parseQfapOccurrences", () => {
  it("parses single occurrence with overnight end", () => {
    const result = parseQfapOccurrences("2026-11-14T23:55:00+02:00_2026-11-14T06:00:00+02:00");
    expect(result).toEqual([
      {
        date: "2026-11-14",
        time: "23:55",
        endDate: "2026-11-15",
        endTime: "06:00",
      },
    ]);
  });

  it("parses occurrence where end is earlier on same date", () => {
    const result = parseQfapOccurrences("2026-11-24T20:00:00+02:00_2026-11-24T00:30:00+02:00");
    expect(result).toEqual([
      {
        date: "2026-11-24",
        time: "20:00",
        endDate: "2026-11-25",
        endTime: "00:30",
      },
    ]);
  });

  it("parses multiple parts separated by ;", () => {
    const result = parseQfapOccurrences(
      "2026-11-14T23:55:00+02:00_2026-11-14T06:00:00+02:00;2026-11-15T20:00:00+02:00_2026-11-15T22:00:00+02:00",
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.date).toBe("2026-11-14");
    expect(result[1]!.date).toBe("2026-11-15");
  });

  it("returns empty array for empty, null, or garbage", () => {
    expect(parseQfapOccurrences("")).toEqual([]);
    expect(parseQfapOccurrences(null)).toEqual([]);
    expect(parseQfapOccurrences("garbage")).toEqual([]);
  });
});

describe("qfapQueryUrl", () => {
  it("builds URL with offset and where clause", () => {
    const url = qfapQueryUrl("2026-11-06", 100);
    expect(url).toContain("offset=100");
    expect(url).toContain("limit=100");
    const parsed = new URL(url);
    const where = parsed.searchParams.get("where");
    expect(where).toBe(
      '(qfap_tags like "Nuit" or qfap_tags like "Danse") and date_end >= "2026-11-06"',
    );
  });
});

describe("qfapToListings", () => {
  const nights: NightDate[] = [];
  for (let i = 0; i < 14; i++) {
    nights.push(addCalendarDays("2026-11-06", i) as NightDate);
  }

  it("returns correct listings for fixture nights", () => {
    const result = qfapToListings(fixture.results, {
      metro: PARIS_METRO,
      nights,
      fetchedAt: new Date(),
    });

    // Expected kept listings:
    // - Sans Logiques (2026-11-14)
    // - Dancing With Myself (2026-11-07)
    // - Grande Nuit Rétro zouk et konpa (2026-11-10)
    // - Montreuil is Tropical (2026-11-06)
    // - Loto du Vendredi 13 (2026-11-13)
    // - Cours de salsa et salsa party (2026-11-12, 2026-11-19)
    // That's 6 distinct events, but salsa party has 2 occurrences => total listings = 1+1+1+1+1+2 = 7
    expect(result.listings).toHaveLength(7);

    const sansLogique = result.listings.find((l) => l.listing.title.includes("Sans Logiques"));
    expect(sansLogique).toBeDefined();
    expect(sansLogique!.listing.local_date).toBe("2026-11-14");
    expect(sansLogique!.listing.doors_time).toBe("23:55");
    expect(sansLogique!.listing.cancelled).toBeFalsy();
    expect(sansLogique!.eventUrl).toMatch(/^https:\/\/www\.paris\.fr\//);

    const salsaParty = result.listings.filter((l) => l.listing.title.includes("Cours de salsa"));
    expect(salsaParty).toHaveLength(2);
    const salsaIds = salsaParty.map((l) => l.externalId);
    expect(salsaIds).toContain("109618:2026-11-12");
    expect(salsaIds).toContain("109618:2026-11-19");

    // No listing for "Mordre", "Urban Underground", "ANNULÉ Apprendre", "Une nuit à la Belle Époque", "Le Badaboum devient"
    const excludedTitles = [
      "Mordre",
      "Urban Underground",
      "ANNULÉ Apprendre",
      "Une nuit à la Belle Époque",
      "Le Badaboum devient",
    ];
    for (const title of excludedTitles) {
      const found = result.listings.find((l) => l.listing.title.includes(title));
      expect(found).toBeUndefined();
    }

    // Every listing has venue location
    for (const listing of result.listings) {
      expect(listing.venueLocation).toBeDefined();
      expect(listing.venueLocation).not.toBeNull();
    }

    // Note about skipped records without occurrences
    expect(result.notes.some((n) => n.includes("kept record(s) without dated occurrences"))).toBe(
      true,
    );
  });

  it("returns listings for nights 2026-11-20 to 2026-11-25", () => {
    const laterNights: NightDate[] = [];
    for (let i = 20; i <= 25; i++) {
      laterNights.push(`2026-11-${i.toString().padStart(2, "0")}` as NightDate);
    }
    const result = qfapToListings(fixture.results, {
      metro: PARIS_METRO,
      nights: laterNights,
      fetchedAt: new Date(),
    });

    // Should include "BIG PRIDE ENERGY BALL" (2026-11-21) and "Rock 4 Temps" (2026-11-24)
    expect(result.listings).toHaveLength(2);
    const pride = result.listings.find((l) => l.listing.title.includes("BIG PRIDE"));
    expect(pride).toBeDefined();
    expect(pride!.listing.local_date).toBe("2026-11-21");
    expect(pride!.listing.doors_time).toBe("16:00");

    const rock = result.listings.find((l) => l.listing.title.includes("Rock 4 Temps"));
    expect(rock).toBeDefined();
    expect(rock!.listing.local_date).toBe("2026-11-24");
    expect(rock!.listing.doors_time).toBe("20:00");
    // End time should be kept because 00:30 is same night
    expect(rock!.listing.end_time).toBe("00:30");
  });

  it("marks cancelled titles", () => {
    const cancelledRecord = {
      ...fixture.results[0],
      title: "ANNULÉ Soirée salsa",
    };
    const result = qfapToListings([cancelledRecord], {
      metro: PARIS_METRO,
      nights: ["2026-11-14" as NightDate],
      fetchedAt: new Date(),
    });
    expect(result.listings[0]!.listing.cancelled).toBe(true);
  });
});

describe("qfapAdapter", () => {
  it("returns empty result for non-Paris metro", async () => {
    const ctx = {
      metro: NON_PARIS_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn(),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    const result = await qfapAdapter.harvestMetro!(NON_PARIS_METRO, ["2026-11-07"], ctx);

    expect(result.listings).toHaveLength(0);
    expect(result.notes).toEqual([]);
    expect(ctx.http.request).not.toHaveBeenCalled();
  });

  it("returns listings for Paris metro with fixture", async () => {
    const ctx = {
      metro: PARIS_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockResolvedValue({
          status: 200,
          body: JSON.stringify(fixture),
          fetchedAt: new Date(),
        }),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    const nights: NightDate[] = [];
    for (let i = 0; i < 14; i++) {
      nights.push(addCalendarDays("2026-11-06", i) as NightDate);
    }

    const result = await qfapAdapter.harvestMetro!(PARIS_METRO, nights, ctx);
    // Should have same number as qfapToListings test (7 listings)
    expect(result.listings).toHaveLength(7);
    expect(result.notes).toBeDefined();
    expect(result.doc).toBeDefined();
    expect(ctx.http.request).toHaveBeenCalledTimes(1); // 13 results < 100
  });

  it("throws on download failure", async () => {
    const ctx = {
      metro: PARIS_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockRejectedValue(new Error("Network error")),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(qfapAdapter.harvestMetro!(PARIS_METRO, ["2026-11-07"], ctx)).rejects.toThrow(
      /^qfap: download failed/,
    );
  });

  it("throws on non-2xx response", async () => {
    const ctx = {
      metro: PARIS_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockResolvedValue({
          status: 403,
          body: "Forbidden",
          fetchedAt: new Date(),
        }),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(qfapAdapter.harvestMetro!(PARIS_METRO, ["2026-11-07"], ctx)).rejects.toThrow(
      /download failed \(HTTP 403\)/,
    );
  });

  it("throws on unexpected body", async () => {
    const ctx = {
      metro: PARIS_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockResolvedValue({
          status: 200,
          body: "invalid json",
          fetchedAt: new Date(),
        }),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(qfapAdapter.harvestMetro!(PARIS_METRO, ["2026-11-07"], ctx)).rejects.toThrow(
      "qfap: unexpected body",
    );
  });

  it("throws on body without results array", async () => {
    const ctx = {
      metro: PARIS_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockResolvedValue({
          status: 200,
          body: JSON.stringify({ error: true }),
          fetchedAt: new Date(),
        }),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(qfapAdapter.harvestMetro!(PARIS_METRO, ["2026-11-07"], ctx)).rejects.toThrow(
      "qfap: unexpected body",
    );
  });
});

describe("qfap winter offsets", () => {
  // The dataset writes +02:00 all year; its own date_description shows the wall clock is Paris local time
  // (checked 2026-11-06 on a November and a December record).
  it("reads the wall clock of a winter occurrence, not the offset", () => {
    const records = fixture.results as Array<Record<string, unknown>>;
    const night = records.find((r) => r.id === "126728");
    const december = records.find((r) => r.id === "123541");
    expect(String(night?.date_description)).toContain("de 23h55 à 06h00");
    expect(parseQfapOccurrences(night?.occurrences)[0]).toMatchObject({
      date: "2026-11-14",
      time: "23:55",
    });
    expect(String(december?.date_description)).toContain("de 20h00 à 21h00");
    expect(parseQfapOccurrences(december?.occurrences)[0]).toMatchObject({
      date: "2026-12-11",
      time: "20:00",
    });
  });
});
