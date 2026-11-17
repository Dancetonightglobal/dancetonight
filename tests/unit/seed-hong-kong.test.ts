import { describe, expect, it, vi, afterEach } from "vitest";
import { hongKongMetroRow, HONG_KONG_METRO, HONG_KONG_METRO_ID } from "@/src/db/seed/hong-kong";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("hong-kong seed module (D-660)", () => {
  it("returns the metro row", () => {
    const row = hongKongMetroRow();
    expect(row.slug).toBe("hong-kong");
    expect(row.name).toBe("Hong Kong");
    expect(row.countryCode).toBe("HK");
    expect(row.tz).toBe("Asia/Hong_Kong");
    expect(row.radiusKm).toBe(45);
    expect(row.center.lat).toBeCloseTo(22.2819);
    expect(row.center.lng).toBeCloseTo(114.1581);
    expect(row.status).toBe("active");
    expect(row.id).toBe(HONG_KONG_METRO_ID);
    expect(row.id).toBe(seedId("metro", "hong-kong"));
    // English first, Chinese second
    expect(row.languages).toEqual(["en", "zh"]);
    expect(row.geonamesId).toBe(1819729);
    expect(row.population).toBe(7413070);
    expect(row.adHoc).toBe(false);
    expect(HONG_KONG_METRO.slug).toBe("hong-kong");
  });

  it("has its centre inside the Hong Kong SAR outline", () => {
    const row = hongKongMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS["hong-kong"]).toBe(hongKongMetroRow);
  });
});

describe("seed runner with --metro hong-kong", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Hong Kong metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "hong-kong", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Hong Kong metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
