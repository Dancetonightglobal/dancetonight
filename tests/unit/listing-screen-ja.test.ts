import { describe, expect, it } from "vitest";
import { screenTitleJa } from "@/src/domain/listing-screen-ja";

describe("screenTitleJa Japanese title screens", () => {
  it("returns null for titles without Japanese characters", () => {
    expect(screenTitleJa("Salsa Night")).toBeNull();
    expect(screenTitleJa("Club Cruise")).toBeNull();
  });

  it("screens out boat parties", () => {
    expect(screenTitleJa("東京湾ナイトクルーズ DJパーティー")).toEqual({
      kind: "boat_or_cruise",
      reason: "a boat party or cruise (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out bar crawls", () => {
    expect(screenTitleJa("渋谷はしご酒ツアー")).toEqual({
      kind: "crawl_bus_or_happy_hour",
      reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out happy hours without dance", () => {
    expect(screenTitleJa("ハッピーアワー 50%OFF")).toEqual({
      kind: "crawl_bus_or_happy_hour",
      reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
    });
  });

  it("keeps happy hours with dance style", () => {
    expect(screenTitleJa("ハッピーアワー サルサナイト")).toBeNull();
  });

  it("screens out karaoke", () => {
    expect(screenTitleJa("カラオケナイト")).toEqual({
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out record fairs", () => {
    expect(screenTitleJa("レコードフェア 2026")).toEqual({
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out singles mixers without dance", () => {
    expect(screenTitleJa("街コン in 六本木")).toEqual({
      kind: "not_dance_scope",
      reason: "a singles mixer or speed dating (no dance named)",
    });
  });

  it("screens out games nights without dance", () => {
    expect(screenTitleJa("ボードゲーム会")).toEqual({
      kind: "not_dance_scope",
      reason: "a games night (the owner lists none)",
    });
  });

  it("screens out kids events (always out)", () => {
    expect(screenTitleJa("キッズダンス体験")).toEqual({
      kind: "not_dance_scope",
      reason: "a children's party or class (the owner lists none, D-570)",
    });
  });

  it("screens out haunted houses", () => {
    expect(screenTitleJa("お化け屋敷")).toEqual({
      kind: "not_dance_scope",
      reason: "a haunted house (the owner lists none)",
    });
  });

  it("screens out sound baths without dance", () => {
    expect(screenTitleJa("シンギングボウル瞑想会")).toEqual({
      kind: "not_dance_scope",
      reason: "a sound bath (not a dance night)",
    });
  });

  it("screens out seated shows without joins", () => {
    expect(screenTitleJa("映画の上映会")).toEqual({
      kind: "not_dance_scope",
      reason: "a seated show, talk or screening, not a dance (D-589)",
    });
  });

  it("keeps dance events with joins", () => {
    expect(screenTitleJa("タンゴ公演 & ミロンガ")).toBeNull();
  });

  it("screens out language classes without dance", () => {
    expect(screenTitleJa("英会話カフェ")).toEqual({
      kind: "not_dance_scope",
      reason: "a class, watch party or club that names no dance (D-588)",
    });
  });

  it("screens out watch parties without dance", () => {
    expect(screenTitleJa("W杯パブリックビューイング")).toEqual({
      kind: "not_dance_scope",
      reason: "a class, watch party or club that names no dance (D-588)",
    });
  });

  it("screens out closure-only notices", () => {
    expect(screenTitleJa("本日貸切")).toEqual({
      kind: "closure",
      reason: "a cancellation or closed-day notice that names no event",
    });
    expect(screenTitleJa("【中止】11月8日(土)")).toEqual({
      kind: "closure",
      reason: "a cancellation or closed-day notice that names no event",
    });
  });

  it("keeps events with dates and dance", () => {
    expect(screenTitleJa("11月8日(土) サルサナイト")).toBeNull();
  });

  it("normalizes half-width katakana", () => {
    expect(screenTitleJa("ｶﾗｵｹ")).toEqual({
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    });
  });

  it("keeps false friends", () => {
    expect(screenTitleJa("コントラダンス")).toBeNull();
    expect(screenTitleJa("ダンスパーティー 映画音楽ナイト")).toBeNull();
    expect(screenTitleJa("社交ダンス発表会とパーティー")).toBeNull();
    expect(screenTitleJa("盆踊り大会")).toBeNull();
    expect(screenTitleJa("親子ダンス教室")).toBeNull();
  });

  it("screens 'サルサ クルーズ' as boat", () => {
    expect(screenTitleJa("サルサ クルーズ")).toEqual({
      kind: "boat_or_cruise",
      reason: "a boat party or cruise (the owner lists none, 2026-10-18)",
    });
  });
});

describe("screenTitle runs the Japanese screens", () => {
  it("screens a Japanese karaoke night and keeps a salsa party", async () => {
    const { screenTitle } = await import("@/src/domain/listing-screen");
    expect(screenTitle("カラオケナイト")?.kind).toBe("not_dance_scope");
    expect(screenTitle("サルサパーティー")).toBeNull();
  });

  it("leaves Han-only Chinese titles to screenTitleHan (coverage dry run)", () => {
    expect(screenTitleJa("舞蹈公演之後派對")).toBeNull();
    expect(screenTitleJa("免費公演 Tango Milonga")).toBeNull();
  });

  it("keeps shows with a Latin or short join word", () => {
    expect(screenTitleJa("クラブ映画祭アフター")).toBeNull();
    expect(screenTitleJa("トム・クルーズ ナイト")).toBeNull();
  });

  it("still screens kids shows, closed-day notices and plain dance shows", () => {
    expect(screenTitleJa("キッズダンス発表会")?.kind).toBe("not_dance_scope");
    expect(screenTitleJa("本日休業のお知らせ")?.kind).toBe("closure");
    expect(screenTitleJa("タンゴ公演")?.kind).toBe("not_dance_scope");
  });
});
