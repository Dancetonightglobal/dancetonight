// D-124: the page-level dance gate, on Nebula's real events page (saved 2026-10-04) and on the
// shapes the 22 page-only pages of 2026-10-05 showed.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { danceGate, upcomingDates, GATE_VERSION } from "@/src/pipeline/discovery/gate";
import { visibleText } from "@/src/pipeline/discovery/site-probe";
import { awaitsGate } from "@/src/pipeline/discovery/candidates";

const NOW = new Date("2026-10-05T14:00:00Z");
const TZ = "America/New_York";
const gate = (
  text: string,
  group = "dance or salsa club",
  contentType: string | null = "text/html",
) => danceGate({ text, contentType, group, now: NOW, tz: TZ });

describe("upcomingDates", () => {
  it("reads the dates to come, with or without a year, and leaves past years out", () => {
    expect(
      upcomingDates(
        "October 6, 2026 11:00 PM · Oct. 9 · SEPTEMBER 25TH · Friday October 16, 2026 · October 8 , 2022 · November 8-11, 2018 · Nov 18th",
        "2026-10-05",
      ),
    ).toEqual(["2026-10-06", "2026-10-09", "2026-10-16", "2026-11-18"]);
  });
  it("takes a January date on a December page as next year's, and no February 31", () => {
    expect(upcomingDates("Jan 3 · February 31", "2026-12-20")).toEqual(["2027-01-03"]);
  });
  it("stops at the horizon", () => {
    expect(upcomingDates("October 9 · December 25", "2026-10-05")).toEqual(["2026-10-09"]);
  });
  it("reads numeric slash dates like 10/16, 10/16/2026, 10/16/26", () => {
    expect(upcomingDates("FRI_10/16 · SAT_10/17", "2026-10-16")).toEqual([
      "2026-10-16",
      "2026-10-17",
    ]);
    expect(upcomingDates("10/16/2026", "2026-10-15")).toEqual(["2026-10-16"]);
    expect(upcomingDates("1/2 price", "2026-10-16")).toEqual([]); // Jan 2 beyond horizon
    expect(upcomingDates("12:10/30", "2026-10-16")).toEqual([]); // not a date
  });
});

