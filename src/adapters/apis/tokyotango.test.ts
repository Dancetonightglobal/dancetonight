import { describe, it, expect, vi, type Mock } from "vitest";
import { tokyoTangoAdapter, parseCsv, yearFor } from "./tokyotango";
import type { Metro, RunCtx } from "@/src/adapters/types";
import { readFileSync } from "fs";
import { join } from "path";

describe("tokyotango adapter", () => {
  const metro: Metro = {
    id: "tokyo",
    name: "Tokyo",
    languages: ["ja", "en"],
    slug: "tokyo",
    tz: "Asia/Tokyo",
    center: { lat: 35.6762, lng: 139.6503 },
    radiusKm: 50,
    countryCode: "JP",
  };

  const nights = [
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
  ];

  const fixtureCsv = readFileSync(join(__dirname, "__fixtures__", "tokyotango-month.csv"), "utf-8");

  function mockCtx(responses: Array<{ status: number; body: string }>): RunCtx {
    const http = {
      request: vi.fn(),
    };
    responses.forEach((response) => {
      (http.request as Mock).mockResolvedValueOnce({
        status: response.status,
        body: response.body,
        fetchedAt: new Date(),
      });
    });
    return { http } as unknown as RunCtx;
  }

  it("extracts Tokyo events within nights", async () => {
    const ctx = mockCtx([
      { status: 200, body: fixtureCsv },
      { status: 200, body: fixtureCsv },
    ]);

    const result = await tokyoTangoAdapter.harvestMetro!(metro, nights, ctx);

    // Count events in Tokyo metro within 11/07-11/20
    // From fixture: 15 events should pass (all except AsakaでTango)
    expect(result.listings).toHaveLength(15);
    expect((result.notes ?? []).some((n) => n.includes("tokyotango:"))).toBe(true);

    // All listings should have a start time (check various possible fields)
    for (const listing of result.listings) {
      const hasTime =
        listing.listing.doors_time !== undefined || listing.listing.dancing_time !== undefined;
      expect(hasTime).toBe(true);
    }

    // Check TANGÓPOLIS JAPAN MILONGA
    const tangopolis = result.listings.find((l) => l.listing.title === "TANGÓPOLIS JAPAN MILONGA");
    expect(tangopolis).toBeDefined();
    expect(tangopolis?.listing.listing_type).toBe("social");
    expect(tangopolis?.listing.styles).toEqual(["tango"]);
    expect(tangopolis?.listing.doors_time).toBe("19:00");
    expect(tangopolis?.listing.venue.name).toBe("アルゼンチンタンゴ協会");
    expect(tangopolis?.listing.venue.address).toBe("東京都中央区銀座7-14-7 共栄銀座7丁目ビル3階");
    // Check start time is present
    const tangopolisHasTime =
      tangopolis?.listing.doors_time !== undefined ||
      tangopolis?.listing.dancing_time !== undefined;
    expect(tangopolisHasTime).toBe(true);

    // Check TTCプラクティカ is practica
    const ttc = result.listings.find((l) => l.listing.title === "TTCプラクティカ");
    expect(ttc).toBeDefined();
    expect(ttc?.listing.listing_type).toBe("practica");
    const ttcHasTime =
      ttc?.listing.doors_time !== undefined || ttc?.listing.dancing_time !== undefined;
    expect(ttcHasTime).toBe(true);

    // Check Zitaプラクティカ is practica
    const zita = result.listings.find((l) => l.listing.title === "Zitaプラクティカ");
    expect(zita).toBeDefined();
    expect(zita?.listing.listing_type).toBe("practica");
    const zitaHasTime =
      zita?.listing.doors_time !== undefined || zita?.listing.dancing_time !== undefined;
    expect(zitaHasTime).toBe(true);

    // Check duplicate dates are separate listings
    const ttcListings = result.listings.filter((l) => l.listing.title === "TTCプラクティカ");
    expect(ttcListings).toHaveLength(2); // 11/07 and 11/14
  });

  it("skips events outside Tokyo metro", async () => {
    // Include 12/20 in nights
    const nightsWithDec = [...nights, "2026-12-20"];
    const ctx = mockCtx([
      { status: 200, body: fixtureCsv },
      { status: 200, body: fixtureCsv },
    ]);

    const result = await tokyoTangoAdapter.harvestMetro!(metro, nightsWithDec, ctx);

    // AsakaでTango should be skipped (place contains 朝霞市)
    const asaka = result.listings.find((l) => l.listing.title === "AsakaでTango");
    expect(asaka).toBeUndefined();
    expect((result.notes ?? []).some((n) => n.includes("outside Tokyo metro"))).toBe(true);
  });

  it("keeps events with performer bio containing outside words but Tokyo address", async () => {
    // Milonga OTTO has "埼玉県出身" in performer bio but Tokyo address
    const ctx = mockCtx([
      { status: 200, body: fixtureCsv },
      { status: 200, body: fixtureCsv },
    ]);

    const result = await tokyoTangoAdapter.harvestMetro!(metro, nights, ctx);

    // Should have 15 listings (including OTTO)
    expect(result.listings).toHaveLength(15);

    // OTTO should be present
    const otto = result.listings.find((l) => l.listing.title.includes("Milonga OTTO"));
    expect(otto).toBeDefined();
  });

  it("returns empty for non-Tokyo metro", async () => {
    const londonMetro: Metro = {
      ...metro,
      slug: "london",
    };
    const ctx = mockCtx([]);
    const result = await tokyoTangoAdapter.harvestMetro!(londonMetro, nights, ctx);
    expect(result.listings).toHaveLength(0);
    expect(result.notes).toHaveLength(0);
    expect(result.screened).toHaveLength(0);
  });

  it("throws when both tabs fail", async () => {
    const ctx = mockCtx([
      { status: 500, body: "" },
      { status: 500, body: "" },
    ]);
    await expect(tokyoTangoAdapter.harvestMetro!(metro, nights, ctx)).rejects.toThrow(
      "tokyotango: download failed",
    );
  });

  it("continues when one tab fails", async () => {
    const ctx = mockCtx([
      { status: 200, body: fixtureCsv },
      { status: 500, body: "" },
    ]);
    const result = await tokyoTangoAdapter.harvestMetro!(metro, nights, ctx);
    expect(result.listings.length).toBeGreaterThan(0);
    expect((result.notes ?? []).some((n) => n.includes("tab") && n.includes("failed"))).toBe(true);
  });

  it("parseCsv handles RFC 4180", () => {
    const csv = `"a","b","c"\n"d","e","f"`;
    const result = parseCsv(csv);
    expect(result).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);

    // Quoted field with comma
    const csv2 = `"a","b,c","d"`;
    const result2 = parseCsv(csv2);
    expect(result2).toEqual([["a", "b,c", "d"]]);

    // Doubled quote
    const csv3 = `"a","b""c","d"`;
    const result3 = parseCsv(csv3);
    expect(result3).toEqual([["a", 'b"c', "d"]]);

    // Newline in quoted field
    const csv4 = `"a","b\nc","d"`;
    const result4 = parseCsv(csv4);
    expect(result4).toEqual([["a", "b\nc", "d"]]);
  });

  it("yearFor works as specified", () => {
    // Example 1: "12/30" with firstNight "2027-01-02" -> "2026-12-30"
    expect(yearFor("12/30", "2027-01-02")).toBe("2026-12-30");

    // Example 2: "01/02" with firstNight "2026-12-28" -> "2027-01-02"
    expect(yearFor("01/02", "2026-12-28")).toBe("2027-01-02");

    // Edge case: same year
    expect(yearFor("11/07", "2026-11-01")).toBe("2026-11-07");
  });

  it("deduplicates identical rows from both tabs", async () => {
    // Create CSV with same event
    const header = "タイムスタンプ,イベント,日付,,時間,場所,Maps,情報\n";
    const row = `2026/10/12 11:33:37,TANGÓPOLIS JAPAN MILONGA,11/07,土曜,19:00,アルゼンチンタンゴ協会,https://maps.app.goo.gl/5ZqmyNpFTfE1YaSz5,"test"`;
    const csv = header + row;

    const ctx = mockCtx([
      { status: 200, body: csv },
      { status: 200, body: csv },
    ]);

    const result = await tokyoTangoAdapter.harvestMetro!(metro, ["2026-11-07"], ctx);
    // Should only have one listing despite being in both tabs
    const tangopolisListings = result.listings.filter(
      (l) => l.listing.title === "TANGÓPOLIS JAPAN MILONGA",
    );
    expect(tangopolisListings).toHaveLength(1);
  });

  it("drops Yokohama venues NRG SPACE and Night Fire per D-1235", async () => {
    const header = "タイムスタンプ,イベント,日付,,時間,場所,Maps,情報\n";
    const rows = [
      `2026/10/12 11:33:37,ナイトミロンガパーティー,11/10,火曜,20:00,NRG SPACE,https://maps.app.goo.gl/rUr7pgqFB2GHwtmt7,"...NRG SPACE\\nhttps://www.facebook.com/..."`,
      `2026/10/12 11:33:38,YOKOHAMA MILONGA,11/08,日曜,14:00,Night Fire,https://maps.app.goo.gl/vkCg9G4qLus7wemGA,"YOKOHAMA MILONGA\\n\\n13:00-14:00 lesson..."`,
      `2026/10/12 11:33:39,ダミー,11/11,水曜,19:00,ＮＲＧ　ＳＰＡＣＥ,,"no maps link"`,
      `2026/10/12 11:33:40,Yokohama Milonga,11/12,木曜,19:00,Studio X,,"東京都渋谷区1-2-3"`,
      `2026/10/12 11:33:41,Tokyo Milonga,11/13,金曜,19:00,Studio Y,,"info"`,
    ];
    const csv = header + rows.join("\n");

    const ctx = mockCtx([
      { status: 200, body: csv },
      { status: 200, body: csv },
    ]);

    const result = await tokyoTangoAdapter.harvestMetro!(
      metro,
      ["2026-11-08", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"],
      ctx,
    );
    const titles = result.listings.map((l) => l.listing.title);
    // Should contain only Tokyo Milonga and Yokohama Milonga (the latter has Tokyo address)
    expect(titles).toHaveLength(2);
    expect(titles).toContain("Tokyo Milonga");
    expect(titles).toContain("Yokohama Milonga");
    expect(result.notes?.some((n) => n.includes("outside Tokyo metro"))).toBe(true);
  });

  it("handles header without Maps column", async () => {
    const header = "タイムスタンプ,イベント,日付,,時間,場所,情報\n";
    const row = `2026/10/12 11:33:37,Tokyo Milonga,11/13,金曜,19:00,Studio Y,"info"`;
    const csv = header + row;

    const ctx = mockCtx([
      { status: 200, body: csv },
      { status: 200, body: csv },
    ]);

    const result = await tokyoTangoAdapter.harvestMetro!(metro, ["2026-11-13"], ctx);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.title).toBe("Tokyo Milonga");
    // Should not have "missing required columns" note
    const missingColNote = result.notes?.find((n) => n.includes("missing required columns"));
    expect(missingColNote).toBeUndefined();
  });
});
