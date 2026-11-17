import { describe, expect, it, vi, afterEach } from "vitest";
import {
  mexicoCityMetroRow,
  MEXICO_CITY_METRO,
  MEXICO_CITY_METRO_ID,
} from "@/src/db/seed/mexico-city";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("mexico-city seed module (D-440)", () => {
  it("returns the metro row", () => {
    const row = mexicoCityMetroRow();
    expect(row.slug).toBe("mexico-city");
    expect(row.name).toBe("Mexico City");
    expect(row.countryCode).toBe("MX");
    expect(row.tz).toBe("America/Mexico_City");
    expect(row.radiusKm).toBe(45);
    expect(row.center.lat).toBeCloseTo(19.4326);
    expect(row.center.lng).toBeCloseTo(-99.1332);
    expect(row.status).toBe("active");
    expect(row.id).toBe(MEXICO_CITY_METRO_ID);
    expect(row.id).toBe(seedId("metro", "mexico-city"));
    // Spanish first, so summaries are still written (D-109); English for the style and weekly-rule words.
    expect(row.languages).toEqual(["es", "en"]);
    expect(row.geonamesId).toBe(3530597);
    expect(row.population).toBe(9209944);
    expect(row.adHoc).toBe(false);
    expect(MEXICO_CITY_METRO.slug).toBe("mexico-city");
  });

  it("has its centre inside the Ciudad de México outline", () => {
    const row = mexicoCityMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS["mexico-city"]).toBe(mexicoCityMetroRow);
  });
});

describe("seed runner with --metro mexico-city", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Mexico City metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "mexico-city", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Mexico City metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
