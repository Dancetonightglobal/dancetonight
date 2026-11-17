// D-871: on a school's calendar that writes its own name as the venue, "Social dancing at A-Train" names
// no venue, only the night it belongs to. The same calendar's "A-Train @ The Hammersmith Club" says where
// that night is, so the social is placed there too (daily check 2026-11-10/11, London Swingland: the
// 21:30 social pinned to the school in Isleworth).
import { describe, expect, it } from "vitest";

import { icsToListings, parseIcs } from "@/src/adapters/feeds/ics";
import { siblingVenues, titleVenueOverOwnName } from "@/src/domain/own-name-venue";

const SWINGLAND = {
  name: "Swingland Swing Dance Classes & Events",
  address: "Swingland Swing Dance Classes & Events, TW7, Isleworth",
};

describe("siblingVenues", () => {
  it("maps each '<night> @ <venue>' title's night, folded, to its venue", () => {
    const map = siblingVenues([
      "A-Train @ The Hammersmith Club",
      "C Jam @ The Bedford (Balham)",
      "Hoppin' @ WERFA - 7pm",
      "Beginners Lindy Hop course",
      "Social dancing at A-Train",
    ]);
    expect(map.get("a-train")).toBe("The Hammersmith Club");
    expect(map.get("c jam")).toBe("The Bedford");
    expect(map.get("hoppin'")).toBe("WERFA");
    expect(map.size).toBe(3);
  });

  it("drops a night whose titles name two different venues, and keeps one named twice alike", () => {
    const map = siblingVenues([
      "Jam Night @ The Bedford",
      "Jam Night @ The Castle",
      "A-Train @ The Hammersmith Club",
      "A-TRAIN @ the hammersmith club",
    ]);
    expect(map.has("jam night")).toBe(false);
    expect(map.get("a-train")).toBe("The Hammersmith Club");
  });

  it("ignores a night or venue with fewer than 3 letters", () => {
    const map = siblingVenues(["DJ @ The Bedford", "Jam Night @ 5"]);
    expect(map.size).toBe(0);
  });
});

describe("titleVenueOverOwnName with siblings (D-871)", () => {
  const siblings = siblingVenues(["A-Train @ The Hammersmith Club", "C Jam @ The Bedford"]);

  it("places 'Social dancing at <night>' at that night's venue", () => {
    expect(
      titleVenueOverOwnName("Social dancing at A-Train", SWINGLAND, "Swingland", siblings),
    ).toEqual({
      name: "The Hammersmith Club",
      address: null,
    });
    expect(
      titleVenueOverOwnName("Social Dancing AT c jam", SWINGLAND, "Swingland", siblings),
    ).toEqual({
      name: "The Bedford",
      address: null,
    });
  });

  it("keeps the school when the night after ' at ' has no sibling", () => {
    expect(
      titleVenueOverOwnName("Social dancing at Home", SWINGLAND, "Swingland", siblings),
    ).toEqual(SWINGLAND);
  });

  it("keeps a location that is another place, and works only with the source's own label", () => {
    const where = { name: "The Castle", address: "The Castle, London E1" };
    expect(
      titleVenueOverOwnName("Social dancing at A-Train", where, "Swingland", siblings),
    ).toEqual(where);
    expect(titleVenueOverOwnName("Social dancing at A-Train", SWINGLAND, null, siblings)).toEqual(
      SWINGLAND,
    );
  });

  it("an '@' title still uses its own venue, and no siblings behaves as before", () => {
    expect(
      titleVenueOverOwnName("A-Train @ The Bedford", SWINGLAND, "Swingland", siblings),
    ).toEqual({
      name: "The Bedford",
      address: null,
    });
    expect(titleVenueOverOwnName("Social dancing at A-Train", SWINGLAND, "Swingland")).toEqual(
      SWINGLAND,
    );
  });
});

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:atrain-1116@swingland",
  "DTSTART:20261116T190000Z",
  "DTEND:20261116T213000Z",
  "SUMMARY:A-Train @ The Hammersmith Club",
  "LOCATION:Swingland Swing Dance Classes & Events\\, TW7\\, Isleworth",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:social-1116@swingland",
  "DTSTART:20261116T213000Z",
  "DTEND:20261116T230000Z",
  "SUMMARY:Social dancing at A-Train",
  "LOCATION:Swingland Swing Dance Classes & Events\\, TW7\\, Isleworth",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:course-1117@swingland",
  "DTSTART:20261117T190000Z",
  "DTEND:20261117T200000Z",
  "SUMMARY:Beginners Lindy Hop course",
  "LOCATION:Swingland Swing Dance Classes & Events\\, TW7\\, Isleworth",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("icsToListings places a school's social at its sibling night's venue (D-871)", () => {
  it("social -> The Hammersmith Club; a course stays at the school", () => {
    const { listings } = icsToListings(parseIcs(ICS), {
      sourceUrl: "https://www.swingland.com/events/",
      fetchedAt: new Date("2026-11-12T02:00:00Z"),
      metroTz: "Europe/London",
      countryCode: "GB",
      fromNight: "2026-11-12",
      days: 14,
      ownLabel: "Swingland",
    });
    const social = listings.find((l) => l.listing.title === "Social dancing at A-Train");
    const course = listings.find((l) => l.listing.title === "Beginners Lindy Hop course");
    expect(social?.listing.venue.name).toBe("The Hammersmith Club");
    expect(social?.listing.venue.address ?? null).toBeNull();
    expect(course?.listing.venue.name).toBe("Swingland Swing Dance Classes & Events");
  });
});
