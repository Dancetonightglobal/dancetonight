import { describe, expect, it, vi, afterEach } from "vitest";
import { marrakeshMetroRow, MARRAKESH_METRO, MARRAKESH_METRO_ID } from "@/src/db/seed/marrakesh";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("marrakesh seed module (D-1100)", () => {
  it("returns the metro row", () => {
    const row = marrakeshMetroRow();
    expect(row.slug).toBe("marrakesh");
    expect(row.name).toBe("Marrakesh");
    expect(row.countryCode).toBe("MA");
    expect(row.tz).toBe("Africa/Casablanca");
    expect(row.radiusKm).toBe(60);
    expect(row.center.lat).toBeCloseTo(31.6258);
    expect(row.center.lng).toBeCloseTo(-7.9892);
    expect(row.status).toBe("active");
    expect(row.id).toBe(MARRAKESH_METRO_ID);
    expect(row.id).toBe(seedId("metro", "marrakesh"));
    // English first so cards get "In short" summaries; French and Arabic after (the owner, 2026-11-07, D-1100).
    expect(row.languages).toEqual(["en", "fr", "ar"]);
    expect(row.geonamesId).toBe(2542997);
    expect(row.population).toBe(1560103);
    expect(row.adHoc).toBe(false);
    expect(MARRAKESH_METRO.slug).toBe("marrakesh");
  });

  it("has its centre (Jemaa el-Fnaa) inside the outline", () => {
    const row = marrakeshMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.marrakesh).toBe(marrakeshMetroRow);
  });
});

describe("seed runner with --metro marrakesh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Marrakesh metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "marrakesh", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Marrakesh metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
