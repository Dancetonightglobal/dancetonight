import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { isShowTitleJa } from "@/src/domain/listing-screen-ja";

// D-848: AiSOTOPE LOUNGE's mixed calendar lists one-man concerts, free live shows and 歌謡 bar nights
// with no time (run 42914803193, 2026-11-10). A Japanese show title is screened whatever the time.
const TZ = "Asia/Tokyo";
const NIGHT = "2026-11-11";
const at = (hour: number) => new Date(Date.UTC(2026, 10, 11, hour - 9)); // JST is UTC+9
const untimed = (title: string) => ({
  title,
  styles: [] as string[],
  startsAt: null,
  nightDate: NIGHT,
  tz: TZ,
});
const timed = (title: string, hour: number) => ({ ...untimed(title), startsAt: at(hour) });

const mixedSource = { mixedCalendar: true, styles: ["queer_party", "dj_night"] };
const plainSource = { styles: ["queer_party", "dj_night"] };

const SHOWS = [
  "二丁目の魁カミングアウトpresents 『現体制6周年記念ワンマンライブ』",
  "日本歌謡酒場 二代目ヒロ江",
  "二丁目の魁カミングアウト 無料ライブ『FREE GAY LIVE』",
  "あいり生誕祭ワンマンライブ",
  "まいんず LIVE vol.3",
];

const KEPT = [
  "ライブ & DJ NIGHT",
  "クラブナイト ライブ",
  "ダンスパーティー ライブ",
  "サルサ ライブ",
  "歌謡曲ナイト",
  "あいり生誕祭 DJ PARTY",
  "ライブ×ディスコ",
  "LIVE & Club Party ナイト",
  // A birthday 生誕祭 at a club is a party unless it also bills a show (coverage-136).
  "ぺいにゃむにゃむ生誕祭2026 『P THE WORLD』",
  "あいり生誕祭2026",
];

describe("isShowTitleJa (D-848)", () => {
  it.each(SHOWS)("names a show: %s", (title) => {
    expect(isShowTitleJa(title)).toBe(true);
  });

  it.each(KEPT)(
    "a show word with a dance, style, DJ, party, club or night word is not a show: %s",
    (title) => {
      expect(isShowTitleJa(title)).toBe(false);
    },
  );

  it("needs kana: English and kana-free titles are left alone", () => {
    expect(isShowTitleJa("Salsa Live Band Night")).toBe(false);
    expect(isShowTitleJa("Live Music Friday")).toBe(false);
    expect(isShowTitleJa("FREE GAY LIVE")).toBe(false);
  });

  it("matches LIVE as a word only", () => {
    expect(isShowTitleJa("オリーブ olive ナイト")).toBe(false);
    expect(isShowTitleJa("まいんず Lively")).toBe(false);
    expect(isShowTitleJa("まいんず交友記")).toBe(false);
  });

  it("does not match other AiSOTOPE party titles", () => {
    for (const title of [
      "まいんず交友記 vol.2",
      "前髪系ナイト",
      "BEAR-TRAIN 《熊収穫祭》 The Bear Harvest Festival",
      "ノーパンスウェットナイト61本目",
      "サカナクションナイト「魚夜」",
    ]) {
      expect(isShowTitleJa(title)).toBe(false);
    }
  });
});

describe("screenNoDance screens Japanese show titles on a mixed calendar (D-848)", () => {
  it.each(SHOWS)("untimed show is screened: %s", (title) => {
    expect(screenNoDance(untimed(title), mixedSource)).not.toBeNull();
  });

  it.each(SHOWS)("late show is screened too: %s", (title) => {
    expect(screenNoDance(timed(title, 23), mixedSource)).not.toBeNull();
  });

  it("gives the D-848 reason", () => {
    const screened = screenNoDance(untimed("日本歌謡酒場 二代目ヒロ江"), mixedSource);
    expect(screened?.kind).toBe("not_dance_scope");
    expect(screened?.reason).toContain("D-848");
  });

  it.each(KEPT)("untimed party with a show word is kept: %s", (title) => {
    expect(screenNoDance(untimed(title), mixedSource)).toBeNull();
  });

  it("a dance night the starting page names is kept", () => {
    const source = { ...mixedSource, danceNights: ["日本歌謡酒場 二代目ヒロ江"] };
    expect(screenNoDance(untimed("日本歌謡酒場 二代目ヒロ江"), source)).toBeNull();
  });

  it("only on a mixed calendar", () => {
    expect(screenNoDance(untimed("日本歌謡酒場 二代目ヒロ江"), plainSource)).toBeNull();
    expect(screenNoDance(untimed("まいんず LIVE vol.3"), plainSource)).toBeNull();
  });

  it("a band-for-dancers source keeps its live-band nights", () => {
    const source = { mixedCalendar: true, bandsForDancers: true, styles: ["salsa"] };
    expect(screenNoDance(untimed("オルケスタ ライブ"), source)).toBeNull();
    expect(screenNoDance(timed("オルケスタ ライブ", 21), source)).toBeNull();
  });
});
