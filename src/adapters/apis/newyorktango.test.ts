// New York Tango's data files (D-133). The files are newyorktango.com's own of 2026-10-05, saved
// with venues.csv's door-code columns blanked.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  clock,
  NEWYORKTANGO_FILES,
  newYorkTangoAdapter,
  parseCsv,
  rruleOf,
  tangoToListings,
} from "@/src/adapters/apis/newyorktango";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { mayRun } from "@/src/pipeline/runner";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";
import { expandRecurrence, normalizeListing } from "@/src/pipeline/normalize";

const F = path.join(__dirname, "__fixtures__/newyorktango");
const FILES = {
  recurring: readFileSync(path.join(F, "events-recurring.csv"), "utf8"),
  manual: readFileSync(path.join(F, "events-manual.csv"), "utf8"),
  venues: readFileSync(path.join(F, "venues.csv"), "utf8"),
};
const NOW = new Date("2026-10-05T16:00:00Z"); // Monday, noon in New York
const TONIGHT = "2026-10-05";
const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 40,
  tz: "America/New_York",
  languages: ["en"],
};
const SOURCE: Source = {
  id: "s",
  url: "https://newyorktango.com/",
  kind: "platform_api",
  trustTier: "directory",
  platform: "newyorktango",
  feedUrl: null,
  metroId: "m",
  styles: ["milonga"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

/** Every night the files give in the window, as the pipeline would write them. */
function nights(files = FILES) {
  const read = tangoToListings(files, { metro: NYC, fetchedAt: NOW, fromNight: TONIGHT });
  const events = read.listings.flatMap((l) =>
    expandRecurrence(l, TONIGHT, NYC.tz).listings.map((one) => {
      const o = normalizeListing(one, { metro: NYC, source: SOURCE, now: NOW });
      if (!o.ok) throw new Error(`${one.listing.title}: ${o.reason}`);
      return o.event;
    }),
  );
  return { events, notes: read.notes };
}

const header =
  "title,type,venueId,recurrenceRule,recurrenceStartDate,recurrenceEndDate,startTime,endTime,admission,hasClass,classDetail,host,isActive";
const VENUES =
  "venueId,name,address,venueArea,latitude,longitude\n" +
  "studio,Studio,1 Main St,NYC,40.73,-73.99\n" +
  "jersey,Jersey Hall,9 Elm St,NJ & Metro,40.72,-74.08\n";

describe("reading the files", () => {
  it("parses quoted fields with commas, doubled quotes and line breaks", () => {
    expect(parseCsv('a,b\n"x, ""y""","line one\nline two"\n\n')).toEqual([
      { a: 'x, "y"', b: "line one\nline two" },
    ]);
  });

  it("reads the site's clock times", () => {
    expect(["7:00p", "12:00a", "12:30p", "11:30a", "6p", "25:00p", ""].map(clock)).toEqual([
      "19:00",
      "00:00",
      "12:30",
      "11:30",
      "18:00",
      null,
      null,
    ]);
  });

  it("turns each rule it understands into an RRULE, and the rest into nothing", () => {
    // 2026-08-02 is a Sunday.
    expect(rruleOf("weekly", "2026-08-02", null)).toBe("FREQ=WEEKLY;BYDAY=SU");
    // UNTIL is 05:59:59 New York time the morning after the end date (10:00 UTC less a second
    // in EDT), so a 9pm series keeps its last night.
    expect(rruleOf("biweekly", "2026-08-02", "2026-10-12")).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;UNTIL=20261013T095959Z",
    );
    expect(rruleOf("monthly:1,3:sunday", "2026-08-02", null)).toBe("FREQ=MONTHLY;BYDAY=1SU,3SU");
    expect(rruleOf("monthly:1,2,3,last:tuesday", "2026-08-02", null)).toBe(
      "FREQ=MONTHLY;BYDAY=1TU,2TU,3TU,-1TU",
    );
    // "monthly:4" names no weekday: the 4th of the month, or the 4th Sunday? Not guessed.
    expect(rruleOf("monthly:4", "2026-08-02", null)).toBeNull();
    expect(rruleOf("", "2026-08-02", null)).toBeNull();
    expect(rruleOf("monthly:9:sunday", "2026-08-02", null)).toBeNull();
  });
});

describe("New York Tango's files of 2026-10-05", () => {
  const { events, notes } = nights();

  it("lists 56 tango nights in the boroughs over the 14 nights from tonight", () => {
    // 56 on, and one cancelled: the night Esa! Milonga moved away from.
    expect(events.filter((e) => !e.cancelled)).toHaveLength(56);
    expect(events.filter((e) => e.cancelled).map((e) => [e.title, e.nightDate])).toEqual([
      ["Esa! Milonga", "2026-10-09"],
    ]);
    const perNight = new Map<string, number>();
    for (const e of events) perNight.set(e.nightDate, (perNight.get(e.nightDate) ?? 0) + 1);
    expect([...perNight.keys()].sort()).toHaveLength(14);
    expect(Math.min(...perNight.values())).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.styles.every((s) => s === "milonga" || s === "practica"))).toBe(
      true,
    );
  });

  it("names every row it leaves out: rules it cannot read, and the New Jersey series", () => {
    expect(notes.filter((n) => n.includes("does not understand"))).toEqual([
      'a series with a rule this reader does not understand was left out: Milonga del Barrio ("monthly:4")',
      'a series with a rule this reader does not understand was left out: Tango Práctica ("no rule")',
      'a series with a rule this reader does not understand was left out: Red Bank Tango at Reckless Estate ("no rule")',
      'a series with a rule this reader does not understand was left out: Tango Tuesdays ("no rule")',
      'a series with a rule this reader does not understand was left out: Argentine Tango Lovers Milonga ("monthly:4")',
    ]);
    expect(notes.find((n) => n.includes("five boroughs"))).toMatch(/^19 left out as outside/);
    expect(events.some((e) => /Red Bank|Firehouse/.test(e.title))).toBe(false);
  });

  it("starts a milonga at its dancing, after the class before it", () => {
    // El Destino: class 6-7pm, then the milonga at 7pm (EDT, so 23:00 UTC).
    const destino = events.find((e) => e.title === "El Destino")!;
    expect(destino.startsAt?.toISOString()).toBe("2026-10-11T23:00:00.000Z");
    expect(destino.lessonAt?.toISOString()).toBe("2026-10-11T22:00:00.000Z");
    expect(destino.doorsAt).toBeNull();
  });

  it("moves a night an update moves, once: Esa! Milonga from 10/9 to 10/16", () => {
    const esa = events.filter((e) => e.title === "Esa! Milonga");
    // The old night is written as cancelled, so a row stored before the move says so.
    expect(esa.filter((e) => e.nightDate === "2026-10-09").map((e) => e.cancelled)).toEqual([true]);
    expect(esa.filter((e) => e.nightDate === "2026-10-16" && !e.cancelled)).toHaveLength(1);
  });

  it("adds a one-off night the manual file adds", () => {
    expect(events.find((e) => e.title === "Live at Pinky Swear")).toMatchObject({
      nightDate: "2026-10-13",
      listingType: "social",
    });
  });
});

