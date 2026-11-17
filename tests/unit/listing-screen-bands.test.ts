import { describe, expect, it } from "vitest";
import { screenNoDance, screenStoredRow, screenUnlistedUntimed } from "@/src/domain/listing-screen";
import { typeForSource } from "@/src/pipeline/normalize";

// D-341: a dance-floor venue whose bands play for dancers (New Orleans' band bars). Its band
// billings are live music with dancing, not concerts, but only on a venue's whole calendar.

const TZ = "America/Chicago";
const NIGHT = "2026-11-06";
/** 8pm, 6pm or 9pm Central on Friday 2026-11-06 (CST, UTC-6). */
const at = (hour: number) => new Date(Date.UTC(2026, 10, 7, hour - 18));
const listing = (title: string, hour = 20) => ({
  title,
  styles: [] as string[],
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const flagged = { mixedCalendar: true, bandsForDancers: true, styles: [] as string[] };
const mixedOnly = { mixedCalendar: true, styles: [] as string[] };

describe("bandsForDancers on a mixed calendar (D-341)", () => {
  it.each([
    ["Treme Brass Band", 20],
    ["Kermit Ruffins & the BBQ Swingers", 20],
    ["Panorama Jazz Band", 18],
    ["Shotgun Jazz Band", 21],
  ])("keeps the band billing %s", (title, hour) => {
    expect(screenNoDance(listing(title, hour), flagged)).toBeNull();
  });

  it("still screens the same billings on an unflagged venue calendar (today's rule)", () => {
    expect(screenNoDance(listing("Treme Brass Band"), mixedOnly)).not.toBeNull();
    expect(screenNoDance(listing("Kermit Ruffins & the BBQ Swingers"), mixedOnly)).not.toBeNull();
  });

  it.each([
    "Film screening: Satchmo at the Waldorf",
    "Jazz Fest documentary premiere",
    "Tribute theater performance",
  ])("still screens the seated show %s", (title) => {
    expect(screenNoDance(listing(title, 19), flagged)).not.toBeNull();
  });

  it.each([
    "Tributo a Fonseca",
    "Concierto de salsa en vivo",
    "Gran show tropical",
    "Show en vivo: La Sonora",
  ])("keeps the music billing %s (D-228's concert words are band nights here)", (title) => {
    expect(screenNoDance(listing(title), flagged)).toBeNull();
  });

  it.each([
    "Open mic night",
    "Stand up comedy showcase",
    "Recital: piano students",
    "Pelicula: Buena Vista",
  ])("still screens the seated show %s", (title) => {
    expect(screenNoDance(listing(title, 19), flagged)).not.toBeNull();
  });

  it("still screens wellness sessions and worship nights", () => {
    expect(screenNoDance(listing("Sound bath with crystal bowls", 19), flagged)).not.toBeNull();
    expect(screenNoDance(listing("Sunday worship night", 19), flagged)).not.toBeNull();
  });

  it("keeps a named dance on a flagged venue as before", () => {
    expect(screenNoDance(listing("Swing dance lesson and social"), flagged)).toBeNull();
  });
});

describe("every screen pass reads the flag the same way (D-341)", () => {
  it("a flagged band row survives the retire pass", () => {
    expect(screenStoredRow(listing("Treme Brass Band"), flagged)).toBeNull();
    expect(screenStoredRow(listing("Treme Brass Band"), mixedOnly)).not.toBeNull();
  });

  it("the retire pass still screens titles that name no event", () => {
    expect(screenStoredRow(listing("Karaoke night"), flagged)).not.toBeNull();
  });

  it("an untimed band row is not retired as a show on a flagged venue (D-167)", () => {
    const untimed = { ...listing("Treme Brass Band"), startsAt: null };
    expect(screenUnlistedUntimed(untimed, flagged)).toBeNull();
    expect(screenUnlistedUntimed(untimed, mixedOnly)).not.toBeNull();
  });
});

describe("bandsForDancers without mixedCalendar changes nothing (D-341)", () => {
  it("screens nothing, as every non-mixed source does", () => {
    const onlyFlag = { bandsForDancers: true, styles: [] as string[] };
    expect(screenNoDance(listing("Treme Brass Band"), onlyFlag)).toBeNull();
    expect(screenNoDance(listing("Film screening: Satchmo", 19), onlyFlag)).toBeNull();
  });

  it("leaves the type alone", () => {
    expect(typeForSource("Treme Brass Band", "other", { bandsForDancers: true })).toBe("other");
  });
});

describe("typeForSource (D-341)", () => {
  it("types a flagged venue's band billing as live music with dancing", () => {
    expect(typeForSource("Treme Brass Band", "other", flagged)).toBe("live_music_with_dancing");
  });

  it("keeps a kind the title or page names", () => {
    expect(typeForSource("Swing lesson with the Shotgun Jazz Band", "class", flagged)).toBe(
      "class",
    );
    expect(typeForSource("Zydeco night", "social", flagged)).toBe("social");
    expect(typeForSource("Bounce night", "club_night", flagged)).toBe("club_night");
  });

  it("is typeFromTitle on any other source", () => {
    expect(typeForSource("Treme Brass Band", "other", mixedOnly)).toBe("other");
    expect(typeForSource("Treme Brass Band", "other", {})).toBe("other");
  });
});
