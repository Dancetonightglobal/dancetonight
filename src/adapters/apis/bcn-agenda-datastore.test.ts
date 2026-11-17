// D-849 contract: bcn_agenda reads the Ajuntament's CKAN datastore API (datastore_search_sql), because
// every /download on the open-data portal answers nginx 403 since 2026-10-29.
import { describe, expect, it, vi } from "vitest";
import { bcnAgendaAdapter } from "./bcn-agenda";
import {
  BCN_CULTURAL_RESOURCE,
  BCN_DATASTORE_SQL_URL,
  BCN_EXTENDED_RESOURCE,
  parseTimetable,
} from "./bcn-agenda-datastore";
import type { Metro, NightDate, RunCtx } from "@/src/adapters/types";

const BOM = String.fromCharCode(0xfeff);

const BARCELONA: Metro = {
  id: "barcelona",
  slug: "barcelona",
  name: "Barcelona",
  countryCode: "ES",
  center: { lat: 41.3851, lng: 2.1734 },
  radiusKm: 15,
  tz: "Europe/Madrid",
  languages: ["ca", "es"],
};

function table(rows: string): string {
  return (
    '<table class="timetable-table"><tr class="timetable-header"><th class="weekdays">Dies</th>' +
    '<th class="hours">Hores</th></tr>' +
    rows +
    "</table>"
  );
}
function row(day: string | null, hour: string): string {
  const dayCell = day === null ? "" : `<td class="timetable-day" rowspan=1><div>${day}</div></td>`;
  return `<tr>${dayCell}<td class="timetable-hour" rowspan=1><div>${hour}</div></td></tr>`;
}

describe("parseTimetable", () => {
  it("reads one weekday at one time", () => {
    expect(parseTimetable(table(row("Dissabte", "a les 17.30&nbsp;h")))).toEqual([
      { weekdays: [6], dates: [], except: [], start: "17:30", end: null },
    ]);
  });

  it("reads two weekdays, exceptions and a range", () => {
    const slots = parseTimetable(
      table(
        row("Dilluns i dimecres excepte 12 octubre i 8 desembre", "de 19.45&nbsp;h a 21.15&nbsp;h"),
      ),
    );
    expect(slots).toEqual([
      { weekdays: [1, 3], dates: [], except: ["10-12", "12-08"], start: "19:45", end: "21:15" },
    ]);
  });

  it("reads d' and colon times", () => {
    expect(parseTimetable(table(row("Divendres", "d'10:00&nbsp;h a 12:00&nbsp;h")))).toEqual([
      { weekdays: [5], dates: [], except: [], start: "10:00", end: "12:00" },
    ]);
  });

  it("reads a weekday span", () => {
    const [slot] = parseTimetable(table(row("De dilluns a divendres", "a les 18.00&nbsp;h")));
    expect(slot?.weekdays).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads an explicit date list", () => {
    const [slot] = parseTimetable(
      table(row("9 octubre, <br>13 novembre i <br>11 desembre", "a les 20.00&nbsp;h")),
    );
    expect(slot?.weekdays).toEqual([]);
    expect(slot?.dates).toEqual(["10-09", "11-13", "12-11"]);
  });

  it("takes the first of two hour ranges", () => {
    const [slot] = parseTimetable(
      table(row("Dimarts", "de 10.00&nbsp;h a 12.00&nbsp;h i <br>de 17.00&nbsp;h a 19.00&nbsp;h")),
    );
    expect(slot).toMatchObject({ start: "10:00", end: "12:00" });
  });

  it("reuses the day cell of a rowspan for the next hour row", () => {
    const slots = parseTimetable(
      table(row("Dijous", "a les 18.00&nbsp;h") + row(null, "a les 21.00&nbsp;h")),
    );
    expect(slots.map((s) => [s.weekdays, s.start])).toEqual([
      [[4], "18:00"],
      [[4], "21:00"],
    ]);
  });

  it("returns no slots for empty or unknown text", () => {
    expect(parseTimetable("")).toEqual([]);
    expect(parseTimetable(table(row("Consulteu el web", "Consulteu el web")))).toEqual([
      { weekdays: [], dates: [], except: [], start: null, end: null },
    ]);
  });
});

