import { describe, expect, it } from "vitest";
import { parseRecurrenceText } from "@/src/domain/recurrence";

describe("Chinese weekly/monthly phrases", () => {
  it("parses weekly phrases", () => {
    expect(parseRecurrenceText("逢星期五", "zh")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("每逢星期五晚上", "zh")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("每週五", "zh")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("每周五晚", "zh")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("逢週六", "zh")).toBe("FREQ=WEEKLY;BYDAY=SA");
    expect(parseRecurrenceText("每個星期日", "zh")).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(parseRecurrenceText("逢星期五及星期六", "zh")).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(parseRecurrenceText("逢星期三、星期五", "zh")).toBe("FREQ=WEEKLY;BYDAY=WE,FR");
    expect(parseRecurrenceText("每週禮拜天", "zh")).toBe("FREQ=WEEKLY;BYDAY=SU");
  });

  it("parses biweekly phrases", () => {
    expect(parseRecurrenceText("隔週星期六", "zh")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    expect(parseRecurrenceText("隔周星期六", "zh")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    expect(parseRecurrenceText("每兩週星期六", "zh")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
    expect(parseRecurrenceText("每两周星期六", "zh")).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA");
  });

  it("parses monthly ordinal phrases", () => {
    expect(parseRecurrenceText("每月第二個星期六", "zh")).toBe("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=2");
    expect(parseRecurrenceText("每月第一及第三個星期五", "zh")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1,3",
    );
    expect(parseRecurrenceText("每月最後一個星期五", "zh")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1",
    );
    expect(parseRecurrenceText("每个月第2个星期日", "zh")).toBe("FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2");
    expect(parseRecurrenceText("第2个星期日", "zh")).toBe("FREQ=MONTHLY;BYDAY=SU;BYSETPOS=2");
    expect(parseRecurrenceText("最後一個星期五", "zh")).toBe("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1");
  });

  it("parses weekday range and weekdays", () => {
    expect(parseRecurrenceText("星期四至星期六", "zh")).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
    expect(parseRecurrenceText("星期四到星期六", "zh")).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
    expect(parseRecurrenceText("星期四-星期六", "zh")).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
    expect(parseRecurrenceText("平日", "zh")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("工作日", "zh")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("週一至週五", "zh")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("周一至周五", "zh")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(parseRecurrenceText("星期一至星期五", "zh")).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  it("parses simple frequencies", () => {
    expect(parseRecurrenceText("每日", "zh")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("每天", "zh")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("每晚", "zh")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("每週", "zh")).toBe("FREQ=WEEKLY");
    expect(parseRecurrenceText("每周", "zh")).toBe("FREQ=WEEKLY");
    expect(parseRecurrenceText("每月", "zh")).toBe("FREQ=MONTHLY");
    expect(parseRecurrenceText("每年", "zh")).toBe("FREQ=YEARLY");
  });

  it("returns null for ambiguous or one-off phrases", () => {
    expect(parseRecurrenceText("星期五", "zh")).toBeNull(); // bare day
    expect(parseRecurrenceText("大部分星期五", "zh")).toBeNull(); // hedged
    expect(parseRecurrenceText("2026年11月13日星期五", "zh")).toBeNull(); // a date
    expect(parseRecurrenceText("下星期五", "zh")).toBeNull(); // next Friday
    expect(parseRecurrenceText("星期五晚上", "zh")).toBeNull(); // no recurrence word
    expect(parseRecurrenceText("通常星期五", "zh")).toBeNull(); // hedge
  });

  it("works without explicit lang", () => {
    expect(parseRecurrenceText("逢星期五")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("does not break other languages", () => {
    expect(parseRecurrenceText("毎週金曜日", "ja")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("every Friday", "en")).toBe("FREQ=WEEKLY;BYDAY=FR");
  });
});
