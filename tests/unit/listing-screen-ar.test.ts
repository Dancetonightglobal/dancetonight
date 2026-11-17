// Arabic screen words: boats, cancellations, games, children's parties, seated shows (D-1063)
import { describe, expect, it } from "vitest";
import { screenTitle, screenNoDance, hasDanceWord } from "@/src/domain/listing-screen";

const TZ = "Asia/Dubai";
const NIGHT = "2026-11-06";
const at = (hour: number) => new Date(Date.UTC(2026, 10, 6, hour - 4)); // Dubai is UTC+4
const listing = (title: string, hour = 20, styles: string[] = []) => ({
  title,
  styles,
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedSource = { mixedCalendar: true, styles: [] as string[] };

describe("Arabic boat parties (D-1063)", () => {
  it.each([
    "رحلة بحرية مع دي جي",
    "حفلة على اليخت",
    "Dhow Cruise Dinner Marina",
    "يخت خاص",
    "قارب للايجار",
  ])("screens %s as boat_or_cruise", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "boat_or_cruise" });
  });

  it("keeps Yacht Club Salsa (D-223)", () => {
    expect(screenTitle("Yacht Club Salsa")).toBeNull();
  });
});

describe("Arabic cancellations (D-1063)", () => {
  it.each(["ملغى", "تم إلغاء الحفل", "مؤجل", "ألغي", "تأجيل"])("screens %s as closure", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "closure" });
  });

  it("keeps تم افتتاح نادي سالسا (تم alone is not a cancellation)", () => {
    expect(screenTitle("تم افتتاح نادي سالسا")).toBeNull();
  });

  it("keeps سهرة سالسا", () => {
    expect(screenTitle("سهرة سالسا")).toBeNull();
  });
});

describe("Arabic karaoke (D-1063)", () => {
  it("screens ليلة كاريوكي as not_dance_scope", () => {
    expect(screenTitle("ليلة كاريوكي")).toMatchObject({ kind: "not_dance_scope" });
  });
});

describe("Arabic games nights (D-1063)", () => {
  it.each(["ليلة ألعاب", "بينغو", "تريفيا", "ألعاب لوحية"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );
});

describe("Arabic children's parties and workshops (D-1063)", () => {
  it.each(["حفلة أطفال", "ديسكو للأطفال", "سهرة الولاد", "ورشة أطفال", "ورشة اطفال"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );

  it("handles رقص للأطفال like Turkish test", () => {
    // Should be screened as not_dance_scope (children's workshop)
    expect(screenTitle("رقص للأطفال")).toMatchObject({ kind: "not_dance_scope" });
  });
});

describe("Arabic seated shows screened by screenNoDance (D-1063)", () => {
  it.each(["مسرحية كوميدية", "أمسية شعرية", "محاضرة عن الرقص الشرقي", "عرض فيلم", "ندوة", "مؤتمر"])(
    "screens %s",
    (title) => {
      expect(screenNoDance(listing(title), mixedSource)).not.toBeNull();
    },
  );
});

describe("Arabic dance nights kept by screenNoDance (D-1063)", () => {
  it.each([
    ["سهرة دبكة", 20, []],
    ["حفلة رقص", 20, []],
    ["ليلة رقص", 20, []],
  ])("keeps %s", (title, hour, styles) => {
    expect(screenNoDance(listing(title, hour, styles), mixedSource)).toBeNull();
  });

  it("keeps عروض خاصة ليلة رقص (dance word present)", () => {
    expect(screenNoDance(listing("عروض خاصة ليلة رقص"), mixedSource)).toBeNull();
  });
});

describe("hasDanceWord helper (D-1063)", () => {
  it("returns true for Arabic dance words", () => {
    expect(hasDanceWord("سهرة رقص")).toBe(true);
    expect(hasDanceWord("والرقص")).toBe(true);
    expect(hasDanceWord("رقصة")).toBe(true);
    expect(hasDanceWord("الرقص الشرقي")).toBe(true);
    expect(hasDanceWord("حفلة رَقْص")).toBe(true); // tashkeel folded by normalizeForMatch
  });

  it("returns false for non-dance Arabic", () => {
    expect(hasDanceWord("Salsa night")).toBe(false);
    expect(hasDanceWord("عرض")).toBe(false);
  });

  it("returns true for English dance words", () => {
    expect(hasDanceWord("Dance night")).toBe(true);
  });
});

describe("Regression: existing Turkish and English cases", () => {
  it("keeps Turkish Salsa Gecesi", () => {
    expect(screenTitle("Salsa Gecesi")).toBeNull();
  });

  it("screens English cancellation", () => {
    expect(screenTitle("CANCELLED")).toMatchObject({ kind: "closure" });
  });

  it("does not screen ألعاب نارية (fireworks) as games night", () => {
    expect(screenTitle("ألعاب نارية")).toBeNull();
  });
});
