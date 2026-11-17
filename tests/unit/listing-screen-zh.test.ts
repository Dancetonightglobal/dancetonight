import { describe, expect, it } from "vitest";
import { screenTitleHan } from "@/src/domain/listing-screen-zh";

describe("screenTitleHan Chinese (Hong Kong) title screens", () => {
  it("screens out boat parties", () => {
    expect(screenTitleHan("維港船河派對")).toEqual({
      kind: "boat_or_cruise",
      reason: "a boat party or cruise (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out bar crawls", () => {
    expect(screenTitleHan("蘭桂坊酒吧巡遊")).toEqual({
      kind: "crawl_bus_or_happy_hour",
      reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out happy hours without dance", () => {
    expect(screenTitleHan("歡樂時光 半價")).toEqual({
      kind: "crawl_bus_or_happy_hour",
      reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out karaoke", () => {
    expect(screenTitleHan("卡拉OK之夜")).toEqual({
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out record fairs", () => {
    expect(screenTitleHan("黑膠市集")).toEqual({
      kind: "not_dance_scope",
      reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
    });
  });

  it("screens out singles mixers without dance", () => {
    expect(screenTitleHan("速配之夜")).toEqual({
      kind: "not_dance_scope",
      reason: "a singles mixer or speed dating (no dance named)",
    });
  });

  it("screens out games nights without dance", () => {
    expect(screenTitleHan("桌遊之夜")).toEqual({
      kind: "not_dance_scope",
      reason: "a games night (the owner lists none)",
    });
  });

  it("screens out children's parties", () => {
    expect(screenTitleHan("兒童派對")).toEqual({
      kind: "not_dance_scope",
      reason: "a children's party (the owner lists none, 2026-10-28)",
    });
  });

  it("screens out haunted houses", () => {
    expect(screenTitleHan("萬聖節鬼屋")).toEqual({
      kind: "not_dance_scope",
      reason: "a haunted house (the owner lists none)",
    });
  });

  it("screens out sound baths without dance", () => {
    expect(screenTitleHan("頌缽冥想")).toEqual({
      kind: "not_dance_scope",
      reason: "a sound bath (not a dance night)",
    });
  });

  it("screens out cancellation-only titles", () => {
    expect(screenTitleHan("活動取消")).toEqual({
      kind: "closure",
      reason: "a cancellation notice that names no event",
    });
    expect(screenTitleHan("【已取消】")).toEqual({
      kind: "closure",
      reason: "a cancellation notice that names no event",
    });
    expect(screenTitleHan("11月5日 延期")).toEqual({
      kind: "closure",
      reason: "a cancellation notice that names no event",
    });
  });

  it("keeps yacht club dance", () => {
    expect(screenTitleHan("遊艇會舞會")).toBeNull();
  });

  it("keeps dance events with karaoke beside non-club style", () => {
    // Using English style word "Bachata" which is a non-club style
    expect(screenTitleHan("Bachata & 卡拉OK之夜")).toBeNull();
  });

  it("keeps dance events with happy hour", () => {
    expect(screenTitleHan("歡樂時光 騷莎舞會")).toBeNull();
  });

  it("keeps dance events even if cancelled", () => {
    expect(screenTitleHan("騷莎舞會 取消")).toBeNull();
  });

  it("keeps dance events with games", () => {
    expect(screenTitleHan("桌遊與跳舞之夜")).toBeNull();
  });

  it("keeps English titles", () => {
    expect(screenTitleHan("Salsa Wednesdays at K-97")).toBeNull();
    expect(screenTitleHan("Boat party")).toBeNull();
  });

  it("returns null for titles without Han characters", () => {
    expect(screenTitleHan("Salsa Social")).toBeNull();
  });
});

describe("screenTitle runs the Han screens (D-664)", () => {
  it("screens a Chinese boat party and keeps a yacht-club dance", async () => {
    const { screenTitle } = await import("@/src/domain/listing-screen");
    expect(screenTitle("維港船河派對")?.kind).toBe("boat_or_cruise");
    expect(screenTitle("遊艇會舞會")).toBeNull();
  });
  it("a bare Chinese date is not a cancellation", () => {
    expect(screenTitleHan("11月5日")).toBeNull();
  });
});
