import { describe, expect, it } from "vitest";
import { weeklyGridRowRule, weeklyGridRule } from "@/src/pipeline/weekly-grid";
import { foldPage } from "@/src/domain/text-facts";

describe("weekly grid row rule extraction (D-402)", () => {
  const pageText = `GÜN | MİLONGA ADI / ADRES | KONUM | SAAT | İLGİLİ İLETİŞİM

Pazartesi | Armada Otel / Sultanahmet / Ahırkapı Restaurant / İstanbul | | 21:00 - 01:00 | Serdar Sungar - 0532 664 88 36

Çarşamba | Milonga 333 / Taksim / İstanbul | | 21:30 - 01:30 | Murat Elmadağ - 0532 497 75 68

Perşembe | Tango Mia Milonga / Taksim / İstanbul | Konum [https://goo.gl/maps/PvKfM2gdEGLzbh2JA] | 21:00 - 01:00 | Gamze Tulpar - 0532 377 52 88
Recep Turgut - 0538 813 35 47

Cumartesi | Tango Mia Milonga / Taksim / İstanbul | Konum [https://goo.gl/maps/PvKfM2gdEGLzbh2JA] | 21:00 - 01:00 | Gamze Tulpar - 0532 377 52 88`;

  it("Milonga 333 -> BYDAY=WE, written Çarşamba", () => {
    const result = weeklyGridRowRule(pageText, "Milonga 333", "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(result!.written).toBe("Çarşamba");
  });

  it("Tango Mia Milonga -> BYDAY=TH,SA, written Perşembe, Cumartesi", () => {
    const result = weeklyGridRowRule(pageText, "Tango Mia Milonga", "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,SA");
    expect(result!.written).toBe("Perşembe, Cumartesi");
  });

  it("Armada Otel -> BYDAY=MO", () => {
    const result = weeklyGridRowRule(pageText, "Armada Otel", "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(result!.written).toBe("Pazartesi");
  });

  it("title not on the page returns null", () => {
    const result = weeklyGridRowRule(pageText, "Milonga Nowhere", "tr");
    expect(result).toBeNull();
  });

  it("row with date first cell returns null", () => {
    const text = `GÜN | MİLONGA ADI / ADRES | SAAT
31 Ekim | Milonga Tarih / Taksim | 21:00`;
    const result = weeklyGridRowRule(text, "Milonga Tarih", "tr");
    expect(result).toBeNull();
  });

  it("row with two weekdays in first cell -> BYDAY=TU,TH", () => {
    const text = `GÜN | MİLONGA ADI / ADRES | SAAT
Salı ve Perşembe | Milonga Çift / Kadıköy | 21:00`;
    const result = weeklyGridRowRule(text, "Milonga Çift", "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(result!.written).toBe("Salı ve Perşembe");
  });

  it("title found only in weekday cell is no match", () => {
    const text = `GÜN | MİLONGA ADI / ADRES | SAAT
Cuma | Pazartesi Gecesi | 21:00`;
    const result = weeklyGridRowRule(text, "Cuma", "tr");
    expect(result).toBeNull();
  });

  // Test through weeklyGridRule as well
  it("weeklyGridRule for Milonga 333", () => {
    const page = foldPage(pageText);
    const result = weeklyGridRule(page, pageText, "Milonga 333", null, "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(result!.written).toBe("Çarşamba");
  });

  it("weeklyGridRule for Tango Mia Milonga", () => {
    const page = foldPage(pageText);
    const result = weeklyGridRule(page, pageText, "Tango Mia Milonga", null, "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,SA");
    expect(result!.written).toBe("Perşembe, Cumartesi");
  });

  it("a price table, no schedule", () => {
    const text = `Paket | Fiyat | Not
Aylık üyelik | 1500 TL | Pazartesi hariç
Tek ders | 400 TL | Pazartesi`;
    const result = weeklyGridRowRule(text, "Aylık üyelik", "tr");
    expect(result).toBeNull();
  });

  it("a second weekday cell does not add a day", () => {
    const text = `Cuma | Cumartesi | Milonga İki / Beşiktaş | 21:00`;
    const result = weeklyGridRowRule(text, "Milonga İki", "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
    expect(result!.written).toBe("Cuma");
  });

  it("leading pipe", () => {
    const text = `| Pazartesi | Milonga Sol / Taksim | 21:00`;
    const result = weeklyGridRowRule(text, "Milonga Sol", "tr");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(result!.written).toBe("Pazartesi");
  });

  it("leading pipe with title in weekday cell returns null", () => {
    const text = `| Pazartesi | Milonga Sol / Taksim | 21:00`;
    const result = weeklyGridRowRule(text, "Pazartesi", "tr");
    expect(result).toBeNull();
  });

  it("strategy 3 unchanged with filler word 've'", () => {
    const t = "Milonga Dos\nMartes y jueves, 21 hs.";
    const page = foldPage(t);
    const result = weeklyGridRule(page, t, "Milonga Dos", null, "es");
    expect(result).not.toBeNull();
    expect(result!.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(result!.written).toBe("Martes y jueves, 21 hs");
  });

  it("strategy 3 reads 've' between Turkish weekdays", () => {
    const t = "Milonga Üç\nSalı ve Perşembe";
    const result = weeklyGridRule(foldPage(t), t, "Milonga Üç", null, "tr");
    expect(result?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
  });

  it("'ve' between dance names is not a weekday line", () => {
    const t = "Kurs Bir\nSalsa ve Bachata";
    expect(weeklyGridRule(foldPage(t), t, "Kurs Bir", null, "tr")).toBeNull();
    expect(weeklyGridRowRule("Salsa ve Bachata | Kurs Bir | 20:00", "Kurs Bir", "tr")).toBeNull();
  });

  it("reads a Turkish weekday cell when the model reports English", () => {
    expect(weeklyGridRowRule(pageText, "Tango Mia Milonga", "en")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=TH,SA",
    );
    expect(weeklyGridRowRule(pageText, "Milonga 333", null)?.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
    const page = foldPage(pageText);
    expect(weeklyGridRule(page, pageText, "Armada Otel", null, "en")?.rrule).toBe(
      "FREQ=WEEKLY;BYDAY=MO",
    );
  });
});
