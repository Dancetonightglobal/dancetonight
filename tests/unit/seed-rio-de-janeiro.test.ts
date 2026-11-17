import { describe, expect, it, vi, afterEach } from "vitest";
import {
  rioDeJaneiroMetroRow,
  RIO_DE_JANEIRO_METRO,
  RIO_DE_JANEIRO_METRO_ID,
} from "@/src/db/seed/rio-de-janeiro";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("rio-de-janeiro seed module (D-420)", () => {
  it("returns the metro row", () => {
    const row = rioDeJaneiroMetroRow();
    expect(row.slug).toBe("rio-de-janeiro");
    expect(row.name).toBe("Rio de Janeiro");
    expect(row.countryCode).toBe("BR");
    expect(row.tz).toBe("America/Sao_Paulo");
    expect(row.radiusKm).toBe(65);
    expect(row.center.lat).toBeCloseTo(-22.9128);
    expect(row.center.lng).toBeCloseTo(-43.18);
    expect(row.status).toBe("active");
    expect(row.id).toBe(RIO_DE_JANEIRO_METRO_ID);
    expect(row.id).toBe(seedId("metro", "rio-de-janeiro"));
    // Portuguese first: no summaries until summarize.ts reads Portuguese (D-109).
    expect(row.languages).toEqual(["pt"]);
    expect(row.geonamesId).toBe(3451190);
    expect(row.population).toBe(6693172);
    expect(row.adHoc).toBe(false);
    expect(RIO_DE_JANEIRO_METRO.slug).toBe("rio-de-janeiro");
  });

  it("has its centre inside the outline", () => {
    const row = rioDeJaneiroMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS["rio-de-janeiro"]).toBe(rioDeJaneiroMetroRow);
  });
});

describe("seed runner with --metro rio-de-janeiro", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Rio de Janeiro metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "rio-de-janeiro", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Rio de Janeiro metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
