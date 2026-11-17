import { describe, expect, it, vi, afterEach } from "vitest";
import { barcelonaMetroRow, BARCELONA_METRO, BARCELONA_METRO_ID } from "@/src/db/seed/barcelona";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("barcelona seed module (D-360)", () => {
  it("returns the metro row", () => {
    const row = barcelonaMetroRow();
    expect(row.slug).toBe("barcelona");
    expect(row.name).toBe("Barcelona");
    expect(row.countryCode).toBe("ES");
    expect(row.tz).toBe("Europe/Madrid");
    expect(row.radiusKm).toBe(15);
    expect(row.center.lat).toBeCloseTo(41.387);
    expect(row.center.lng).toBeCloseTo(2.17);
    expect(row.status).toBe("active");
    expect(row.id).toBe(BARCELONA_METRO_ID);
    expect(row.id).toBe(seedId("metro", "barcelona"));
    // Catalan and Spanish first: no English summaries until the check reads them (D-109, owner's 8A).
    expect(row.languages).toEqual(["ca", "es", "en"]);
    expect(row.geonamesId).toBe(3128760);
    expect(row.population).toBe(2398280);
    expect(row.adHoc).toBe(false);
    expect(BARCELONA_METRO.slug).toBe("barcelona");
  });

  it("has its centre inside the Barcelonès outline", () => {
    const row = barcelonaMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.barcelona).toBe(barcelonaMetroRow);
  });
});

describe("seed runner with --metro barcelona", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Barcelona metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "barcelona", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Barcelona metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
