import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { matchStyles } from "@/config/styles";

const TZ = "America/Chicago";
const NIGHT = "2026-11-06";
/** 8pm, 6pm or 9pm Central on Friday 2026-11-06 (CST, UTC-6). */
const at = (hour: number) => new Date(Date.UTC(2026, 10, 7, hour - 18));
const listing = (title: string, hour = 20) => ({
  title,
  styles: matchStyles(title).styles as string[],
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedOnly = { mixedCalendar: true, styles: [] as string[] };

describe("language classes, craft classes and castings screening on mixed calendars", () => {
  it.each([
    "Language • ADULT ITALIAN CLASSES",
    "Hands & Heritage: Italian Crochet Class",
    "Model Casting",
    "Spanish Conversation Group",
    "Corso di italiano",
    "Clases de francés",
    "Knit Night",
    "Open Auditions",
    "English Lesson",
  ])("screens %s", (title) => {
    const result = screenNoDance(listing(title), mixedOnly);
    expect(result).toMatchObject({
      kind: "not_dance_scope",
    });
    expect(result?.reason).toContain("language or craft class");
  });

  it.each([
    "Salsa & Spanish Classes",
    "Bachata Classes",
    "Italian Night with Tarantella Dancing",
    "Castillo Salsa Social",
    "Greek Night: Live Bouzouki and Dancing",
  ])("keeps %s", (title) => {
    const result = screenNoDance(listing(title), mixedOnly);
    // Either null or reason doesn't contain "language or craft class"
    if (result) {
      expect(result.reason).not.toContain("language or craft class");
    } else {
      expect(result).toBeNull();
    }
  });
});
