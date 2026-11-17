// Turkish screen words: boats, cancellations, games, children's parties, seated shows (D-684)
import { describe, expect, it } from "vitest";
import { screenTitle, screenNoDance } from "@/src/domain/listing-screen";

const TZ = "Europe/Istanbul";
const NIGHT = "2026-11-06";
const at = (hour: number) => new Date(Date.UTC(2026, 10, 6, hour - 3)); // Istanbul is UTC+3
const listing = (title: string, hour = 20, styles: string[] = []) => ({
  title,
  styles,
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedSource = { mixedCalendar: true, styles: [] as string[] };

describe("Turkish boat parties (D-684)", () => {
  it.each(["Boğaz Tekne Partisi", "Vapurda Salsa Gecesi", "TEKNE PARTİSİ"])(
    "screens %s as boat_or_cruise",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "boat_or_cruise" });
    },
  );
});

describe("Turkish cancellations (D-684)", () => {
  it.each(["İPTAL", "İPTAL EDİLDİ", "Ertelendi"])("screens %s as closure", (title) => {
    expect(screenTitle(title)).toMatchObject({ kind: "closure" });
  });
});

describe("Turkish games nights (D-684)", () => {
  it.each(["Bilgi Yarışması Gecesi", "Kutu Oyunları Gecesi", "Tombala"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );
});

describe("Turkish children's parties and workshops (D-684)", () => {
  it.each(["Çocuklar için Cadılar Bayramı Partisi", "Çocuk Dans Atölyesi"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );
});

describe("Turkish titles kept (D-684)", () => {
  it.each(["Salsa Gecesi", "Bachata Partisi", "Bebek'te Tango Akşamı", "Cuma Dans Gecesi"])(
    "keeps %s",
    (title) => {
      expect(screenTitle(title)).toBeNull();
    },
  );
});

describe("Turkish seated shows screened by screenNoDance (D-684)", () => {
  it.each(["Caz Konseri", "Tiyatro: Hamlet", "Film Gösterimi", "Tango Üzerine Söyleşi"])(
    "screens %s",
    (title) => {
      expect(screenNoDance(listing(title), mixedSource)).not.toBeNull();
    },
  );
});

describe("Turkish dance nights kept by screenNoDance (D-684)", () => {
  it.each([
    ["Swing Dans Gecesi", 20, []],
    ["Latin Dans Partisi", 20, []],
    ["Halay Gecesi", 20, ["turkish_folk"]],
  ])("keeps %s", (title, hour, styles) => {
    expect(screenNoDance(listing(title, hour, styles), mixedSource)).toBeNull();
  });
});
