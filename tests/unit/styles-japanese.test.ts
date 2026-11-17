import { describe, expect, it } from "vitest";
import { matchStyles } from "@/config/styles";

// Japanese style words for Tokyo (D-1226): one Tokyo-style title per new word.
const cases: ReadonlyArray<[string, string]> = [
  ["ブラジリアンズーク ソーシャル 渋谷", "brazilian_zouk"],
  ["ウエストコーストスウィング パーティー", "west_coast_swing"],
  ["ウェストコーストスウィング 初心者レッスン", "west_coast_swing"],
  ["ブルースダンス ナイト 高円寺", "blues"],
  ["エクスタティックダンス 浜田山", "ecstatic_dance"],
  ["ラインダンス 体験会", "line_dance"],
  ["フォホー パーティー", "forro"],
  ["チャールストン ワークショップ", "charleston"],
  ["チャチャチャ レッスン", "cha_cha"],
  ["築地本願寺 盆踊り", "bon_odori"],
  ["高円寺 阿波おどり", "awa_odori"],
  ["フラダンス 教室", "hula"],
  ["パラパラナイト 六本木", "para_para"],
  // D-783: Studio JBA titles the Tokyo read 42420733466 dropped as naming no dance.
  ["お祭りマンボ", "mambo"],
  ["キゾバチャFriday in JBA", "kizomba"],
  ["キゾバチャFriday in JBA", "bachata"],
];

describe("Japanese style words (D-1226)", () => {
  for (const [title, key] of cases) {
    it(`${title} -> ${key}`, () => {
      expect(matchStyles(title, ["ja"]).styles).toContain(key);
    });
  }

  it("bare words that are not dances stay unmatched", () => {
    expect(matchStyles("ブルース ライブ", ["ja"]).styles).not.toContain("blues");
    expect(matchStyles("パラパラ漫画 展示", ["ja"]).styles).not.toContain("para_para");
  });

  it("English names of the new keys match", () => {
    expect(matchStyles("Bon Odori in Tsukiji", ["en"]).styles).toContain("bon_odori");
    expect(matchStyles("Para Para Night", ["en"]).styles).toContain("para_para");
  });
});
