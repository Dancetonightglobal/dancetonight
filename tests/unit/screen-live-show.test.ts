// D-757: a live show billed as one ("*live", "World Tour", "TOUR 2026", "Live at the church") that starts before 10pm
// and ends by 00:30 (or names no end) is a concert on ANY source, RA included (Berlin 11-06: Club Gretchen
// "NORLYZ feat. MALIKA ALAOUI *live" 7:30pm-11pm, Huxley's "Overmono - Pure Devotion Live - World Tour").

import { describe, expect, it } from "vitest";

import { screenNoDance, screenTitle } from "@/src/domain/listing-screen";

const TZ = "Europe/Berlin";
const RA = {}; // RA's flags: not a mixed calendar

/** A Berlin listing on 2026-11-07 starting at hh:mm local (CET, UTC+1), ending at end (next day when < start). */
function row(title: string, hh: number | null, mm = 0, end?: [number, number] | null) {
  const startsAt = hh === null ? null : new Date(Date.UTC(2026, 10, 7, hh - 1, mm));
  let endsAt: Date | null = null;
  if (end) {
    const nextDay = hh !== null && end[0] < hh ? 1 : 0;
    endsAt = new Date(Date.UTC(2026, 10, 7 + nextDay, end[0] - 1, end[1]));
  }
  return { title, styles: ["dj_night"], startsAt, endsAt, nightDate: "2026-11-07", tz: TZ };
}

describe("screenNoDance: a billed live show before 10pm (D-757)", () => {
  it.each([
    row("NORLYZ feat. MALIKA ALAOUI *live", 19, 30, [23, 0]),
    row("NOAH X PETTER – DRIFT *live*", 20, 0, [23, 30]),
    row("TRUE LOVES *live", 20, 0, null),
    row("NILS PETTER MOLVÆR TRIO (live)", 20, 0, [22, 30]),
    row("Midwife (US) & Devin Shaffer (US) — Live at the church", 19, 0, null),
    row("KILIMANJARO live", 20, 0, [23, 0]),
    row("punktò (€URO TOUR 2026)", 20, 0, null),
    row("Overmono - Pure Devotion Live - World Tour", 19, 0, [23, 0]),
    row("Digitalism - OPTIMISM TOUR 2026", 20, 0, [0, 30]),
    row("Album Release Show: Kae Tempest", 21, 0, null),
  ])("screens $title", (listing) => {
    const result = screenNoDance(listing, RA);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("not_a_dance");
    expect(result!.reason).toContain("D-757");
  });

  it.each([
    // a club night with a live act runs late
    row("Overmono Live", 22, 0, [5, 0]),
    row("Mano Le Tough *live", 23, 0, null),
    row("Ben Klock, Dax J *live", 21, 0, [6, 0]),
    // ends after 00:30
    row("Digitalism - OPTIMISM TOUR 2026", 20, 0, [3, 0]),
    // untimed: nobody said it is a show
    row("TRUE LOVES *live", null),
    // a dance word or style in the title keeps it
    row("Salsa Live Band Tour 2026", 20, 0, [23, 0]),
    row("Swing Dance with the Hot Club *live", 20, 0, [23, 0]),
    row("Tango Tour: Milonga *live*", 20, 0, null),
    row("Disco Party *live", 20, 0, [23, 0]),
    // no live-show marker
    row("Deliver Us Tour Guide Night", 20, 0, [23, 0]),
    row("Livewire: Afro House", 20, 0, [23, 0]),
    row("Live and Direct: Dub Night", 20, 0, [23, 0]),
    row("Tourist", 20, 0, [23, 0]),
  ])("keeps $title", (listing) => {
    expect(screenNoDance(listing, RA)).toBeNull();
  });

  it("keeps a dance source's own live night (its styles are a dance)", () => {
    expect(
      screenNoDance({ ...row("Noches de Cuba Live", 20, 0, [23, 0]), styles: ["salsa"] }, RA),
    ).toBeNull();
  });

  it("still works without endsAt passed (old callers)", () => {
    const { endsAt: _e, ...noEnd } = row("TRUE LOVES *live", 20, 0, null);
    expect(screenNoDance(noEnd, RA)).not.toBeNull();
  });
});

describe("screenTitle: listening sessions and music talks (D-757)", () => {
  it.each([
    "Otis Mensah ... LISTENING SESSSION",
    "Listening Sessions Vol. 3",
    "Music Talk: Edition × Unkompress",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each(["Bachata Listening Session", "Talk Talk Tribute Disco", "Small Talk Club Night"])(
    "keeps %s",
    (title) => {
      expect(screenTitle(title)).toBeNull();
    },
  );
});
