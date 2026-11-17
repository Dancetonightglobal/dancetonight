import { describe, expect, it, vi, afterEach } from "vitest";
import { tulumMetroRow, TULUM_METRO, TULUM_METRO_ID } from "@/src/db/seed/tulum";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("tulum seed module (D-1080)", () => {
  it("returns the metro row", () => {
    const row = tulumMetroRow();
    expect(row.slug).toBe("tulum");
    expect(row.name).toBe("Tulum");
    expect(row.countryCode).toBe("MX");
    expect(row.tz).toBe("America/Cancun");
    expect(row.radiusKm).toBe(73);
    expect(row.center.lat).toBeCloseTo(20.3969);
    expect(row.center.lng).toBeCloseTo(-87.3144);
    expect(row.status).toBe("active");
    expect(row.id).toBe(TULUM_METRO_ID);
    expect(row.id).toBe(seedId("metro", "tulum"));
    // Spanish first, then English
    expect(row.languages).toEqual(["es", "en"]);
    expect(row.geonamesId).toBe(3515040);
    expect(row.population).toBe(380521);
    expect(row.adHoc).toBe(false);
    expect(TULUM_METRO.slug).toBe("tulum");
  });

  it("has its centre inside the Tulum and Solidaridad outline", () => {
    const row = tulumMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.tulum).toBe(tulumMetroRow);
  });
});

describe("seed runner with --metro tulum", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Tulum metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "tulum", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Tulum metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
