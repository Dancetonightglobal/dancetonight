import { describe, expect, it, vi, afterEach } from "vitest";
import { miamiMetroRow, MIAMI_METRO, MIAMI_METRO_ID } from "@/src/db/seed/miami";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("miami seed module (D-320)", () => {
  it("returns the metro row", () => {
    const row = miamiMetroRow();
    expect(row.slug).toBe("miami");
    expect(row.name).toBe("Miami");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/New_York");
    expect(row.radiusKm).toBe(60);
    expect(row.center.lat).toBeCloseTo(25.7797);
    expect(row.center.lng).toBeCloseTo(-80.1897);
    expect(row.status).toBe("active");
    expect(row.id).toBe(MIAMI_METRO_ID);
    expect(row.id).toBe(seedId("metro", "miami"));
    // English first, so summaries are still written (D-109); Spanish for the style and weekly-rule words.
    expect(row.languages).toEqual(["en", "es"]);
    expect(row.geonamesId).toBe(4164138);
    expect(row.population).toBe(2838461);
    expect(row.adHoc).toBe(false);
    expect(MIAMI_METRO.slug).toBe("miami");
  });

  it("has its centre inside the Miami-Dade outline", () => {
    const row = miamiMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.miami).toBe(miamiMetroRow);
  });
});

describe("seed runner with --metro miami", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Miami metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "miami", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Miami metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
