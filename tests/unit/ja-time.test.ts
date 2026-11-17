import { readBlockTimes } from "@/src/domain/stated-times";
import { describe, expect, it } from "vitest";
import { hanTimeTokens } from "@/src/domain/zh-time";
import { normalizeStatedTime } from "@/src/domain/listing";

describe("Japanese clock forms", () => {
  it("午後10時 -> token {h:10, m:0, mer:'pm'}; normalize -> 22:00", () => {
    const tokens = hanTimeTokens("午後10時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 10, m: 0, mer: "pm" });
    expect(normalizeStatedTime("午後10時")).toBe("22:00");
  });

  it("午後12時 -> 12:00 (noon)", () => {
    expect(normalizeStatedTime("午後12時")).toBe("12:00");
  });

  it("午前2時 -> 02:00", () => {
    expect(normalizeStatedTime("午前2時")).toBe("02:00");
  });

  it("午前12時 -> 00:00", () => {
    expect(normalizeStatedTime("午前12時")).toBe("00:00");
  });

  it("深夜1時 -> 01:00", () => {
    expect(normalizeStatedTime("深夜1時")).toBe("01:00");
  });

  it("深夜0時 -> 00:00", () => {
    const tokens = hanTimeTokens("深夜0時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.mer).toBe("am");
    expect(normalizeStatedTime("深夜0時")).toBe("00:00");
  });

  it("夕方6時半 -> 18:30", () => {
    expect(normalizeStatedTime("夕方6時半")).toBe("18:30");
  });

  it("正午12時 -> 12:00", () => {
    expect(normalizeStatedTime("正午12時")).toBe("12:00");
  });

  it("22時半 -> 22:30 (already works)", () => {
    expect(normalizeStatedTime("22時半")).toBe("22:30");
  });

  it("18時30分 -> 18:30 (already works)", () => {
    expect(normalizeStatedTime("18時30分")).toBe("18:30");
  });

  it("25時 -> 01:00", () => {
    const tokens = hanTimeTokens("25時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 1, m: 0, mer: "24" });
    expect(normalizeStatedTime("25時")).toBe("01:00");
  });

  it("29時 -> 05:00", () => {
    expect(normalizeStatedTime("29時")).toBe("05:00");
  });

  it("30時 -> no token", () => {
    const tokens = hanTimeTokens("30時");
    expect(tokens).toHaveLength(0);
    expect(normalizeStatedTime("30時")).toBeNull();
  });

  it("開場 18時30分 / 開演 19時 -> two tokens 18:30 and 19:00", () => {
    const text = "開場 18時30分 / 開演 19時";
    const tokens = hanTimeTokens(text);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ h: 18, m: 30, mer: "24" });
    expect(tokens[1]).toMatchObject({ h: 19, m: 0, mer: "24" });
  });

  it("date is not a time: 11月8日(土) 22時 -> one token for 22時", () => {
    const text = "11月8日(土) 22時";
    const tokens = hanTimeTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 22, m: 0, mer: "24" });
  });

  it("Hong Kong regression: 晚上8時 -> 20:00", () => {
    expect(normalizeStatedTime("晚上8時")).toBe("20:00");
  });

  it("Hong Kong regression: 晚上12時 -> 00:00", () => {
    expect(normalizeStatedTime("晚上12時")).toBe("00:00");
  });

  it("Hong Kong regression: 下午3時 -> 15:00", () => {
    expect(normalizeStatedTime("下午3時")).toBe("15:00");
  });

  it("Hong Kong regression: 凌晨2時 -> 02:00", () => {
    expect(normalizeStatedTime("凌晨2時")).toBe("02:00");
  });

  it("深夜 must win over 夜", () => {
    const tokens = hanTimeTokens("深夜1時");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ h: 1, m: 0, mer: "am" });
    expect(normalizeStatedTime("深夜1時")).toBe("01:00");
  });

  it("早朝 and 明け方 work as am", () => {
    expect(normalizeStatedTime("早朝5時")).toBe("05:00");
    expect(normalizeStatedTime("明け方4時")).toBe("04:00");
  });

  it("深夜 8-11時 is the late evening: 深夜11時 -> 23:00, 深夜2時 -> 02:00", () => {
    expect(normalizeStatedTime("深夜11時")).toBe("23:00");
    expect(normalizeStatedTime("深夜10時")).toBe("22:00");
    expect(normalizeStatedTime("深夜2時")).toBe("02:00");
  });

  it("reads the range 22時〜26時 as start 22:00 and end 02:00", () => {
    const mentions = readBlockTimes("22時〜26時", "ja");
    const start = mentions.find((m) => m.role === "start");
    const end = mentions.find((m) => m.role === "end");
    expect(start?.value).toBe("22:00");
    expect(end?.value).toBe("02:00");
  });

  it("reads 〜 and から as range separators: 22:00〜5:00, 22時から26時", () => {
    const a = readBlockTimes("22:00〜5:00", "ja");
    expect(a.find((m) => m.role === "start")?.value).toBe("22:00");
    expect(a.filter((m) => m.role === "start")).toHaveLength(1);
    const b = readBlockTimes("22時から26時", "ja");
    expect(b.find((m) => m.role === "end")?.value).toBe("02:00");
  });

  it("22時から on its own is a start with no end (から is mostly just 'from')", () => {
    const m = readBlockTimes("22時から", "ja");
    expect(m.find((x) => x.role === "start")?.value).toBe("22:00");
    expect(m.find((x) => x.role === "end")?.value ?? null).toBeNull();
  });
});