describe("the manual file's cancellations and moves, on built rows", () => {
  const recurring = `${header}\nSunday Milonga,Milonga,studio,weekly,2026-08-02,,7:00p,11:00p,$20,,,Ana,true\nJersey Practica,Practica,jersey,weekly,2026-08-03,,8:00p,10:00p,,,,the owner,true\n`;
  const manual =
    "mode,date,newDate,title,type,venueId,startTime,endTime\n" +
    "cancel,2026-10-11,,Sunday Milonga,Milonga,studio,,\n" +
    "update,2026-10-18,2026-10-17,Sunday Milonga,Milonga,studio,9:00p,1:00a\n" +
    "cancel,2026-10-12,,Unknown Series,Milonga,nowhere,,\n";
  const { events, notes } = nights({ recurring, manual, venues: VENUES });

  it("shows a cancelled night as cancelled, and moves a moved one", () => {
    expect(
      events.map((e) => [e.title, e.nightDate, e.cancelled, e.startsAt?.toISOString() ?? null]),
    ).toEqual([
      ["Sunday Milonga", "2026-10-11", true, "2026-10-11T23:00:00.000Z"],
      // Saturday at 9pm, the update's own time; the series' 10/18 night is cancelled.
      ["Sunday Milonga", "2026-10-17", false, "2026-10-18T01:00:00.000Z"],
      ["Sunday Milonga", "2026-10-18", true, "2026-10-18T23:00:00.000Z"],
    ]);
    expect(events.find((e) => e.title === "Sunday Milonga")?.prices.map((p) => p.amount)).toEqual([
      20,
    ]);
  });

  it("names a cancellation it cannot match and a series outside the boroughs", () => {
    expect(notes).toContain(
      "a cancellation names no series it could be matched to: Unknown Series on 2026-10-12",
    );
    expect(notes).toContain(
      "1 left out as outside New York's five boroughs (D-084): Jersey Practica (every night of its series)",
    );
  });
});

