import { describe, expect, it, vi, afterEach } from "vitest";
import { medellinMetroRow, MEDELLIN_METRO, MEDELLIN_METRO_ID } from "@/src/db/seed/medellin";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("medellin seed module (D-640)", () => {
  it("returns the metro row", () => {
    const row = medellinMetroRow();
    expect(row.slug).toBe("medellin");
    expect(row.name).toBe("Medellín");
    expect(row.countryCode).toBe("CO");
    expect(row.tz).toBe("America/Bogota");
    expect(row.radiusKm).toBe(40);
    expect(row.center.lat).toBeCloseTo(6.2502);
    expect(row.center.lng).toBeCloseTo(-75.5688);
    expect(row.status).toBe("active");
    expect(row.id).toBe(MEDELLIN_METRO_ID);
    expect(row.id).toBe(seedId("metro", "medellin"));
    // Spanish first, so summaries are still written (D-109); English for the style and weekly-rule words.
    expect(row.languages).toEqual(["es", "en"]);
    expect(row.geonamesId).toBe(3674962);
    expect(row.population).toBe(4194012);
    expect(row.adHoc).toBe(false);
    expect(MEDELLIN_METRO.slug).toBe("medellin");
  });

  it("has its centre inside the Medellín outline", () => {
    const row = medellinMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS["medellin"]).toBe(medellinMetroRow);
  });
});

describe("seed runner with --metro medellin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Medellín metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "medellin", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Medellín metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
