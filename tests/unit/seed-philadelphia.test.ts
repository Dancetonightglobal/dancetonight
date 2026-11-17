import { describe, expect, it, vi, afterEach } from "vitest";
import { isNamedDanceNight } from "@/src/domain/listing-screen";
import {
  philadelphiaMetroRow,
  PHILADELPHIA_METRO,
  PHILADELPHIA_METRO_ID,
} from "@/src/db/seed/philadelphia";
import { londonMetroRow } from "@/src/db/seed/london";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources/index";
import { PHILADELPHIA_SOURCES } from "@/config/sources/philadelphia";
import { raSources } from "@/config/sources/ra";
import {
  METRO_POSTCODE_PREFIXES,
  METRO_REGIONS,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { postcodeOf } from "@/src/domain/postcode";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("philadelphia seed module (D-300)", () => {
  it("returns the metro row", () => {
    const row = philadelphiaMetroRow();
    expect(row.slug).toBe("philadelphia");
    expect(row.name).toBe("Philadelphia");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/New_York");
    expect(row.radiusKm).toBe(30);
    expect(row.center.lat).toBeCloseTo(39.9524);
    expect(row.center.lng).toBeCloseTo(-75.1636);
    expect(row.status).toBe("active");
    expect(row.id).toBe(PHILADELPHIA_METRO_ID);
    expect(row.id).toBe(seedId("metro", "philadelphia"));
    expect(row.languages).toEqual(["en"]);
    expect(row.geonamesId).toBe(4560349);
    expect(row.population).toBe(1603797);
    expect(row.adHoc).toBe(false);
    expect(PHILADELPHIA_METRO.slug).toBe("philadelphia");
  });

  it("is wired into sources and regions", () => {
    expect(METRO_SOURCES.philadelphia).toEqual([
      ...PHILADELPHIA_SOURCES,
      ...raSources("philadelphia"),
    ]);
    expect(PHILADELPHIA_SOURCES.length).toBeGreaterThan(0);
    const retired = (METRO_RETIRED_SOURCES.philadelphia ?? []).map((r) => r.url);
    expect(retired).toHaveLength(16);
    expect(retired).toContain("https://www.wharton.upenn.edu/events/");
    expect(retired).toContain("https://waynepres.org/music/");
    expect(retired).toContain("https://ulife.vpul.upenn.edu/calendar/");
    expect(retired).toContain("https://www.riotnerdphilly.com/");
    expect(retired).toContain("https://www.roarphilly.com/");
    expect(
      retired.filter((u) => u.startsWith("https://dice.fm/browse/philadelphia-")),
    ).toHaveLength(7);
    expect(METRO_REGIONS.philadelphia).toEqual(["PA"]);
  });
});

describe("Philadelphia's outline (D-300, near suburbs D-511)", () => {
  const row = philadelphiaMetroRow();
  it.each([
    ["City Hall", 39.9524, -75.1636],
    ["Fishtown, Johnny Brenda's", 39.9694, -75.1343],
    ["Delaware waterfront pier", 39.956, -75.1393],
    ["Manayunk", 40.0262, -75.2244],
    ["Far Northeast", 40.087, -74.9616],
  ])("%s is inside", (_name, lat, lng) => {
    expect(insideMetro(row, { lat, lng })).toBe(true);
    expect(metroPartAt("philadelphia", { lat, lng })).toBe("Philadelphia");
  });

  it.each([
    ["Upper Darby, 69th Street", 39.9619, -75.259, "Delaware County"],
    ["Swarthmore, Park Avenue", 39.9021, -75.3499, "Delaware County"],
    ["Media", 39.9168, -75.3877, "Delaware County"],
    ["Bala Cynwyd", 40.0076, -75.2341, "Lower Merion"],
    ["Ardmore, Pivot Ballroom", 40.0071, -75.286, "Lower Merion"],
    ["Lower Merion, by Narberth", 40.0085, -75.2607, "Lower Merion"],
    ["Elkins Park", 40.0716, -75.1265, "Cheltenham"],
    ["Glenside, Keswick Theatre", 40.1009, -75.1529, "Cheltenham"],
    ["Jenkintown", 40.0959, -75.1252, "Jenkintown"],
  ])("near suburb %s is inside", (_name, lat, lng, part) => {
    expect(insideMetro(row, { lat, lng })).toBe(true);
    expect(metroPartAt("philadelphia", { lat, lng })).toBe(part);
  });

  it.each([
    ["Camden NJ waterfront", 39.9447, -75.129],
    ["Bensalem", 40.1046, -74.9518],
    ["King of Prussia", 40.0893, -75.3836],
    ["Norristown", 40.1215, -75.3399],
    ["Conshohocken", 40.0793, -75.3016],
    ["Wilmington DE", 39.7447, -75.5484],
  ])("%s is outside", (_name, lat, lng) => {
    expect(insideMetro(row, { lat, lng })).toBe(false);
    expect(metroPartAt("philadelphia", { lat, lng })).toBeNull();
  });
});

describe("row-only metro registry", () => {
  it("lists London and Philadelphia, not New York", () => {
    expect(ROW_ONLY_METROS.london!().id).toBe(londonMetroRow().id);
    expect(ROW_ONLY_METROS.philadelphia!().id).toBe(PHILADELPHIA_METRO_ID);
    expect(ROW_ONLY_METROS.nyc).toBeUndefined();
  });
});

describe("seed runner with --metro philadelphia", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Philadelphia row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "philadelphia", "--metro-only", "--dry-run"]);
    const logs = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logs).toContain("Philadelphia metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });

  it("still logs the London row", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "london", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("London metro row");
  });

  it("rejects an unknown slug and names the known ones", async () => {
    await expect(main(["--metro", "atlantis", "--dry-run"])).rejects.toThrow(
      /Unknown metro "atlantis".*nyc.*london.*philadelphia/,
    );
  });
});

