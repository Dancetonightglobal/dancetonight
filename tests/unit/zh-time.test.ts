import { describe, expect, it } from "vitest";
import { hanTimeTokens } from "@/src/domain/zh-time";
import { readBlockTimes } from "@/src/domain/stated-times";
import { normalizeStatedTime } from "@/src/domain/listing";

describe("hanTimeTokens", () => {
  it("returns empty when no Han character", () => {
    expect(hanTimeTokens("8pm")).toEqual([]);
    expect(hanTimeTokens("20:00")).toEqual([]);
    expect(hanTimeTokens("")).toEqual([]);
  });

  it("reads 晚上8時 -> 20:00 pm", () => {
    const tokens = hanTimeTokens("晚上8時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 0, mer: "pm" });
    // h is stored as 8 (12-hour) because mer is pm
    expect(tokens[0]!.h).toBe(8);
  });

  it("reads 晚上8時30分 -> 20:30", () => {
    const tokens = hanTimeTokens("晚上8時30分");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 30, mer: "pm" });
  });

  it("reads 晚上8點半 -> 20:30", () => {
    const tokens = hanTimeTokens("晚上8點半");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 30, mer: "pm" });
  });

  it("reads 晚上８時 (full-width) -> 20:00", () => {
    const tokens = hanTimeTokens("晚上８時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 0, mer: "pm" });
  });

  it("reads 晚上八點 -> 20:00", () => {
    const tokens = hanTimeTokens("晚上八點");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 0, mer: "pm" });
  });

  it("reads 晚上十點正 -> 22:00", () => {
    const tokens = hanTimeTokens("晚上十點正");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 10, m: 0, mer: "pm" });
  });

  it("reads 凌晨2時 -> 02:00 am", () => {
    const tokens = hanTimeTokens("凌晨2時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 2, m: 0, mer: "am" });
  });

  it("reads 凌晨12時 -> 00:00", () => {
    const tokens = hanTimeTokens("凌晨12時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 12, m: 0, mer: "am" });
  });

  it("reads 中午12時 -> 12:00", () => {
    const tokens = hanTimeTokens("中午12時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 12, m: 0, mer: "pm" });
  });

  it("reads 下午3時 -> 15:00", () => {
    const tokens = hanTimeTokens("下午3時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 3, m: 0, mer: "pm" });
  });

  it("reads 20時 -> 20:00 24", () => {
    const tokens = hanTimeTokens("20時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 20, m: 0, mer: "24" });
  });

  it("reads 晚上12時 -> 00:00", () => {
    const tokens = hanTimeTokens("晚上12時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 0, m: 0, mer: "24" });
  });

  it("reads 夜晚12點 -> 00:00", () => {
    const tokens = hanTimeTokens("夜晚12點");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 0, m: 0, mer: "24" });
  });

  it("reads 下午12時 -> 12:00", () => {
    const tokens = hanTimeTokens("下午12時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 12, m: 0, mer: "pm" });
  });

  it("reads 晚上8點鐘 -> 20:00", () => {
    const tokens = hanTimeTokens("晚上8點鐘");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 0, mer: "pm" });
  });

  it("skips durations: 3小時 -> []", () => {
    const tokens = hanTimeTokens("3小時");
    expect(tokens).toEqual([]);
  });

  it("skips durations: 兩個鐘 -> []", () => {
    const tokens = hanTimeTokens("兩個鐘");
    expect(tokens).toEqual([]);
  });

  it("reads 時間：晚上8時 -> one token 20:00", () => {
    const tokens = hanTimeTokens("時間：晚上8時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 0, mer: "pm" });
    // Check offsets
    const text = "時間：晚上8時";
    const token = tokens[0]!;
    expect(text.slice(token.at, token.end)).toBe("晚上8時");
  });

  it("reads 8時 -> h 8, mer null", () => {
    const tokens = hanTimeTokens("8時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 0, mer: null });
  });

  it("reads 晚上 8:00 -> 20:00", () => {
    const tokens = hanTimeTokens("晚上 8:00");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 8, m: 0, mer: "pm" });
  });

  it("skips dates: 8月8日 -> []", () => {
    const tokens = hanTimeTokens("8月8日");
    expect(tokens).toEqual([]);
  });

  it("skips prices: HK$200 -> []", () => {
    const tokens = hanTimeTokens("HK$200");
    expect(tokens).toEqual([]);
  });

  it("offsets: 逢星期三 晚上8時 Salsa -> slice exactly 晚上8時", () => {
    const text = "逢星期三 晚上8時 Salsa";
    const tokens = hanTimeTokens(text);
    expect(tokens).toHaveLength(1);
    const token = tokens[0]!;
    expect(text.slice(token.at, token.end)).toBe("晚上8時");
  });

  it("reads 24時 -> h 0 mer 24", () => {
    const tokens = hanTimeTokens("24時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 0, m: 0, mer: "24" });
  });
});

describe("readBlockTimes with Chinese", () => {
  it("reads 晚上8時至凌晨2時 -> start 20:00 and end 02:00", () => {
    const mentions = readBlockTimes("晚上8時至凌晨2時", "zh");
    expect(mentions).toHaveLength(2);
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("20:00");
    expect(end?.value).toBe("02:00");
  });

  it("reads 晚上9時開始 -> start 21:00", () => {
    const mentions = readBlockTimes("晚上9時開始", "zh");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.role).toBe("start");
    expect(mentions[0]!.value).toBe("21:00");
  });

  it("still reads English times unchanged", () => {
    const mentions = readBlockTimes("Salsa Night 20:00-02:00", "zh");
    expect(mentions).toHaveLength(2);
    expect(mentions[0]!.value).toBe("20:00");
    expect(mentions[1]!.value).toBe("02:00");
  });

  it("reads 9pm-2am unchanged", () => {
    const mentions = readBlockTimes("9pm-2am", "zh");
    expect(mentions).toHaveLength(2);
    expect(mentions[0]!.value).toBe("21:00");
    expect(mentions[1]!.value).toBe("02:00");
  });
});

describe("normalizeStatedTime", () => {
  it("converts 晚上8時 -> 20:00", () => {
    expect(normalizeStatedTime("晚上8時")).toBe("20:00");
  });

  it("leaves 8時 -> null", () => {
    expect(normalizeStatedTime("8時")).toBeNull();
  });

  it("leaves 19:30 unchanged", () => {
    expect(normalizeStatedTime("19:30")).toBe("19:30");
  });

  it("converts 凌晨12時 -> 00:00", () => {
    expect(normalizeStatedTime("凌晨12時")).toBe("00:00");
  });

  it("converts 下午12時 -> 12:00", () => {
    expect(normalizeStatedTime("下午12時")).toBe("12:00");
  });

  it("converts 中午12時 -> 12:00", () => {
    expect(normalizeStatedTime("中午12時")).toBe("12:00");
  });

  it("converts 時間：晚上8時 -> 20:00", () => {
    expect(normalizeStatedTime("時間：晚上8時")).toBe("20:00");
  });

  it("returns null for HK$200 晚上8時", () => {
    expect(normalizeStatedTime("HK$200 晚上8時")).toBeNull();
  });
});

describe("readBlockTimes: midnight through the shared path (coverage 10-31)", () => {
  it("reads 晚上10時至夜晚12時 as 22:00 to 00:00", () => {
    const m = readBlockTimes("晚上10時至夜晚12時", "zh");
    expect(m.find((x) => x.role === "start")?.value).toBe("22:00");
    expect(m.find((x) => x.role === "end")?.value).toBe("00:00");
  });
  it("reads 凌晨12時 as 00:00", () => {
    expect(readBlockTimes("凌晨12時", "zh").map((x) => x.value)).toEqual(["00:00"]);
  });
});