describe("languages and date order (D-514)", () => {
  const NOW = new Date("2026-10-05T14:00:00Z");

  it("reads Turkish month names", () => {
    expect(
      upcomingDates("7 Kasım Cuma · 14 KASIM 2026 · 11-12 Kasım · 3 Ekim", "2026-10-05", {
        languages: ["tr", "en"],
        countryCode: "TR",
      }),
    ).toEqual(["2026-11-07", "2026-11-11", "2026-11-14"]);
  });

  it("never reads a year's last digits as a day (2026 Kasım)", () => {
    expect(
      upcomingDates("2026 Kasım programı", "2026-10-05", { languages: ["tr"], countryCode: "TR" }),
    ).toEqual([]);
  });

  it("reads Spanish month names", () => {
    expect(
      upcomingDates("3 de noviembre · 10 de noviembre de 2026", "2026-10-05", {
        languages: ["es"],
        countryCode: "ES",
      }),
    ).toEqual(["2026-11-03", "2026-11-10"]);
  });

  it("reads D/M numeric dates for non-US", () => {
    expect(upcomingDates("3/11", "2026-10-05", { languages: ["es"], countryCode: "ES" })).toEqual([
      "2026-11-03",
    ]);
    expect(upcomingDates("3/11", "2026-10-05", { languages: ["tr"], countryCode: "TR" })).toEqual([
      "2026-11-03",
    ]);
  });

  it("keeps M/D for US and PR", () => {
    expect(
      upcomingDates("11/3", "2026-10-05", { languages: ["es", "en"], countryCode: "PR" }),
    ).toEqual(["2026-11-03"]);
    expect(upcomingDates("11/3", "2026-10-05")).toEqual(["2026-11-03"]);
  });

  it("reads dotted D.M.YYYY only with 4-digit year", () => {
    expect(
      upcomingDates("07.11.2026 · 22.00 · 20.30 · 21.30-02.00", "2026-10-05", {
        languages: ["tr"],
        countryCode: "TR",
      }),
    ).toEqual(["2026-11-07"]);
    expect(
      upcomingDates("22.00 20.30", "2026-10-05", { languages: ["tr"], countryCode: "TR" }),
    ).toEqual([]);
  });

  it("detects Turkish weekly nights via recurrence parser", () => {
    const verdict = danceGate({
      text: "Salsa Gecesi her Cuma 22.00",
      contentType: "text/html",
      group: "dance or salsa club",
      now: NOW,
      tz: "Europe/Istanbul",
      languages: ["tr", "en"],
      countryCode: "TR",
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.weekly.some((w) => w.includes("her cuma"))).toBe(true);
  });

  it("detects Turkish 'günleri' weekly", () => {
    const verdict = danceGate({
      text: "Bachata: Salı günleri",
      contentType: "text/html",
      group: "dance or salsa club",
      now: NOW,
      tz: "Europe/Istanbul",
      languages: ["tr", "en"],
      countryCode: "TR",
    });
    expect(verdict.weekly.some((w) => w.includes("sali gunleri"))).toBe(true);
  });

  it("ignores monthly forms", () => {
    const verdict = danceGate({
      text: "ayın ilk Cuması milonga",
      contentType: "text/html",
      group: "dance or salsa club",
      now: NOW,
      tz: "Europe/Istanbul",
      languages: ["tr", "en"],
      countryCode: "TR",
    });
    expect(verdict.weekly).toEqual([]);
  });

  it("detects Spanish weekly nights", () => {
    const verdict = danceGate({
      text: "Salsa todos los jueves",
      contentType: "text/html",
      group: "dance or salsa club",
      now: NOW,
      tz: "Europe/Madrid",
      languages: ["es"],
      countryCode: "ES",
    });
    expect(verdict.weekly.some((w) => w.includes("todos los jueves"))).toBe(true);
    expect(verdict.pass).toBe(true);
  });

  it("detects Portuguese weekly nights", () => {
    const verdict = danceGate({
      text: "Forró às quintas-feiras",
      contentType: "text/html",
      group: "dance or salsa club",
      now: NOW,
      tz: "Europe/Lisbon",
      languages: ["pt"],
      countryCode: "PT",
    });
    expect(verdict.weekly.length).toBeGreaterThan(0);
    expect(verdict.weekly.some((w) => w.includes("quintas"))).toBe(true);
    expect(verdict.pass).toBe(true);
  });

  it("reads styles from Turkish text", () => {
    const verdict = danceGate({
      text: "Tango Gecesi · 7 Kasım · 14 Kasım",
      contentType: "text/html",
      group: "music or event venue",
      now: NOW,
      tz: "Europe/Istanbul",
      languages: ["tr"],
      countryCode: "TR",
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.families.length).toBeGreaterThan(0);
  });

  it("fails without dance style for non-club group", () => {
    const verdict = danceGate({
      text: "Konser 7 Kasım · 14 Kasım",
      contentType: "text/html",
      group: "music or event venue",
      now: NOW,
      tz: "Europe/Istanbul",
      languages: ["tr"],
      countryCode: "TR",
    });
    expect(verdict.pass).toBe(false);
  });

  it("handles large text quickly", () => {
    const longText = "Salı Cuma Pazar cumartesi her hafta ".repeat(6000);
    const start = performance.now();
    const verdict = danceGate({
      text: longText,
      contentType: "text/html",
      group: "dance or salsa club",
      now: NOW,
      tz: "Europe/Istanbul",
      languages: ["tr"],
      countryCode: "TR",
    });
    const end = performance.now();
    expect(end - start).toBeLessThan(500); // ~30-70 ms on the Mac; headroom for a loaded CI runner
    expect(verdict.weekly.length).toBeLessThanOrEqual(7);
  });

  it("GATE_VERSION is 4", () => {
    expect(GATE_VERSION).toBe(4);
  });
});

describe("awaitsGate", () => {
  it("returns true for page_only, not enabled, gated false", () => {
    const source = { enabled: false, status: "page_only", gated: false };
    expect(awaitsGate({ url: "https://x.example/", ...source })).toBe(true);
  });
  it("returns true for gatePass false and version < GATE_VERSION", () => {
    const source = {
      enabled: false,
      status: "page_only",
      gated: true,
      gatePass: false,
      gateVersion: 1,
    };
    expect(awaitsGate({ url: "https://x.example/", ...source })).toBe(true);
  });
  it("returns false for gatePass false but version equals GATE_VERSION", () => {
    const source = {
      enabled: false,
      status: "page_only",
      gated: true,
      gatePass: false,
      gateVersion: GATE_VERSION,
    };
    expect(awaitsGate({ url: "https://x.example/", ...source })).toBe(false);
  });
  it("returns false for gatePass true", () => {
    const source = {
      enabled: false,
      status: "page_only",
      gated: true,
      gatePass: true,
      gateVersion: 1,
    };
    expect(awaitsGate({ url: "https://x.example/", ...source })).toBe(false);
  });
});

describe("danceGate", () => {
  it("passes Nebula's events page, whose nights name no style", () => {
    const fixture = JSON.parse(
      readFileSync(
        path.join(__dirname, "fixtures/discovery/www-nebulanewyork-com-events-cdfe81bb2e.json"),
        "utf8",
      ),
    ) as { response: { body: string } };
    const verdict = gate(visibleText(fixture.response.body));
    expect(verdict.pass).toBe(true);
    expect(verdict.dates.slice(0, 3)).toEqual(["2026-10-06", "2026-10-09", "2026-10-10"]);
    expect(verdict.reason).toMatch(/dates to come on a dance club's page$/);
  });

  it("passes a weekly night", () => {
    // As club51nyc.com/events wrote it on 2026-10-05.
    const verdict = gate(
      "Thursdays After Work Mix Tickets Fridays Y2K Party Fridays Saturdays Latin Mix Saturdays",
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.weekly).toEqual(["thursdays", "fridays", "saturdays"]);
  });

  it("holds a page with one date or none", () => {
    expect(gate("Fri Oct 9: Disco night").reason).toBe("one date to come, no weekly night");
    expect(gate("Upcoming events. Follow us on Instagram.").pass).toBe(false);
  });

  it("holds a past-years archive (furball.nyc's)", () => {
    expect(
      gate("October 8 , 2022 FURBALL BOSTON · November 8-11, 2018 Key West Bear Weekend").pass,
    ).toBe(false);
  });

  it("asks any other group to name a dance as well", () => {
    const brunch = "Saturday, October 10, 2026 Brunch · Saturday, October 17, 2026 Brunch";
    expect(gate(brunch, "lounge").reason).toBe("2 dates to come, but the page names no dance");
    expect(gate(`${brunch} · Salsa night Friday, October 9, 2026`, "lounge").pass).toBe(true);
  });
  it("passes a lounge page with two dates and DJ word", () => {
    const text = "Friday, October 9, 2026 DJ Ellen · Saturday, October 10, 2026 Resident DJ";
    const verdict = gate(text, "lounge");
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toMatch(/dates to come, and the page lists DJ nights/);
  });
  it("passes a music venue page that names DJs, which the style list reads as club nights", () => {
    const text = "Friday, October 9, 2026 DJ Ellen · Saturday, October 10, 2026 Resident DJ";
    expect(gate(text, "music or event venue").pass).toBe(true);
  });

  it("never passes a studio's timetable or a PDF", () => {
    expect(gate("Salsa Mondays · Bachata Tuesdays", "dance studio").pass).toBe(false);
    expect(gate("Salsa level 1 · October 9, 2026 · October 16, 2026", "dance studio").reason).toBe(
      "a dance studio's class timetable (deferred)",
    );
    expect(gate("October 9 · October 10", "dance or salsa club", "application/pdf").reason).toBe(
      "not a web page (application/pdf)",
    );
  });

  it("passes a studio page with socials and two dates", () => {
    const verdict = gate(
      "Friday Social 8-11pm · October 9, 2026 · October 16, 2026",
      "dance studio",
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("lists socials");
  });

  it("passes a community or social club page with generic dance word", () => {
    const verdict = gate(
      "Israeli Folk Dancing every Wednesday 7-9pm · October 9, 2026 · October 16, 2026",
      "community or social club",
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("names dancing");
  });

  it("passes a music or event venue page with DJ nights", () => {
    const verdict = gate(
      "Kompa night with DJ Fresh · October 9, 2026 · October 16, 2026 · October 23, 2026",
      "music or event venue",
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("lists DJ nights");
  });

  it("fails a community page with bingo and no dance", () => {
    const verdict = gate(
      "Bingo night · Trivia · October 9, 2026 · October 16, 2026",
      "community or social club",
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("names no dance");
  });

  it("does not match 'dance' inside other words", () => {
    const verdict = gate(
      "abundance of guidance · October 9, 2026 · October 16, 2026",
      "music or event venue",
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reason).toContain("names no dance");
  });

  it("passes Spanish event venue page with 'baile'", () => {
    const verdict = danceGate({
      text: "7 de noviembre Gran baile · 14 de noviembre Gran baile",
      contentType: "text/html",
      group: "music or event venue",
      now: NOW,
      tz: "America/Argentina/Buenos_Aires",
      languages: ["es"],
      countryCode: "AR",
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("names dancing");
  });

  it("passes Turkish page with 'dansı'", () => {
    const verdict = danceGate({
      text: "7 Kasım dansı · 14 Kasım dansı",
      contentType: "text/html",
      group: "music or event venue",
      now: NOW,
      tz: "Europe/Istanbul",
      languages: ["tr"],
      countryCode: "TR",
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("names dancing");
  });

  it("passes Chinese page with '舞會'", () => {
    const verdict = gate("October 9, 2026 舞會 · October 16, 2026 舞會", "music or event venue");
    expect(verdict.pass).toBe(true);
    expect(verdict.reason).toContain("names dancing");
  });
});