describe("Philadelphia's neighbourhoods (D-300)", () => {
  it.each([
    ["Johnny Brenda's", 39.9694, -75.1343, "Fishtown"],
    ["Silk City", 39.961, -75.146, "Northern Liberties"],
    ["Underground Arts", 39.9601, -75.1586, "Callowhill"],
    ["Ukie Club", 39.9643, -75.1488, "East Poplar"],
    ["Commodore Barry Center", 40.0539, -75.194, "West Mount Airy"],
  ])("puts %s in its neighbourhood", (_name, lat, lng, expected) => {
    expect(neighbourhoodAt({ lat, lng })).toBe(expected);
  });
});

describe("Philadelphia's ZIPs and outside towns (D-300)", () => {
  const inside = (address: string) => {
    const zip = postcodeOf(address, "US");
    return METRO_POSTCODE_PREFIXES.philadelphia!.some((p) => zip?.startsWith(p));
  };
  it("takes city and near-suburb ZIPs and leaves out New Jersey, Delaware and the outer suburbs", () => {
    expect(inside("1200 Callowhill St, Philadelphia, PA 19123")).toBe(true);
    expect(inside("6815 Emlen St, Philadelphia, PA 19119")).toBe(true);
    expect(inside("1 Belmont Ave, Bala Cynwyd, PA 19004")).toBe(true);
    expect(inside("49 E Lancaster Ave, Ardmore, PA 19003")).toBe(true);
    expect(inside("129 Park Ave, Swarthmore, PA 19081")).toBe(true);
    expect(inside("291 N Keswick Ave, Glenside, PA 19038")).toBe(true);
    expect(inside("1 Riverside Dr, Camden, NJ 08103")).toBe(false);
    expect(inside("1000 N King St, Wilmington, DE 19801")).toBe(false);
    expect(inside("160 N Gulph Rd, King of Prussia, PA 19406")).toBe(false);
  });

  it("names outside towns in titles, never Philadelphia streets", () => {
    expect(titleNamesOutsideTown("philadelphia", "Salsa Night in Cherry Hill")).toBe("Cherry Hill");
    expect(titleNamesOutsideTown("philadelphia", "Camden Waterfront Swing")).toBe("Camden");
    expect(titleNamesOutsideTown("philadelphia", "Lancaster Ave Block Party Dance")).toBeNull();
    expect(
      titleNamesOutsideTown("philadelphia", "Baltimore Avenue Dollar Stroll Dance"),
    ).toBeNull();
    expect(titleNamesOutsideTown("philadelphia", "Germantown Contra")).toBeNull();
  });

  it("no longer names the near suburbs as outside towns (D-511)", () => {
    for (const title of [
      "Salsa Night at Pivot Ballroom Ardmore",
      "Glenside Contra",
      "Upper Darby Bachata Social",
      "Bala Cynwyd Swing",
      "Narberth Line Dancing",
      "Jenkintown Tango",
      "Elkins Park Milonga",
    ]) {
      expect(titleNamesOutsideTown("philadelphia", title)).toBeNull();
    }
    expect(titleNamesOutsideTown("philadelphia", "King of Prussia Salsa")).toBe("King of Prussia");
    expect(titleNamesOutsideTown("philadelphia", "Conshohocken Swing")).toBe("Conshohocken");
    expect(titleNamesOutsideTown("philadelphia", "Norristown Bachata")).toBe("Norristown");
  });
});

describe("Our Philly (dance) named dance nights (D-264)", () => {
  const ourPhilly = PHILADELPHIA_SOURCES.find(
    (s) => s.url === "https://www.ourphilly.org/tags/dance",
  );

  it("keeps Brasil's nights and University City Swing past the mixed screen", () => {
    expect(ourPhilly?.mixedCalendar).toBe(true);
    for (const title of [
      "Zouk Tuesdays",
      "¡Wepa! Wednesdays",
      "Finally Fridays",
      "Salsational Saturdays",
      "University City Swing",
    ]) {
      expect(isNamedDanceNight(title, ourPhilly?.danceNights)).toBe(true);
    }
  });

  it("still screens West Philly Swingers, a staged show at Penn Live Arts", () => {
    expect(isNamedDanceNight("West Philly Swingers", ourPhilly?.danceNights)).toBe(false);
  });
});
