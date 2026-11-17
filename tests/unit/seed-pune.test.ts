import { describe, expect, it, vi, afterEach } from "vitest";
import { puneMetroRow, PUNE_METRO, PUNE_METRO_ID } from "@/src/db/seed/pune";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("pune seed module (D-1120)", () => {
  it("returns the metro row", () => {
    const row = puneMetroRow();
    expect(row.slug).toBe("pune");
    expect(row.name).toBe("Pune");
    expect(row.countryCode).toBe("IN");
    expect(row.tz).toBe("Asia/Kolkata");
    expect(row.radiusKm).toBe(25);
    expect(row.center.lat).toBeCloseTo(18.5196);
    expect(row.center.lng).toBeCloseTo(73.8553);
    expect(row.status).toBe("active");
    expect(row.id).toBe(PUNE_METRO_ID);
    expect(row.id).toBe(seedId("metro", "pune"));
    // English first, then Marathi and Hindi
    expect(row.languages).toEqual(["en", "mr", "hi"]);
    expect(row.geonamesId).toBe(1259229);
    expect(row.population).toBe(4852150);
    expect(row.adHoc).toBe(false);
    expect(PUNE_METRO.slug).toBe("pune");
  });

  it("has its centre inside the Pune outline", () => {
    const row = puneMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.pune).toBe(puneMetroRow);
  });
});

describe("seed runner with --metro pune", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Pune metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "pune", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Pune metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