type Row = Record<string, string | number | null>;
function culturalRow(over: Row): Row {
  return {
    register_id: `${BOM}99400000001`,
    name: "Ballada de sardanes",
    start_date: "2026-11-14T12:00:00",
    end_date: "2026-11-14T12:00:00",
    timetable: table(row("Dissabte", "a les 17.30&nbsp;h")),
    addresses_road_name: "Plaça dels Jardins d'Elx",
    addresses_start_street_number: 1,
    addresses_zip_code: "8027",
    addresses_town: "Barcelona",
    geo_epgs_4326_lat: "41.423709935902565",
    geo_epgs_4326_lon: "2.188249794996523",
    ...over,
  };
}
function ok(records: Row[]) {
  return {
    status: 200,
    body: JSON.stringify({ success: true, result: { records } }),
    fetchedAt: new Date("2026-11-11T05:00:00Z"),
  };
}
function ctxWith(request: ReturnType<typeof vi.fn>): RunCtx {
  return {
    metro: BARCELONA,
    now: () => new Date(),
    http: { request },
    env: {},
    log: vi.fn(),
  } as unknown as RunCtx;
}
const NIGHTS: NightDate[] = [
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
];
const sqlOf = (url: string) => new URL(url).searchParams.get("sql") ?? "";

describe("bcnAgendaAdapter on the datastore API", () => {
  const cultural = [
    culturalRow({}),
    culturalRow({
      register_id: `${BOM}99400000002`,
      name: "Ball de swing al carrer",
      start_date: "2026-09-02T03:00:00",
      end_date: "2026-12-30T03:00:00",
      timetable: table(row("Dimecres excepte 11 novembre", "de 21.00&nbsp;h a 23.30&nbsp;h")),
    }),
    culturalRow({
      register_id: `${BOM}99400000003`,
      name: "Milonga de tardor",
      start_date: "2026-11-15T12:00:00",
      end_date: "2026-11-15T12:00:00",
      timetable: "",
      geo_epgs_4326_lat: "-0.0010942582961042412",
      geo_epgs_4326_lon: "-1.4894678076317491",
    }),
    culturalRow({ register_id: `${BOM}99400000004`, name: "Taller 'Balls de saló'" }),
    culturalRow({ register_id: `${BOM}99400000005`, name: "Visita al Temple" }),
    culturalRow({ register_id: "1') OR ('1'='1", name: "Ball de festa major" }),
    culturalRow({
      register_id: `${BOM}99400000006`,
      name: "Ball de bastons",
      start_date: "2026-09-01T03:00:00",
      end_date: "2026-12-31T03:00:00",
      timetable: "",
    }),
  ];
  const places = [
    {
      id: "99400000001",
      addresses_place: "Plaça Jardins d'Elx",
      values_value: "http://www.festesdelasagrera.cat",
    },
    { id: "99400000002", addresses_place: "", values_value: "javascript:alert(1)" },
    { id: "99400000002", addresses_place: "Casal de Barri", values_value: null },
  ];

  it("queries the cultural resource for the nights, then places for the dance rows only", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok(cultural))
      .mockResolvedValueOnce(ok(places as never));
    await bcnAgendaAdapter.harvestMetro!(BARCELONA, NIGHTS, ctxWith(request));

    expect(request).toHaveBeenCalledTimes(2);
    const first = request.mock.calls[0]![0].url as string;
    const second = request.mock.calls[1]![0].url as string;
    expect(first.startsWith(`${BCN_DATASTORE_SQL_URL}?`)).toBe(true);
    expect(sqlOf(first)).toContain(`"${BCN_CULTURAL_RESOURCE}"`);
    expect(sqlOf(first)).toContain("'2026-11-11'");
    expect(sqlOf(second)).toContain(`"${BCN_EXTENDED_RESOURCE}"`);
    for (const id of ["99400000001", "99400000002", "99400000003"]) {
      expect(sqlOf(second)).toContain(`'${id}'`);
    }
    // not dance, a course, or an unsafe id: never sent back to the portal
    expect(sqlOf(second)).not.toContain("99400000004");
    expect(sqlOf(second)).not.toContain("99400000005");
    expect(sqlOf(second)).not.toContain("OR (");
  });

  it("maps rows to listings with times, venue, location and links", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok(cultural))
      .mockResolvedValueOnce(ok(places as never));
    const result = await bcnAgendaAdapter.harvestMetro!(BARCELONA, NIGHTS, ctxWith(request));
    const ids = result.listings.map((l) => l.externalId).sort();
    expect(ids).toEqual([
      "99400000001:2026-11-14",
      "99400000002:2026-11-18",
      "99400000003:2026-11-15",
    ]);

    const sardanes = result.listings.find((l) => l.externalId === "99400000001:2026-11-14")!;
    expect(sardanes.listing.title).toBe("Ballada de sardanes");
    expect(sardanes.listing.doors_time).toBe("17:30");
    expect(sardanes.listing.venue?.name).toBe("Plaça Jardins d'Elx");
    expect(sardanes.listing.venue?.address).toBe("Plaça dels Jardins d'Elx, 1, 08027, Barcelona");
    expect(sardanes.venueLocation?.lat).toBeCloseTo(41.42371, 5);
    expect(sardanes.venueLocation?.lng).toBeCloseTo(2.18825, 5);
    expect(sardanes.eventUrl).toBe(
      "https://guia.barcelona.cat/ca/detall/ballada-de-sardanes_99400000001.html",
    );

    const swing = result.listings.find((l) => l.externalId === "99400000002:2026-11-18")!;
    expect(swing.listing.doors_time).toBe("21:00");
    expect(swing.listing.venue?.name).toBe("Casal de Barri");

    const milonga = result.listings.find((l) => l.externalId === "99400000003:2026-11-15")!;
    expect(milonga.listing.doors_time ?? null).toBeNull();
    expect(milonga.venueLocation ?? null).toBeNull();
  });

  it("keeps the listings when the places query fails", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok(cultural))
      .mockResolvedValueOnce({ status: 403, body: "Forbidden", fetchedAt: new Date() });
    const result = await bcnAgendaAdapter.harvestMetro!(BARCELONA, NIGHTS, ctxWith(request));
    expect(result.listings).toHaveLength(3);
    const sardanes = result.listings.find((l) => l.externalId === "99400000001:2026-11-14")!;
    expect(sardanes.listing.venue?.name ?? null).toBeNull();
    expect((result.notes ?? []).some((n) => /places/.test(n))).toBe(true);
  });

  it("makes no places query when no row is a dance", async () => {
    const request = vi.fn().mockResolvedValueOnce(ok([culturalRow({ name: "Visita al Temple" })]));
    const result = await bcnAgendaAdapter.harvestMetro!(BARCELONA, NIGHTS, ctxWith(request));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.listings).toHaveLength(0);
    // Nothing listed is not the agenda's whole word: no stored row is retired on it (D-882).
    expect(result.whole).toBeUndefined();
  });

  it("is a whole read when the window's rows came back under the cap (D-882)", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(ok(cultural))
      .mockResolvedValueOnce(ok(places as never));
    const result = await bcnAgendaAdapter.harvestMetro!(BARCELONA, NIGHTS, ctxWith(request));
    expect(result.listings).toHaveLength(3);
    expect(result.whole).toBe(true);
  });

  it("fails the source when the API says success false", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ success: false, error: { message: "boom" } }),
      fetchedAt: new Date(),
    });
    await expect(
      bcnAgendaAdapter.harvestMetro!(BARCELONA, NIGHTS, ctxWith(request)),
    ).rejects.toThrow("bcn_agenda: unexpected body");
  });
});
