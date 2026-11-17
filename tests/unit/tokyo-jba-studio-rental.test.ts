// D-1244: Studio JBA's calendar lists its studio rental slots ("スタジオ貸し"), which are not dance nights
// (new-sources check 2026-11-12). Its notDanceNights screen them; its own dance nights stay.
import { describe, expect, it } from "vitest";

import { TOKYO_SOURCES } from "@/config/sources/tokyo";
import { screenNoDance } from "@/src/domain/listing-screen";

const seed = TOKYO_SOURCES.find((s) => s.url === "https://studiojba.com/schedule/");
const source = {
  mixedCalendar: seed?.mixedCalendar,
  styles: seed?.styles ?? [],
  danceNights: seed?.danceNights,
  notDanceNights: seed?.notDanceNights,
};
const at8pm = new Date(Date.UTC(2026, 10, 13, 11)); // 20:00 JST
const listing = (title: string) => ({
  title,
  styles: [] as string[],
  startsAt: at8pm,
  nightDate: "2026-11-13",
  tz: "Asia/Tokyo",
});

describe("Studio JBA studio rental (D-1244)", () => {
  it.each(["スタジオ貸し", "スタジオ貸し 19:00-21:00"])("screens %s", (title) => {
    expect(screenNoDance(listing(title), source)).not.toBeNull();
  });

  it.each(["4ダンサーズナイト", "SMILESALSA"])("keeps %s", (title) => {
    expect(screenNoDance(listing(title), source)).toBeNull();
  });
});
