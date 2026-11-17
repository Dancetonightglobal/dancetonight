import { describe, expect, it } from "vitest";
import { isSalsaVidaPage, jsonLdToListings } from "@/src/adapters/feeds/jsonld";

// D-778 (daily check 11-07, Beirut "SBK Night at Suzana"): Salsa Vida wrote 21:30-08:00 for a 9:30 PM Beirut night.
const ev = (startDate: string, endDate: string) => ({
  "@context": "https://schema.org",
  "@type": "Event",
  name: "SBK Night at Suzana",
  startDate,
  endDate,
  location: { "@type": "Place", name: "Suzana", address: "Beirut, Lebanon" },
});
const options = (pageUrl: string) => ({
  pageUrl,
  fetchedAt: new Date("2026-11-07T12:00:00Z"),
  metroTz: "Asia/Beirut",
  countryCode: "LB",
  fromNight: "2026-11-07",
});
const startOf = (pageUrl: string) => {
  const { listings } = jsonLdToListings(
    [ev("2026-11-08T21:30:00-08:00", "2026-11-09T02:00:00-08:00")],
    options(pageUrl),
  );
  const l = listings[0]?.listing;
  return [l?.local_date, l?.doors_time ?? l?.dancing_time ?? l?.lesson_time, l?.end_time];
};

describe("Salsa Vida pages read on the wall clock (D-778)", () => {
  it("reads a Salsa Vida page's clock as local time, whatever its offset", () => {
    expect(startOf("https://www.salsavida.com/event/lebanon/beirut/sbk-night-at-suzana/")).toEqual([
      "2026-11-08",
      "21:30",
      "02:00",
    ]);
    expect(startOf("https://salsavida.com/guides/lebanon/beirut/")[1]).toBe("21:30");
  });

  it("keeps the offset on other sites", () => {
    expect(startOf("https://example.com/events/sbk")).toEqual(["2026-11-09", "07:30", "12:00"]);
  });

  it("knows the host", () => {
    expect(isSalsaVidaPage("https://www.salsavida.com/x")).toBe(true);
    expect(isSalsaVidaPage("https://notsalsavida.com/x")).toBe(false);
    expect(isSalsaVidaPage("not a url")).toBe(false);
  });
});
