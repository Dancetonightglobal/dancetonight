import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buenosAiresMetroRow,
  BUENOS_AIRES_METRO,
  BUENOS_AIRES_METRO_ID,
} from "@/src/db/seed/buenos-aires";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("buenos-aires seed module (D-400)", () => {
  it("returns the metro row", () => {
    const row = buenosAiresMetroRow();
    expect(row.slug).toBe("buenos-aires");
    expect(row.name).toBe("Buenos Aires");
    expect(row.countryCode).toBe("AR");
    expect(row.tz).toBe("America/Argentina/Buenos_Aires");
    expect(row.radiusKm).toBe(25);
    expect(row.center.lat).toBeCloseTo(-34.6037);
    expect(row.center.lng).toBeCloseTo(-58.3816);
    expect(row.status).toBe("active");
    expect(row.id).toBe(BUENOS_AIRES_METRO_ID);
    expect(row.id).toBe(seedId("metro", "buenos-aires"));
    // Spanish first, English second (D-400)
    expect(row.languages).toEqual(["es", "en"]);
    expect(row.geonamesId).toBe(3435910);
    expect(row.population).toBe(3121707);
    expect(row.adHoc).toBe(false);
    expect(BUENOS_AIRES_METRO.slug).toBe("buenos-aires");
  });

  it("has its centre inside the Buenos Aires outline", () => {
    const row = buenosAiresMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS["buenos-aires"]).toBe(buenosAiresMetroRow);
  });
});

describe("seed runner with --metro buenos-aires", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Buenos Aires metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "buenos-aires", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Buenos Aires metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