describe("the review's cases (2026-10-05)", () => {
  it("keeps a late series' last night, the end date's", () => {
    const recurring = `${header}\nLate Milonga,Milonga,studio,weekly,2026-10-05,2026-10-12,9:00p,1:00a,,,,,true\n`;
    const { events } = nights({ recurring, manual: "mode,date,title\n", venues: VENUES });
    expect(events.map((e) => e.nightDate)).toEqual(["2026-10-05", "2026-10-12"]);
  });

  it("tells apart one title's series at one venue by weekday, and edits the right one", () => {
    // 2026-10-05 is a Monday, 2026-10-06 a Tuesday.
    const recurring =
      `${header}\n` +
      "Tango on Hudson,Milonga,studio,weekly,2026-10-05,,7:00p,10:00p,,,,,true\n" +
      "Tango on Hudson,Milonga,studio,weekly,2026-10-06,,7:00p,10:00p,,,,,true\n";
    const manual =
      "mode,date,newDate,title,venueId\n" + "update,2026-10-12,2026-10-13,Tango on Hudson,studio\n";
    const read = tangoToListings(
      { recurring, manual, venues: VENUES },
      { metro: NYC, fetchedAt: NOW, fromNight: TONIGHT },
    );
    const ids = read.listings.filter((l) => l.recurrence).map((l) => l.externalId);
    expect(new Set(ids).size).toBe(2);
    const { events } = nights({ recurring, manual, venues: VENUES });
    const on = (night: string) =>
      events.filter((e) => e.nightDate === night).map((e) => e.cancelled);
    // Monday 10/12 moved to Tuesday 10/13: the Monday night is cancelled, Tuesday has one.
    expect(on("2026-10-12")).toEqual([true]);
    expect(on("2026-10-13")).toEqual([false]);
  });

  it("keeps two one-off nights of one title at two venues apart", () => {
    const manual =
      "mode,date,title,venueId,startTime\n" +
      "add,2026-10-10,Pop-up Milonga,studio,8:00p\n" +
      "add,2026-10-10,Pop-up Milonga,annex,8:00p\n";
    const venues = `${VENUES}annex,Annex,2 Main St,NYC,40.74,-73.98\n`;
    const read = tangoToListings(
      { recurring: `${header}\n`, manual, venues },
      { metro: NYC, fetchedAt: NOW, fromNight: TONIGHT },
    );
    expect(read.listings.map((l) => l.externalId)).toEqual([
      "nyt:add:pop-up-milonga:studio:2026-10-10",
      "nyt:add:pop-up-milonga:annex:2026-10-10",
    ]);
  });

  it("writes no cancelled night for a series it never lists", () => {
    const recurring = `${header}\nOdd Milonga,Milonga,studio,monthly:4,2026-08-02,,7:00p,10:00p,,,,,true\n`;
    const manual = "mode,date,title,venueId\ncancel,2026-10-11,Odd Milonga,studio\n";
    const { events } = nights({ recurring, manual, venues: VENUES });
    expect(events).toEqual([]);
  });
});

describe("the adapter", () => {
  it("is on by default (D-084 question 1) and needs no key", () => {
    expect(mayRun(newYorkTangoAdapter, NYC, {})).toEqual({ run: true });
  });

  it("reads robots.txt, then the three files, and says unchanged when nothing changed", async () => {
    const ctx = (seen: string[]): RunCtx => {
      let t = NOW.getTime();
      return {
        metro: NYC,
        now: () => new Date(t),
        env: {},
        log: () => {},
        http: createPoliteHttp({
          userAgent: "DanceTonightBot/1.0",
          now: () => t,
          sleep: async (ms) => void (t += ms),
          transport: async (req: TransportRequest) => {
            seen.push(req.url);
            const body =
              req.url === NEWYORKTANGO_FILES.recurring
                ? FILES.recurring
                : req.url === NEWYORKTANGO_FILES.manual
                  ? FILES.manual
                  : req.url === NEWYORKTANGO_FILES.venues
                    ? FILES.venues
                    : "User-Agent: *\nAllow: /\nDisallow: /admin\n";
            return { url: req.url, status: 200, headers: {}, body };
          },
        }),
      };
    };
    const seen: string[] = [];
    const first = await newYorkTangoAdapter.harvest!(SOURCE, ctx(seen));
    expect(seen).toEqual([
      "https://www.newyorktango.com/robots.txt",
      NEWYORKTANGO_FILES.recurring,
      NEWYORKTANGO_FILES.manual,
      NEWYORKTANGO_FILES.venues,
    ]);
    expect(first.listings.length).toBeGreaterThan(40);
    const again = await newYorkTangoAdapter.harvest!(
      { ...SOURCE, contentHash: first.doc!.contentHash },
      ctx([]),
    );
    expect(again).toMatchObject({ listings: [], unchanged: true });
  });

  it("refuses files whose columns changed, rather than reading them wrong", async () => {
    let t = NOW.getTime();
    const run: RunCtx = {
      metro: NYC,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "t",
        now: () => t,
        sleep: async (ms) => void (t += ms),
        transport: async (req) => ({
          url: req.url,
          status: 200,
          headers: {},
          body: req.url.endsWith("robots.txt") ? "User-Agent: *\nAllow: /\n" : "id,name\n1,x\n",
        }),
      }),
    };
    await expect(newYorkTangoAdapter.harvest!(SOURCE, run)).rejects.toThrow(/columns/);
  });
});
