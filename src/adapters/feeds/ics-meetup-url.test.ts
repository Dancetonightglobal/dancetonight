import { describe, expect, it } from "vitest";
import { icsToListings, meetupEventUrl, parseIcs } from "@/src/adapters/feeds/ics";

describe("meetupEventUrl", () => {
  it("returns event URL for group page with trailing slash", () => {
    const result = meetupEventUrl(
      "event_316952614@meetup.com",
      "https://www.meetup.com/free-salsa-bachata-masterclass/events/",
    );
    expect(result).toBe("https://www.meetup.com/free-salsa-bachata-masterclass/events/316952614/");
  });

  it("returns event URL for group page without trailing slash", () => {
    const result = meetupEventUrl(
      "event_316952614@meetup.com",
      "https://www.meetup.com/free-salsa-bachata-masterclass/events",
    );
    expect(result).toBe("https://www.meetup.com/free-salsa-bachata-masterclass/events/316952614/");
  });

  it("converts http and bare meetup.com to https www form", () => {
    const result = meetupEventUrl(
      "event_316952614@meetup.com",
      "http://meetup.com/Group-Name/events",
    );
    expect(result).toBe("https://www.meetup.com/Group-Name/events/316952614/");
  });

  it("leaves event URL unchanged when already an event page", () => {
    const url = "https://www.meetup.com/free-salsa-bachata-masterclass/events/316952614/";
    const result = meetupEventUrl("event_316952614@meetup.com", url);
    expect(result).toBe(url);
  });

  it("returns unchanged for non-Meetup UID", () => {
    const url = "https://www.meetup.com/group/events";
    const result = meetupEventUrl("abc@example.org", url);
    expect(result).toBe(url);
  });

  it("returns unchanged for non-Meetup host", () => {
    const url = "https://example.com/group/events";
    const result = meetupEventUrl("event_316952614@meetup.com", url);
    expect(result).toBe(url);
  });

  it("returns null when url is null", () => {
    const result = meetupEventUrl("event_316952614@meetup.com", null);
    expect(result).toBeNull();
  });

  it("returns unchanged for malformed URL", () => {
    const result = meetupEventUrl("event_316952614@meetup.com", "not a url");
    expect(result).toBe("not a url");
  });

  it("returns unchanged when UID is null", () => {
    const url = "https://www.meetup.com/group/events";
    const result = meetupEventUrl(null, url);
    expect(result).toBe(url);
  });
});

describe("icsToListings with Meetup group feed", () => {
  const makeCalendar = (uid1: string, uid2: string) =>
    [
      "BEGIN:VCALENDAR",
      "X-WR-TIMEZONE:Europe/Madrid",
      "BEGIN:VEVENT",
      `UID:${uid1}`,
      "SUMMARY:Salsa Night",
      "DTSTART;TZID=Europe/Madrid:20261103T210000",
      "URL;VALUE=URI:https://www.meetup.com/free-salsa-bachata-masterclass/events",
      "END:VEVENT",
      "BEGIN:VEVENT",
      `UID:${uid2}`,
      "SUMMARY:Bachata Night",
      "DTSTART;TZID=Europe/Madrid:20261104T213000",
      "URL;VALUE=URI:https://www.meetup.com/free-salsa-bachata-masterclass/events",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

  it("extracts event URLs from Meetup UIDs", () => {
    const calendar = parseIcs(
      makeCalendar("event_316952614@meetup.com", "event_316952615@meetup.com"),
    );
    const { listings } = icsToListings(calendar, {
      sourceUrl: "https://www.meetup.com/free-salsa-bachata-masterclass/events/",
      fetchedAt: new Date("2026-11-01T02:00:00Z"),
      metroTz: "Europe/Madrid",
      countryCode: "ES",
      fromNight: "2026-11-01",
      days: 14,
    });
    expect(listings).toHaveLength(2);
    const salsa = listings.find((l) => l.listing.title === "Salsa Night");
    const bachata = listings.find((l) => l.listing.title === "Bachata Night");
    expect(salsa?.eventUrl).toBe(
      "https://www.meetup.com/free-salsa-bachata-masterclass/events/316952614/",
    );
    expect(bachata?.eventUrl).toBe(
      "https://www.meetup.com/free-salsa-bachata-masterclass/events/316952615/",
    );
  });

  it("leaves eventUrl undefined when UIDs are not Meetup pattern", () => {
    const calendar = parseIcs(makeCalendar("a@example.org", "b@example.org"));
    const { listings } = icsToListings(calendar, {
      sourceUrl: "https://www.meetup.com/free-salsa-bachata-masterclass/events/",
      fetchedAt: new Date("2026-11-01T02:00:00Z"),
      metroTz: "Europe/Madrid",
      countryCode: "ES",
      fromNight: "2026-11-01",
      days: 14,
    });
    expect(listings).toHaveLength(2);
    // Since the URL is shared by multiple titles, ownPage returns null, but buildListing may omit the property
    const salsa = listings.find((l) => l.listing.title === "Salsa Night");
    const bachata = listings.find((l) => l.listing.title === "Bachata Night");
    // eventUrl should be either null or undefined (spec says "null/undefined")
    expect(salsa?.eventUrl == null).toBe(true);
    expect(bachata?.eventUrl == null).toBe(true);
  });
});
