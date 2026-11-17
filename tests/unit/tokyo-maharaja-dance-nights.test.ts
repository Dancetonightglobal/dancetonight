// D-1243: MAHARAJA Roppongi is a disco, not a mixed calendar. As one, its own nights that name no dance were
// screened as concerts (read 43111991277, 2026-11-11: "BLACK HOLE", "SOUL STEP NIGHT", "MAHARAJA 16th
// Anniversary DAY4"). Its metal night is listed in notDanceNights; private hires are screened by title.
import { describe, expect, it } from "vitest";

import { TOKYO_SOURCES } from "@/config/sources/tokyo";
import { screenNoDance, screenTitle } from "@/src/domain/listing-screen";

const seed = TOKYO_SOURCES.find((s) => s.url === "https://maharaja-r.jp/schedule2/");
const source = {
  mixedCalendar: seed?.mixedCalendar,
  styles: seed?.styles ?? [],
  danceNights: seed?.danceNights,
  notDanceNights: seed?.notDanceNights,
};
const at7pm = new Date(Date.UTC(2026, 10, 23, 10)); // 19:00 JST
const listing = (title: string) => ({
  title,
  styles: [] as string[],
  startsAt: at7pm,
  nightDate: "2026-11-23",
  tz: "Asia/Tokyo",
});

describe("MAHARAJA Roppongi (D-1243)", () => {
  it("is not a mixed calendar", () => {
    expect(seed?.mixedCalendar).toBeUndefined();
  });

  it.each([
    "BLACK HOLE",
    "SOUL STEP NIGHT",
    "MAHARAJA 16th Anniversary DAY4",
    "MAHARAJA NIGHT",
    "DISCO 80's",
    "歌謡曲ナイト",
    "GLOBAL MIX",
  ])("keeps %s at 7pm", (title) => {
    expect(screenNoDance(listing(title), source)).toBeNull();
  });

  it("screens its heavy metal night", () => {
    expect(screenNoDance(listing("HEAVY METAL NIGHT"), source)).not.toBeNull();
    expect(screenNoDance(listing("HEAVY METAL NIGHT vol.3"), source)).not.toBeNull();
  });

  it("screens a private hire by its title", () => {
    expect(screenTitle("本日貸切")).not.toBeNull();
  });
});
