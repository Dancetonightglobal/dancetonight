import { describe, expect, it, vi, afterEach } from "vitest";
import { berlinMetroRow, BERLIN_METRO, BERLIN_METRO_ID } from "@/src/db/seed/berlin";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("berlin seed module (D-1020)", () => {
  it("returns the metro row", () => {
    const row = berlinMetroRow();
    expect(row.slug).toBe("berlin");
    expect(row.name).toBe("Berlin");
    expect(row.countryCode).toBe("DE");
    expect(row.tz).toBe("Europe/Berlin");
    expect(row.radiusKm).toBe(35);
    expect(row.center.lat).toBeCloseTo(52.5163);
    expect(row.center.lng).toBeCloseTo(13.3777);
    expect(row.status).toBe("active");
    expect(row.id).toBe(BERLIN_METRO_ID);
    expect(row.id).toBe(seedId("metro", "berlin"));
    // German first: no "In short" summaries until the summary check reads German (D-1020).
    expect(row.languages).toEqual(["de", "en"]);
    expect(row.geonamesId).toBe(2950159);
    expect(row.population).toBe(3897145);
    expect(row.adHoc).toBe(false);
    expect(BERLIN_METRO.slug).toBe("berlin");
  });

  it("has its centre inside the Land Berlin outline", () => {
    const row = berlinMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.berlin).toBe(berlinMetroRow);
  });
});

describe("seed runner with --metro berlin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Berlin metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "berlin", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Berlin metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
