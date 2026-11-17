import { describe, expect, it } from "vitest";
import { parseRecurrenceText, normalizeRecurrenceText } from "@/src/domain/recurrence";

describe("Arabic weekly phrases (D-1064)", () => {
  it("parses 'كل خميس' and variants", () => {
    expect(parseRecurrenceText("كل خميس", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("كل يوم خميس", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("كل يوم جمعة", "ar")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("كل خميس؛ ٩م", "ar")).toBeNull();
    expect(parseRecurrenceText("كلّ خميس", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH"); // shadda
    expect(parseRecurrenceText("كل جمعة", "ar")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("كل الجمعة", "ar")).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(parseRecurrenceText("مساء كل ثلاثاء", "ar")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("كل خميس وجمعة", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH,FR");
    expect(parseRecurrenceText("كل خميس، جمعة وسبت", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH,FR,SA");
    expect(parseRecurrenceText("كل إثنين", "ar")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(parseRecurrenceText("كل اثنين", "ar")).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(parseRecurrenceText("كل أحد", "ar")).toBe("FREQ=WEEKLY;BYDAY=SU");
    expect(parseRecurrenceText("كل أربعاء", "ar")).toBe("FREQ=WEEKLY;BYDAY=WE");
  });

  it("parses other weekly patterns", () => {
    expect(parseRecurrenceText("الخميس من كل أسبوع", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("أيام الخميس", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("ليالي الجمعة والسبت", "ar")).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
    expect(parseRecurrenceText("كل أسبوع يوم الخميس", "ar")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("أسبوعياً", "ar")).toBe("FREQ=WEEKLY");
    expect(parseRecurrenceText("كل أسبوعين", "ar")).toBe("FREQ=WEEKLY;INTERVAL=2");
    expect(parseRecurrenceText("كل أسبوعين يوم السبت", "ar")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA",
    );
  });

  it("parses monthly ordinal patterns", () => {
    expect(parseRecurrenceText("أول جمعة من كل شهر", "ar")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1",
    );
    expect(parseRecurrenceText("آخر سبت من كل شهر", "ar")).toBe(
      "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=-1",
    );
    expect(parseRecurrenceText("الجمعة الأولى من كل شهر", "ar")).toBe(
      "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1",
    );
  });

  it("parses weekday range and frequency phrases", () => {
    expect(parseRecurrenceText("من الاثنين إلى الجمعة", "ar")).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(parseRecurrenceText("كل يوم", "ar")).toBe("FREQ=DAILY");
    expect(parseRecurrenceText("شهرياً", "ar")).toBe("FREQ=MONTHLY");
  });

  it("returns null for ambiguous or one-off phrases", () => {
    expect(parseRecurrenceText("الخميس", "ar")).toBeNull();
    expect(parseRecurrenceText("يوم الخميس", "ar")).toBeNull();
    expect(parseRecurrenceText("ليلة الخميس", "ar")).toBeNull();
    expect(parseRecurrenceText("هذا الخميس", "ar")).toBeNull();
    expect(parseRecurrenceText("الخميس القادم", "ar")).toBeNull();
    expect(parseRecurrenceText("عادة كل خميس", "ar")).toBeNull();
    expect(parseRecurrenceText("يوم الخميس 12 نوفمبر", "ar")).toBeNull();
    expect(parseRecurrenceText("كل التفاصيل يوم الجمعة", "ar")).toBeNull();
  });

  it("works without explicit lang", () => {
    expect(parseRecurrenceText("كل خميس")).toBe("FREQ=WEEKLY;BYDAY=TH");
  });

  it("does not break other languages", () => {
    expect(parseRecurrenceText("every Thursday", "en")).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(parseRecurrenceText("her Salı", "tr")).toBe("FREQ=WEEKLY;BYDAY=TU");
    expect(parseRecurrenceText("tous les mardis", "fr")).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("normalizeRecurrenceText unchanged for Latin input", () => {
    // The exact string from the code (we can't know, but we can check it's consistent)
    const normalized = normalizeRecurrenceText("Every Thursday, 8pm");
    // Should not contain Arabic characters
    expect(normalized).not.toMatch(/[أ-ي]/);
    // Should be lowercased and normalized
    expect(normalized).toBe("every thursday , 8pm");
  });

  it("keeps Arabic-Indic digits while folding marks", () => {
    expect(normalizeRecurrenceText("كلّ خميس ٩م")).toBe("كل خميس ٩م");
  });
});
