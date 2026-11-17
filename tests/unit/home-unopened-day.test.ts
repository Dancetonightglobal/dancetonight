// Audit F16 (2026-09-29): a link to a night the home page does not open showed tonight in silence,
// and every filter, sort and view link kept the asked night, so each tap landed on tonight again.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

import { formatCalendarDateFrom, localInstant } from "@/src/domain/time";
import { Header, unopenedDayNotice } from "@/src/ui/home/Header";
import { MapStrip } from "@/src/ui/map/MapStrip";
import { Filters } from "@/src/ui/home/Filters";
import { hrefWith, linkParams, parseHomeParams } from "@/src/ui/home/params";

const NY = "America/New_York";
// Monday 2026-09-28, 5:30pm: the page opens tonight through Sat 10 Oct (+12); +13 is Sun 11 Oct.
const NOW = localInstant("2026-09-28", NY, 17, 30);

describe("a night the page does not open", () => {
  it("says which, and why, while it opens tonight", () => {
    const cases: Array<[string, unknown]> = [
      ["2026-09-27", { reason: "over", date: "2026-09-27" }],
      ["2026-10-11", { reason: "not_yet", date: "2026-10-11" }], // +13, the ingest's last night
      ["2026-12-31", { reason: "not_yet", date: "2026-12-31" }],
      ["not-a-date", { reason: "not_a_date" }],
      ["2026-02-30", { reason: "not_a_date" }],
    ];
    for (const [day, expected] of cases) {
      const query = parseHomeParams({ day }, NOW, NY);
      expect(query.nightDate, day).toBe("2026-09-28");
      expect(query.unopenedDay, day).toEqual(expected);
    }
  });

  it("is null for tonight, a picker night, a night beyond the picker, and no day at all", () => {
    for (const params of [
      {},
      { day: "2026-09-28" },
      { day: "2026-10-04" },
      { day: "2026-10-10" },
    ]) {
      expect(parseHomeParams(params, NOW, NY).unopenedDay, JSON.stringify(params)).toBeNull();
    }
  });

  it("before 6am, last night's date is still tonight, not over", () => {
    const early = localInstant("2026-09-29", NY, 2, 0);
    expect(parseHomeParams({ day: "2026-09-28" }, early, NY).unopenedDay).toBeNull();
    expect(parseHomeParams({ day: "2026-09-27" }, early, NY).unopenedDay).toEqual({
      reason: "over",
      date: "2026-09-27",
    });
  });

  it("links carry the night on screen: the unopened day is left out, the rest kept", () => {
    const raw = { day: "2026-10-11", t: "social", f: "swing" };
    const query = parseHomeParams(raw, NOW, NY);
    const carried = linkParams(raw, query);
    expect(carried).toEqual({ t: "social", f: "swing" });
    expect(hrefWith(carried, { sort: "distance" })).toBe("/?f=swing&sort=distance&t=social");
    // An opened night is kept as it was.
    const opened = { day: "2026-10-10", t: "social" };
    expect(linkParams(opened, parseHomeParams(opened, NOW, NY))).toBe(opened);
  });

  it("no filter link on the page names the unopened night", () => {
    const raw = { day: "2026-10-11" };
    const query = parseHomeParams(raw, NOW, NY);
    const html = renderToStaticMarkup(
      createElement(Filters, {
        query,
        params: linkParams(raw, query),
        counts: { night: 3, byFamily: {}, byType: {}, byStyle: {} } as never,
      }),
    );
    expect(html).toContain('href="/?t=social"');
    expect(html).not.toContain("2026-10-11");
  });

  it("the header says it, in the dancer's words, and never prints an ISO date", () => {
    const header = (unopenedDay: Parameters<typeof Header>[0]["unopenedDay"]) =>
      renderToStaticMarkup(
        createElement(Header, {
          place: "New York",
          dayLabel: "Tonight",
          isTonight: true,
          isTomorrow: false,
          nightDate: "2026-09-28",
          count: 7,
          locale: "en-US",
          params: {},
          unmatchedQuery: null,
          coveredPlace: null,
          unopenedDay,
        }),
      );
    expect(header({ reason: "not_yet", date: "2026-10-11" })).toContain(
      "We don&#x27;t list Sun, Oct 11 yet. Showing tonight.",
    );
    expect(header({ reason: "over", date: "2026-09-27" })).toContain(
      "Sun, Sep 27 is over. Showing tonight.",
    );
    expect(header({ reason: "not_a_date" })).toContain(
      "We can&#x27;t read the night in this link. Showing tonight.",
    );
    expect(header(null)).not.toContain("Showing tonight");
    expect(header({ reason: "not_yet", date: "2026-10-11" })).not.toContain("2026-10-11");
  });

  it("names the year of a night in another year, so it never reads as this year's", () => {
    expect(formatCalendarDateFrom("2025-10-05", "2026-10-05")).toBe("Sun, Oct 5, 2025");
    expect(formatCalendarDateFrom("2026-10-05", "2026-12-31")).toBe("Mon, Oct 5");
    expect(unopenedDayNotice({ reason: "over", date: "2025-10-05" }, "2026-09-28", "en-US")).toBe(
      "Sun, Oct 5, 2025 is over. Showing tonight.",
    );
    expect(
      unopenedDayNotice({ reason: "not_yet", date: "2027-09-29" }, "2026-09-28", "en-US"),
    ).toBe("We don't list Wed, Sep 29, 2027 yet. Showing tonight.");
    expect(unopenedDayNotice(null, "2026-09-28", "en-US")).toBeNull();
  });

  it("the phone map's strip says it too: the header's notice is under the map there", () => {
    const strip = (notice: string | null) =>
      renderToStaticMarkup(
        createElement(MapStrip, {
          place: "New York",
          dayLabel: "Tonight",
          isTonight: true,
          isTomorrow: false,
          count: 4,
          listHref: "/",
          notice,
        }),
      );
    expect(strip("Sun, Sep 27 is over. Showing tonight.")).toContain(
      "Sun, Sep 27 is over. Showing tonight.",
    );
    expect(strip(null)).not.toContain("Showing tonight");
  });
});
