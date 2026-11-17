import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { hasDanceWordJa, hasPartyKindJa, hasSeatedShowJa } from "@/src/domain/listing-screen-ja";

const TZ = "Asia/Tokyo";
const NIGHT = "2026-11-13";
const at = (hour: number) => new Date(Date.UTC(2026, 10, 13, hour - 9)); // JST is UTC+9
const listing = (title: string, hour = 20, styles: string[] = []) => ({
  title,
  styles,
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedSource = { mixedCalendar: true, styles: [] as string[] };

describe("Japanese dance words in screenNoDance", () => {
  it("hasDanceWordJa returns true for Japanese dance words", () => {
    expect(hasDanceWordJa("踊ろう！金曜日")).toBe(true);
    expect(hasDanceWordJa("ダンスパーティー")).toBe(true);
    expect(hasDanceWordJa("舞踏会")).toBe(true);
    expect(hasDanceWordJa("ソーシャルダンス")).toBe(true);
    expect(hasDanceWordJa("踊れる")).toBe(true);
    expect(hasDanceWordJa("踊る")).toBe(true);
    expect(hasDanceWordJa("プラクティカ")).toBe(true);
    expect(hasDanceWordJa("ミロンガ")).toBe(true);
  });

  it("hasDanceWordJa returns false for non-dance Japanese", () => {
    expect(hasDanceWordJa("ジャズコンサート")).toBe(false);
    expect(hasDanceWordJa("公演")).toBe(false);
    expect(hasDanceWordJa("Salsa")).toBe(false);
  });

  it("hasPartyKindJa returns true for party words", () => {
    expect(hasPartyKindJa("パーティー")).toBe(true);
    expect(hasPartyKindJa("パーティ")).toBe(true);
    expect(hasPartyKindJa("クラブナイト")).toBe(true);
    expect(hasPartyKindJa("クラブイベント")).toBe(true);
    expect(hasPartyKindJa("オールナイト")).toBe(true);
    expect(hasPartyKindJa("ディスコ")).toBe(true);
    expect(hasPartyKindJa("レイヴ")).toBe(true);
    expect(hasPartyKindJa("レイブ")).toBe(true);
    expect(hasPartyKindJa("ハロウィン")).toBe(true);
  });

  it("hasPartyKindJa returns false for non-party words", () => {
    expect(hasPartyKindJa("ダンス")).toBe(false);
    expect(hasPartyKindJa("踊り")).toBe(false);
    expect(hasPartyKindJa("コンサート")).toBe(false);
  });

  it("hasSeatedShowJa returns true for Japanese seated-show words with kana", () => {
    expect(hasSeatedShowJa("コンサート")).toBe(true);
    expect(hasSeatedShowJa("リサイタル")).toBe(true);
    expect(hasSeatedShowJa("公演のお知らせ")).toBe(true);
    expect(hasSeatedShowJa("トークショー")).toBe(true);
    expect(hasSeatedShowJa("トークイベント")).toBe(true);
    expect(hasSeatedShowJa("ミュージカル")).toBe(true);
  });

  it("hasSeatedShowJa returns false for Han-only text", () => {
    expect(hasSeatedShowJa("公演")).toBe(false);
    expect(hasSeatedShowJa("映画")).toBe(false);
    expect(hasSeatedShowJa("演奏会")).toBe(false);
    expect(hasSeatedShowJa("上映")).toBe(false);
    expect(hasSeatedShowJa("講演")).toBe(false);
    expect(hasSeatedShowJa("演劇")).toBe(false);
    expect(hasSeatedShowJa("舞台")).toBe(false);
    expect(hasSeatedShowJa("発表会")).toBe(false);
    expect(hasSeatedShowJa("落語")).toBe(false);
    expect(hasSeatedShowJa("朗読")).toBe(false);
    expect(hasSeatedShowJa("展覧会")).toBe(false);
    expect(hasSeatedShowJa("鑑賞")).toBe(false);
  });

  it("hasSeatedShowJa returns false for ライブ (live gig)", () => {
    expect(hasSeatedShowJa("ライブ")).toBe(false);
  });
});

describe("screenNoDance with Japanese words", () => {
  it("keeps titles with Japanese dance words", () => {
    expect(screenNoDance(listing("踊ろう！金曜日"), mixedSource)).toBeNull();
    expect(screenNoDance(listing("ダンスパーティー"), mixedSource)).toBeNull();
    expect(screenNoDance(listing("オールナイト・ディスコ"), mixedSource)).toBeNull();
    expect(screenNoDance(listing("ハロウィンパーティー 2026"), mixedSource)).toBeNull();
    expect(screenNoDance(listing("クラブイベント VOL.3"), mixedSource)).toBeNull();
  });

  it("drops titles with Japanese seated-show words (no dance word)", () => {
    const result1 = screenNoDance(listing("ジャズコンサート"), mixedSource);
    expect(result1).not.toBeNull();
    expect(result1?.kind).toBe("not_a_dance");
    const result2 = screenNoDance(listing("コンテンポラリーダンス公演"), mixedSource);
    expect(result2).not.toBeNull();
    expect(result2?.kind).toBe("not_a_dance");
    const result3 = screenNoDance(listing("ダンス発表会"), mixedSource);
    expect(result3).not.toBeNull();
    expect(result3?.kind).toBe("not_a_dance");
    const result4 = screenNoDance(listing("映画上映会とダンス"), mixedSource);
    expect(result4).not.toBeNull();
    expect(result4?.kind).toBe("not_a_dance");
  });

  it("uses evidenceText with Japanese dance/party words", () => {
    // evidence contains dance word -> keep
    const kept = screenNoDance(
      {
        ...listing("Friday Session"),
        evidenceText: "毎週金曜日のダンスパーティー",
      },
      mixedSource,
    );
    expect(kept).toBeNull();

    // evidence contains seated-show word -> drop
    const dropped = screenNoDance(
      {
        ...listing("Friday Session"),
        evidenceText: "毎週金曜日のジャズ演奏",
      },
      mixedSource,
    );
    expect(dropped).not.toBeNull();
    expect(dropped?.kind).toBe("not_a_dance");
  });

  it("drops a dance-music concert: the seated check wins", () => {
    expect(screenNoDance(listing("ダンスミュージック・コンサート"), mixedSource)).not.toBeNull();
  });

  it("handles English titles unchanged", () => {
    expect(screenNoDance(listing("Jazz Concert"), mixedSource)).not.toBeNull();
    expect(screenNoDance(listing("Dance Party"), mixedSource)).toBeNull();
  });
});
