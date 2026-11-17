import { describe, expect, it, vi, afterEach } from "vitest";
import { tokyoMetroRow, TOKYO_METRO, TOKYO_METRO_ID } from "@/src/db/seed/tokyo";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("tokyo seed module (D-1221)", () => {
  it("returns the metro row", () => {
    const row = tokyoMetroRow();
    expect(row.slug).toBe("tokyo");
    expect(row.name).toBe("Tokyo");
    expect(row.countryCode).toBe("JP");
    expect(row.tz).toBe("Asia/Tokyo");
    expect(row.radiusKm).toBe(75);
    expect(row.center.lat).toBeCloseTo(35.6812);
    expect(row.center.lng).toBeCloseTo(139.7671);
    expect(row.status).toBe("active");
    expect(row.id).toBe(TOKYO_METRO_ID);
    expect(row.id).toBe(seedId("metro", "tokyo"));
    // Japanese first, English second (D-1221)
    expect(row.languages).toEqual(["ja", "en"]);
    expect(row.geonamesId).toBe(1850147);
    expect(row.population).toBe(14100000);
    expect(row.adHoc).toBe(false);
    expect(TOKYO_METRO.slug).toBe("tokyo");
  });

  it("has its centre (Tokyo Station) inside the outline", () => {
    const row = tokyoMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.tokyo).toBe(tokyoMetroRow);
  });
});

describe("seed runner with --metro tokyo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Tokyo metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "tokyo", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Tokyo metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
