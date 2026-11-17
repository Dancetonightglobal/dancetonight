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

describe("slow jams are not music jams", () => {
  it.each(["R&B & Slow Jams", "Slow Jams Night", "Slow Jam Party"])(
    "keeps slow jam %s",
    (title) => {
      const result = screenNoDance(listing(title), mixedOnly);
      // Either null (kept) or not rejected as a music jam
      if (result !== null) {
        expect(result.reason).not.toContain("music jam");
      }
    },
  );

  it("still rejects music jam when slow jam is separate", () => {
    const result = screenNoDance(listing("Slow Jams & Jam Session with Live Band"), mixedOnly);
    expect(result).toMatchObject({
      kind: "not_dance_scope",
    });
    expect(result?.reason).toContain("music jam");
  });
});

describe("dancers-welcome jams are dance jams", () => {
  it.each([
    "Els Dimarts Manouche: concert i jam sessions; ballarins benvinguts!",
    "Jazz jam, dancers welcome",
    "Jam session - dancers are welcome",
    "Open jam, all dancers welcome",
  ])("keeps dancers-welcome jam %s", (title) => {
    const result = screenNoDance(listing(title), mixedOnly);
    // Either null (kept) or not rejected as a music jam
    if (result !== null) {
      expect(result.reason).not.toContain("music jam");
    }
  });
});

describe("language lessons and business breakfasts are not dances", () => {
  it.each([
    "English Lesson",
    "English Lessons",
    "English Class",
    "English Classes",
    "Clases de inglés",
    "Aula de inglês",
    "Classe d'anglès",
    "Desayuno Emprendedor",
    "Desayunos Emprendedores",
    "Desayuno de Emprendedores",
    "Business Breakfast",
    "Networking Breakfast",
  ])("screens %s as not dance scope", (title) => {
    expect(screenNoDance(listing(title), mixedOnly)).toMatchObject({
      kind: "not_dance_scope",
      reason: /language lesson or business breakfast/,
    });
  });

  it.each(["English Country Dance", "Salsa Social & English Lesson"])(
    "keeps %s (names a dance)",
    (title) => {
      const result = screenNoDance(listing(title), mixedOnly);
      if (result !== null) {
        expect(result.reason).not.toContain("language lesson");
      }
    },
  );
});

describe("music jam screening still works", () => {
  it.each(["Open Jam", "Sunday Jams", "Jam Session with Live Band"])(
    "screens music jam %s",
    (title) => {
      expect(screenNoDance(listing(title), mixedOnly)).toMatchObject({
        kind: "not_dance_scope",
        reason: /music jam/,
      });
    },
  );

  it.each(["Contact Jam", "Swing Jam"])("keeps dance jam %s", (title) => {
    expect(screenNoDance(listing(title), mixedOnly)).toBeNull();
  });
});
