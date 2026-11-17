import { describe, expect, it, vi, afterEach } from "vitest";
import { dubaiMetroRow, DUBAI_METRO, DUBAI_METRO_ID } from "@/src/db/seed/dubai";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("dubai seed module (D-1060)", () => {
  it("returns the metro row", () => {
    const row = dubaiMetroRow();
    expect(row.slug).toBe("dubai");
    expect(row.name).toBe("Dubai");
    expect(row.countryCode).toBe("AE");
    expect(row.tz).toBe("Asia/Dubai");
    expect(row.radiusKm).toBe(105);
    expect(row.center.lat).toBeCloseTo(25.1972);
    expect(row.center.lng).toBeCloseTo(55.2744);
    expect(row.status).toBe("active");
    expect(row.id).toBe(DUBAI_METRO_ID);
    expect(row.id).toBe(seedId("metro", "dubai"));
    // English first, then Arabic
    expect(row.languages).toEqual(["en", "ar"]);
    expect(row.geonamesId).toBe(292223);
    expect(row.population).toBe(4580300);
    expect(row.adHoc).toBe(false);
    expect(DUBAI_METRO.slug).toBe("dubai");
  });

  it("has its centre inside the Dubai emirate outline", () => {
    const row = dubaiMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.dubai).toBe(dubaiMetroRow);
  });
});

describe("seed runner with --metro dubai", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Dubai metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "dubai", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Dubai metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
