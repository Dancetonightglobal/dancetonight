import { describe, expect, it } from "vitest";
import { parseRecurrenceText, normalizeRecurrenceText } from "@/src/domain/recurrence";

describe("Japanese weekly/monthly phrases (D-1225)", () => {
  it("parses weekly phrases", () => {
    expect(parseRecurrenceText("毎週金曜日", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("毎週金曜", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("毎週 金曜日", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("毎週金曜日の夜", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("毎週金曜日開催", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("毎週金・土曜日", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(parseRecurrenceText("毎週金曜日と土曜日", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(parseRecurrenceText("毎週金曜・土曜", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(parseRecurrenceText("毎週水、金曜日", "ja")).toBe("FREQ=WEEKLY;BYDAY=WE,FR");
  });

  it("parses biweekly (隔週)", () => {
    expect(parseRecurrenceText("隔週土曜日", "ja")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    expect(parseRecurrenceText("隔週 土曜日", "ja")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    expect(parseRecurrenceText("隔週土曜日の夜", "ja")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
  });

  it("parses monthly ordinal phrases", () => {
    expect(parseRecurrenceText("毎月第2土曜日", "ja")).toBe("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2");
    expect(parseRecurrenceText("毎月第２土曜日", "ja")).toBe("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2");
    expect(parseRecurrenceText("毎月第1・第3金曜日", "ja")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1,3",
    );
    expect(parseRecurrenceText("第1・3土曜日", "ja")).toBe("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1,3");
    expect(parseRecurrenceText("毎月最終金曜日", "ja")).toBe("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1");
    expect(parseRecurrenceText("第三日曜日", "ja")).toBe("FREQ=MONTHLY;BYDAY=SU;BYSETPOS=3");
  });

  it("parses weekday range and weekdays", () => {
    expect(parseRecurrenceText("平日", "ja")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("月曜日〜金曜日", "ja")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("木曜から土曜まで", "ja")).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
  });

  it("parses simple frequencies", () => {
    expect(parseRecurrenceText("毎日", "ja")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("毎晩", "ja")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("毎夜", "ja")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("毎週", "ja")).toBe("FREQ=WEEKLY");
    expect(parseRecurrenceText("毎月", "ja")).toBe("FREQ=MONTHLY");
    expect(parseRecurrenceText("毎年", "ja")).toBe("FREQ=YEARLY");
  });

  it("returns null for ambiguous or one-off phrases", () => {
    expect(parseRecurrenceText("金曜日", "ja")).toBeNull(); // bare day
    expect(parseRecurrenceText("2土曜日", "ja")).toBeNull(); // no 第, no 毎月
    expect(parseRecurrenceText("毎週金曜日（祝日除く）", "ja")).toBeNull(); // hedge
    expect(parseRecurrenceText("ほぼ毎週金曜日", "ja")).toBeNull(); // hedge "almost"
    expect(parseRecurrenceText("月1回", "ja")).toBeNull(); // not a pattern
    expect(parseRecurrenceText("毎月金曜日", "ja")).toBeNull(); // no ordinal
    expect(parseRecurrenceText("今週金曜日", "ja")).toBeNull(); // this week
  });

  it("works without explicit lang", () => {
    expect(parseRecurrenceText("毎週金曜日")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("does not break other languages", () => {
    expect(parseRecurrenceText("every Friday", "en")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("every Friday and Saturday", "en")).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(parseRecurrenceText("tous les mardis", "fr")).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("normalizeRecurrenceText handles Japanese punctuation", () => {
    expect(normalizeRecurrenceText("毎週金・土曜日")).toBe("毎週金 , 土曜日");
    expect(normalizeRecurrenceText("毎週金曜日と土曜日")).toBe("毎週金曜日 , 土曜日");
    expect(normalizeRecurrenceText("月曜日〜金曜日")).toBe("月曜日 - 金曜日");
    expect(normalizeRecurrenceText("毎月第２土曜日")).toBe("毎月第2土曜日"); // full-width digit
    expect(normalizeRecurrenceText("毎週水、金曜日")).toBe("毎週水 , 金曜日");
  });
});
