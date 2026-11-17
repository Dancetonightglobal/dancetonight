import { describe, expect, it, vi, afterEach } from "vitest";
import { lisbonMetroRow, LISBON_METRO, LISBON_METRO_ID } from "@/src/db/seed/lisbon";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("lisbon seed module (D-380)", () => {
  it("returns the metro row", () => {
    const row = lisbonMetroRow();
    expect(row.slug).toBe("lisbon");
    expect(row.name).toBe("Lisbon");
    expect(row.countryCode).toBe("PT");
    expect(row.tz).toBe("Europe/Lisbon");
    expect(row.radiusKm).toBe(60);
    expect(row.center.lat).toBeCloseTo(38.7076);
    expect(row.center.lng).toBeCloseTo(-9.1365);
    expect(row.status).toBe("active");
    expect(row.id).toBe(LISBON_METRO_ID);
    expect(row.id).toBe(seedId("metro", "lisbon"));
    // Portuguese first: no "In short" summaries until the summary check reads Portuguese (D-109, D-380).
    expect(row.languages).toEqual(["pt", "en"]);
    expect(row.geonamesId).toBe(2267057);
    expect(row.population).toBe(2870208);
    expect(row.adHoc).toBe(false);
    expect(LISBON_METRO.slug).toBe("lisbon");
  });

  it("has its centre inside the Lisbon Metropolitan Area outline", () => {
    const row = lisbonMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.lisbon).toBe(lisbonMetroRow);
  });
});

describe("seed runner with --metro lisbon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Lisbon metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "lisbon", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Lisbon metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
