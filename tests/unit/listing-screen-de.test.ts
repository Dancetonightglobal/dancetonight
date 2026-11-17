// German screen words for Berlin: boats, cancellations, games, children's parties, seated shows (D-1021)
import { describe, expect, it } from "vitest";
import { screenTitle, screenNoDance } from "@/src/domain/listing-screen";

const TZ = "Europe/Berlin";
const NIGHT = "2026-11-06";
const at = (hour: number) => new Date(Date.UTC(2026, 10, 6, hour - 1)); // Berlin is UTC+1
const listing = (title: string, hour = 20, styles: string[] = []) => ({
  title,
  styles,
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedSource = { mixedCalendar: true, styles: [] as string[] };

describe("German boat parties (D-1021)", () => {
  it.each(["Bootsparty auf der Spree", "Salsa Bootsparty", "Schiffsparty mit DJ", "Dampferfahrt"])(
    "screens %s as boat_or_cruise",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "boat_or_cruise" });
    },
  );
});

describe("German cancellations (D-1021)", () => {
  it.each(["Abgesagt", "Entfällt", "Ausgefallen", "Verschoben", "Storniert"])(
    "screens %s as closure",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "closure" });
    },
  );
});

describe("German games nights (D-1021)", () => {
  it.each(["Spieleabend", "Brettspielabend", "Quizabend", "Kneipenquiz"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );
});

describe("German children's parties and workshops (D-1021)", () => {
  it.each(["Kinderdisco", "Kinderparty", "Kindertanz", "Kinderfest"])(
    "screens %s as not_dance_scope",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "not_dance_scope" });
    },
  );
});

describe("German titles kept (D-1021)", () => {
  it.each(["Salsa Tanzabend", "Bachata Party", "Tango Nacht", "Tanz in den Mai"])(
    "keeps %s",
    (title) => {
      expect(screenTitle(title)).toBeNull();
    },
  );
});

describe("German seated shows screened by screenNoDance (D-1021)", () => {
  it.each(["Konzert: Jazz Quartett", "Lesung mit Musik", "Filmvorführung", "Vortrag über Tanz"])(
    "screens %s",
    (title) => {
      expect(screenNoDance(listing(title), mixedSource)).not.toBeNull();
    },
  );
});

describe("German dance nights kept by screenNoDance (D-1021)", () => {
  it.each([
    ["Swing Tanzparty", 20, []],
    ["Tanzabend im Club", 20, []],
    ["Tanzkurs Salsa", 20, ["salsa"]],
  ])("keeps %s", (title, hour, styles) => {
    expect(screenNoDance(listing(title, hour, styles), mixedSource)).toBeNull();
  });
});

describe("German titles from the spec and English false friends (D-1021)", () => {
  it.each(["Kinderdisco", "Kneipentour Friedrichshain", "Spieleabend", "Quizabend im Club"])(
    "leaves out %s",
    (title) => {
      expect(screenTitle(title)).not.toBeNull();
    },
  );
  it.each([
    "Tanz in den Mai",
    "Swing Tanzparty",
    "Boot Scootin Boogie Line Dance Night",
    "Floss Dance Party",
    "A Different Kind of Party",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
  it("keeps a dance night in a cinema on a mixed calendar", () => {
    expect(screenNoDance(listing("Tanzabend im Kino Babylon", 21), mixedSource)).toBeNull();
  });
});

describe("German cancellations, coverage review (D-1021)", () => {
  it.each(["Fällt aus", "Fällt aus!", "Abgesagt"])(
    "screens %s as a cancellation-only title",
    (title) => {
      expect(screenTitle(title)).toMatchObject({ kind: "closure" });
    },
  );
  // A named night with a cancel word is not cancellation-only, like "Salsa Night cancelled" in English.
  it.each(["Salsa aus Kuba", "Verlegt: Bachata Party ins Yaam", "Salsa Night fällt aus"])(
    "keeps %s",
    (title) => {
      expect(screenTitle(title)).toBeNull();
    },
  );
});
