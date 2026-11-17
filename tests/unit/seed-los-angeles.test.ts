import { describe, expect, it, vi, afterEach } from "vitest";
import {
  losAngelesMetroRow,
  LOS_ANGELES_METRO,
  LOS_ANGELES_METRO_ID,
} from "@/src/db/seed/los-angeles";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("los-angeles seed module (D-1160)", () => {
  it("returns the metro row", () => {
    const row = losAngelesMetroRow();
    expect(row.slug).toBe("los-angeles");
    expect(row.name).toBe("Los Angeles");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/Los_Angeles");
    expect(row.radiusKm).toBe(105);
    expect(row.center.lat).toBeCloseTo(34.0537);
    expect(row.center.lng).toBeCloseTo(-118.2427);
    expect(row.status).toBe("active");
    expect(row.id).toBe(LOS_ANGELES_METRO_ID);
    expect(row.id).toBe(seedId("metro", "los-angeles"));
    // English first, so summaries are still written (D-109); Spanish for the Latin scene's style and weekly words.
    expect(row.languages).toEqual(["en", "es"]);
    expect(row.geonamesId).toBe(5368361);
    expect(row.population).toBe(9757179);
    expect(row.adHoc).toBe(false);
    expect(LOS_ANGELES_METRO.slug).toBe("los-angeles");
  });

  it("has its centre inside the Los Angeles County outline", () => {
    const row = losAngelesMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS["los-angeles"]).toBe(losAngelesMetroRow);
  });
});

describe("seed runner with --metro los-angeles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Los Angeles metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "los-angeles", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Los Angeles metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
