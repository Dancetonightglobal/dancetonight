// D-813: a school's calendar that writes its own name where the venue goes ("Swingland Swing Dance Classes &
// Events, TW7, Isleworth" for "A-Train @ The Hammersmith Club") is placed from the venue named in the title
// (daily check 2026-11-09, London Swingland: every week placed at the school in Isleworth).
import { describe, expect, it } from "vitest";

import { ownSiteName } from "@/src/adapters/apis/google-calendar";
import { icsToListings, parseIcs } from "@/src/adapters/feeds/ics";
import { titleVenueOverOwnName } from "@/src/domain/own-name-venue";

describe("ownSiteName", () => {
  it("is the embedding site's first host label", () => {
    expect(ownSiteName("https://www.swingland.com/events/")).toBe("swingland");
    expect(ownSiteName("https://swingpatrol.co.uk/calendar")).toBe("swingpatrol");
  });
  it("is null for a Google Calendar URL, a short label or no URL", () => {
    expect(ownSiteName("https://calendar.google.com/calendar/embed?src=abc")).toBeNull();
    expect(ownSiteName("https://abc.org/")).toBeNull();
    expect(ownSiteName("not a url")).toBeNull();
  });
});

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:atrain-1109@swingland",
  "DTSTART:20261109T190000Z",
  "DTEND:20261109T223000Z",
  "SUMMARY:A-Train @ The Hammersmith Club",
  "LOCATION:Swingland Swing Dance Classes & Events\\, TW7\\, Isleworth",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:course-1110@swingland",
  "DTSTART:20261110T190000Z",
  "DTEND:20261110T200000Z",
  "SUMMARY:Beginners Lindy Hop course",
  "LOCATION:Swingland Swing Dance Classes & Events\\, TW7\\, Isleworth",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const options = (ownLabel: string | null) => ({
  sourceUrl: "https://www.swingland.com/events/",
  fetchedAt: new Date("2026-11-09T02:00:00Z"),
  metroTz: "Europe/London",
  countryCode: "GB",
  fromNight: "2026-11-09",
  days: 14,
  ownLabel,
});

describe("icsToListings with the source's own label (D-813)", () => {
  it("places a night from its title's venue, and leaves a course at the school", () => {
    const { listings } = icsToListings(parseIcs(ICS), options("Swingland"));
    const atrain = listings.find((l) => l.listing.title === "A-Train @ The Hammersmith Club");
    const course = listings.find((l) => l.listing.title === "Beginners Lindy Hop course");
    expect(atrain?.listing.venue.name).toBe("The Hammersmith Club");
    expect(atrain?.listing.venue.address ?? null).toBeNull();
    expect(course?.listing.venue.name).toBe("Swingland Swing Dance Classes & Events");
  });

  it("without a label the location is used as before", () => {
    const { listings } = icsToListings(parseIcs(ICS), options(null));
    const atrain = listings.find((l) => l.listing.title === "A-Train @ The Hammersmith Club");
    expect(atrain?.listing.venue.name).toBe("Swingland Swing Dance Classes & Events");
  });
});

const SWINGLAND = {
  name: "Swingland Swing Dance Classes & Events",
  address: "Swingland Swing Dance Classes & Events, TW7, Isleworth",
};

describe("titleVenueOverOwnName", () => {
  it("takes the venue after ' @ ' when the location is the source's own name", () => {
    expect(titleVenueOverOwnName("A-Train @ The Hammersmith Club", SWINGLAND, "Swingland")).toEqual(
      {
        name: "The Hammersmith Club",
        address: null,
      },
    );
    expect(titleVenueOverOwnName("C Jam @ The Bedford", SWINGLAND, "Swingland")).toEqual({
      name: "The Bedford",
      address: null,
    });
  });

  it("matches the label case- and accent-insensitively, and '@' without spaces after it", () => {
    expect(
      titleVenueOverOwnName(
        "C Jam @The Bedford",
        { name: "SWINGLAND", address: null },
        "Swingland",
      ),
    ).toEqual({ name: "The Bedford", address: null });
    expect(
      titleVenueOverOwnName(
        "Noche @ Café Rojo",
        { name: "Salsa Énergie studio", address: null },
        "Salsa Energie",
      ),
    ).toEqual({ name: "Café Rojo", address: null });
  });

  it("keeps the location when it is another place", () => {
    const where = { name: "The Bedford", address: "The Bedford, 77 Bedford Hill, London SW12 9HD" };
    expect(titleVenueOverOwnName("C Jam @ The Bedford", where, "Swingland")).toEqual(where);
  });

  it("keeps the location when the title names no venue", () => {
    expect(titleVenueOverOwnName("Beginners Lindy Hop course", SWINGLAND, "Swingland")).toEqual(
      SWINGLAND,
    );
  });

  it("keeps the location with no label, an empty location, or a too-short title venue", () => {
    expect(titleVenueOverOwnName("A-Train @ The Hammersmith Club", SWINGLAND, null)).toEqual(
      SWINGLAND,
    );
    expect(titleVenueOverOwnName("A-Train @ The Hammersmith Club", SWINGLAND, "  ")).toEqual(
      SWINGLAND,
    );
    const none = { name: null, address: null };
    expect(titleVenueOverOwnName("A-Train @ The Hammersmith Club", none, "Swingland")).toEqual(
      none,
    );
    expect(titleVenueOverOwnName("Jam @ 5", SWINGLAND, "Swingland")).toEqual(SWINGLAND);
  });

  it("uses the last ' @ ' and cuts a trailing time or bracket from the venue", () => {
    expect(
      titleVenueOverOwnName("Swing @ Home @ The Castle (Aldgate)", SWINGLAND, "Swingland"),
    ).toEqual({ name: "The Castle", address: null });
    expect(
      titleVenueOverOwnName("A-Train @ The Hammersmith Club - 7pm", SWINGLAND, "Swingland"),
    ).toEqual({
      name: "The Hammersmith Club",
      address: null,
    });
  });
});
