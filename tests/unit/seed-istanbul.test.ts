import { describe, expect, it, vi, afterEach } from "vitest";
import { istanbulMetroRow, ISTANBUL_METRO, ISTANBUL_METRO_ID } from "@/src/db/seed/istanbul";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("istanbul seed module (D-680)", () => {
  it("returns the metro row", () => {
    const row = istanbulMetroRow();
    expect(row.slug).toBe("istanbul");
    expect(row.name).toBe("Istanbul");
    expect(row.countryCode).toBe("TR");
    expect(row.tz).toBe("Europe/Istanbul");
    expect(row.radiusKm).toBe(100);
    expect(row.center.lat).toBeCloseTo(41.0369);
    expect(row.center.lng).toBeCloseTo(28.985);
    expect(row.status).toBe("active");
    expect(row.id).toBe(ISTANBUL_METRO_ID);
    expect(row.id).toBe(seedId("metro", "istanbul"));
    // Turkish first: no "In short" summaries until the summary check reads Turkish (D-680).
    expect(row.languages).toEqual(["tr", "en"]);
    expect(row.geonamesId).toBe(745044);
    expect(row.population).toBe(15701602);
    expect(row.adHoc).toBe(false);
    expect(ISTANBUL_METRO.slug).toBe("istanbul");
  });

  it("has its centre inside the Istanbul province outline", () => {
    const row = istanbulMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.istanbul).toBe(istanbulMetroRow);
  });
});

describe("seed runner with --metro istanbul", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Istanbul metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "istanbul", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Istanbul metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
