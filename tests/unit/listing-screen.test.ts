import { describe, expect, it } from "vitest";

import {
  isNotAnEvent,
  screenTitle,
  screenNoDance,
  isButtonLabel,
} from "@/src/domain/listing-screen";

describe("the not-an-event screen (D-060 point 9)", () => {
  it("keeps real event names, including ones that carry a weekday, a month or a year", () => {
    for (const title of [
      "Brooklyn Social",
      "English - Tuesdays",
      "Frim Fram Jam",
      "Toda La Noche, Salsa Social",
      "Salsa Dura Outdoor Social",
      "Social Dances (Parties)",
      "Special Double Contra Dance",
      "New York Lindy Exchange 2026 (NYLX)",
      "Festival Oct 2 NYC ZOUK FESTIVAL 2026",
      "SBKZ Congress",
      "Monday Night Swing",
      "Friday Salsa",
      // A weekday or a season beside a dance word is a name, not a heading.
      "Tuesday Dance",
      "Monthly Dance",
      "First Friday",
      "Winter Ball",
      "Spring Break Social",
      // "Closed" and "No" that do not announce a closure.
      "Closed Practica",
      "No Partner Needed Salsa",
      "No Dance Experience Required Social",
      "Day of the Dead Salsa Party",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("keeps the borderline 'November 2026 Ranch': one word names something, so it may be an event", () => {
    // A month and a year in front of a word that is not a date or a heading word. It could be a
    // heading run together with a venue ("The Ranch" is a country-dance night), or the name of a
    // night there. Keeping it costs one listing that says "Time not listed" with its source link;
    // screening it could hide a real night. Coverage is the product, so it is kept.
    expect(screenTitle("November 2026 Ranch")).toBeNull();
  });

  it("screens a title that is only a date, a month, a year or a weekday", () => {
    for (const title of [
      "October 1, 2026",
      "December 2027",
      "November 2026",
      "2026",
      "Oct 2",
      "Sat, Oct 3rd",
      "10/02/2026",
      "Saturday, October 3 9:30pm",
      "Fridays",
      "Fall 2026",
    ]) {
      expect(screenTitle(title), title).toEqual({
        kind: "date_or_heading",
        reason: "only a date or a heading",
      });
    }
  });

  it("screens a heading, including one that ends with a heading noun after other words", () => {
    for (const title of [
      "Upcoming Dance Dates",
      "SWING REMIX Fall monthly dance schedule",
      "Upcoming events",
      "This week",
      "Class Schedule",
      "Fall schedule 2026",
      "Tango calendar",
    ]) {
      expect(screenTitle(title)?.kind, title).toBe("date_or_heading");
    }
  });

  it("screens a closure notice", () => {
    for (const title of [
      "Studio closed",
      "No class",
      "Closed for the holiday",
      "Studio Closed - Labor Day",
      "No classes this week",
      "Thanksgiving: no class",
      "Nov 26: studio closed",
      "We're closed",
      "The school will be closed Monday",
      "Closed",
      "Holiday closure",
      "Closed - no classes or socials",
      "Thanksgiving Break",
      "Winter Break",
      "Holiday Break",
      "Spring Recess",
      "Winter break Dec 21 - Jan 3",
      "Thanksgiving Break - No Classes",
    ]) {
      expect(screenTitle(title), title).toEqual({ kind: "closure", reason: "a closure notice" });
    }
  });

  it("keeps a notice that names what is on instead, and a break that names an event", () => {
    // Review, 2026-09-28: these are real nights that the closure rule used to drop.
    for (const title of [
      "No Class - Practica",
      "No Lesson – Social Dance 8-11pm",
      "No Lessons, All Social",
      "Spring Break Social",
      "Spring Break Swing Weekend",
      "Winter Break Ball",
      "Break Dance Battle",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("answers the same through isNotAnEvent, and never screens an empty title", () => {
    expect(isNotAnEvent("Studio closed")).toBe(true);
    expect(isNotAnEvent("Brooklyn Social")).toBe(false);
    expect(isNotAnEvent("   ")).toBe(false);
    expect(isNotAnEvent("!!!")).toBe(false);
  });

  describe("screenNoDance with mixed-calendar source styles", () => {
    const tz = "America/New_York";
    const night = "2026-10-18";

    it("screens a listing with only the source's single style tag and no dance in title", () => {
      const listing = {
        title: "Haunted Mansion BK – Haunted House Experience | La Casita Brooklyn",
        styles: ["salsa"],
        startsAt: new Date("2026-10-18T21:00:00-04:00"),
        nightDate: night,
        tz,
      };
      const source = { mixedCalendar: true, styles: ["salsa"] };
      const result = screenNoDance(listing, source);
      expect(result).toEqual({
        kind: "not_a_dance",
        reason: "names no dance, and the venue's calendar lists concerts too",
      });
    });

    it("keeps a listing with the source's single style tag but title names a dance", () => {
      const listing = {
        title: "Salsa Social at La Casita",
        styles: ["salsa"],
        startsAt: new Date("2026-10-18T21:00:00-04:00"),
        nightDate: night,
        tz,
      };
      const source = { mixedCalendar: true, styles: ["salsa"] };
      const result = screenNoDance(listing, source);
      expect(result).toBeNull();
    });

    it("screens a listing whose styles the title does not name (D-237)", () => {
      const listing = {
        title: "Haunted Mansion BK – Haunted House Experience",
        styles: ["salsa", "bachata"],
        startsAt: new Date("2026-10-18T21:00:00-04:00"),
        nightDate: night,
        tz,
      };
      const source = { mixedCalendar: true, styles: ["salsa"] };
      const result = screenNoDance(listing, source);
      expect(result).toEqual({
        kind: "not_a_dance",
        reason: "names no dance, and the venue's calendar lists concerts too",
      });
    });

    it("keeps a listing with source's single style tag but late start", () => {
      const listing = {
        title: "Haunted Mansion BK – Haunted House Experience",
        styles: ["salsa"],
        startsAt: new Date("2026-10-18T23:00:00-04:00"),
        nightDate: night,
        tz,
      };
      const source = { mixedCalendar: true, styles: ["salsa"] };
      const result = screenNoDance(listing, source);
      expect(result).toBeNull();
    });

    it("keeps a listing with source's single style tag on non-mixed-calendar source", () => {
      const listing = {
        title: "Haunted Mansion BK – Haunted House Experience",
        styles: ["salsa"],
        startsAt: new Date("2026-10-18T21:00:00-04:00"),
        nightDate: night,
        tz,
      };
      const source = { mixedCalendar: false, styles: ["salsa"] };
      const result = screenNoDance(listing, source);
      expect(result).toBeNull();
    });

    it("screens a listing whose style the title does not name, whatever the source's styles (D-237)", () => {
      const listing = {
        title: "Haunted Mansion BK – Haunted House Experience",
        styles: ["salsa"],
        startsAt: new Date("2026-10-18T21:00:00-04:00"),
        nightDate: night,
        tz,
      };
      const source = { mixedCalendar: true, styles: ["salsa", "bachata"] };
      const result = screenNoDance(listing, source);
      expect(result).toEqual({
        kind: "not_a_dance",
        reason: "names no dance, and the venue's calendar lists concerts too",
      });
    });

    it("keeps a title that says dance, dances, dancing, dancer or dancers unless it names a seated show", () => {
      const mixed = { mixedCalendar: true, styles: [] };
      const at7pm = (title: string) => ({
        title,
        styles: [] as string[],
        startsAt: new Date("2026-10-18T19:00:00-04:00"),
        nightDate: "2026-10-18",
        tz: "America/New_York",
      });
      // These should be kept because they have dance words and no seated-show words.
      for (const title of [
        "Dance of the Dead- Night One- SORNE",
        "Shadow Dance: A Space to Feel",
        "Dyaspora Night: Black Dance Music",
        "Queer Dancing Night",
        "Dancers' Open Floor",
      ]) {
        expect(screenNoDance(at7pm(title), mixed), title).toBeNull();
      }
      // These should be screened because they have seated-show words.
      for (const title of [
        "Dance Theatre of Harlem",
        "Spring Dance Recital",
        "Dance Film Screening",
        "Nritya Arpan: A Kathak & Kuchipudi Classical Dance Presentation",
        "Rasputina with Dust Bowl Faeries",
      ]) {
        expect(screenNoDance(at7pm(title), mixed), title).toEqual({
          kind: "not_a_dance",
          reason: "names no dance, and the venue's calendar lists concerts too",
        });
      }
    });
  });

  describe("screenTitle boat parties and cruises (owner 2026-10-18)", () => {
    it("screens titles containing boat words", () => {
      for (const title of [
        "The Lovers & Friends Halloween Boat Party R&B",
        "Halloween Lovers & Friends Boat Parrty #1 NYC Cruise",
        "Sunset Yacht Party",
        "Salsa Cruise Around Manhattan",
        "BOAT PARTY",
        "Reggaeton boats",
      ]) {
        expect(screenTitle(title), title).toEqual({
          kind: "boat_or_cruise",
          reason: "a boat party or cruise (the owner lists none, 2026-10-18)",
        });
      }
    });

    it("keeps titles without boat words", () => {
      for (const title of [
        "Rooftop Reggaeton Party",
        "Salsa Social at La Casita",
        "Boathouse Swing", // "boathouse" is not a boat word
      ]) {
        expect(screenTitle(title), title).toBeNull();
      }
    });

    it("keeps a Boat Club or Yacht Club night, but not a club cruise (D-223)", () => {
      for (const title of [
        "93 CLUB Saturday 31 Oct 5 pm - 1 AM / Main Room / Live Room BOAT CLUB HALLOWEEN 2026",
        "Yacht Club Disco",
      ]) {
        expect(screenTitle(title), title).toBeNull();
      }
      for (const title of ["Boat Club Thames Cruise", "Yacht Club Boat Party"]) {
        expect(screenTitle(title)?.kind, title).toBe("boat_or_cruise");
      }
    });

    it("isNotAnEvent returns true for boat parties", () => {
      expect(isNotAnEvent("Sunset Yacht Party")).toBe(true);
    });
  });

  describe("screenTitle crawls, party buses and happy hours (owner 2026-10-18)", () => {
    it("screens titles containing crawl, party bus or happy hour", () => {
      for (const title of [
        "Blue Glove Presents: #1 OFFICIAL MIAMI CLUB CRAWL+PARTY BUS EXPERIENCE",
        "#1 OFFICIAL NYC BAR + CLUB CRAWL (Mega-Club Access)",
        "Pub Crawl Saturdays",
        "Party Bus to the Club",
        "A PARTY ON A MOVING BUS (+ FREE After party )",
        "Halloween Bus Party",
        "After Work Fridays at Mama Taco Everyone FREE + Happy Hour Specials",
        "Happy Hours with DJ",
      ]) {
        expect(screenTitle(title), title).toEqual({
          kind: "crawl_bus_or_happy_hour",
          reason: "a bar crawl, party bus or happy hour (the owner lists none, 2026-10-18)",
        });
      }
    });

    it("keeps titles that are not crawls, party buses or happy hours", () => {
      for (const title of [
        "Bus Stop Line Dance Night",
        "Moving Bodies Salsa Night",
        "Happy Feet Swing",
        "The Hour of Tango",
        "Crawford Hall Contra",
        "Salsa Groove: Dance Class & Happy Hour",
      ]) {
        expect(screenTitle(title), title).toBeNull();
      }
    });

    it("isNotAnEvent returns true for crawls", () => {
      expect(isNotAnEvent("Pub Crawl Saturdays")).toBe(true);
    });
  });

  describe("screenTitle cancellation-only, karaoke, record fairs, band billings, ICLUB (D-156)", () => {
    it("screens cancellation-only titles", () => {
      for (const title of ["CANCELLED", "Canceled", "Cancelled!", "POSTPONED"]) {
        expect(screenTitle(title), title).toEqual({
          kind: "closure",
          reason: "a cancellation notice that names no event",
        });
      }
    });

    it("keeps titles that include cancellation words but also other content", () => {
      for (const title of [
        "Salsa Cancelled This Week? No - Salsa Social",
        "Cancelled: Swing Dance",
        "Postponed until next week",
      ]) {
        expect(screenTitle(title), title).toBeNull();
      }
    });

    it("screens karaoke and record fairs", () => {
      for (const title of ["KARAOKE NIGHT", "VINYL OPEN DECK & RECORD FAIR"]) {
        expect(screenTitle(title), title).toEqual({
          kind: "not_dance_scope",
          reason: "karaoke or a record fair (the owner lists none, 2026-10-18)",
        });
      }
    });

    it("keeps titles with 'record' not followed by fair/fairs", () => {
      for (const title of ["Record Release Dance Party", "Record Store Day Social"]) {
        expect(screenTitle(title), title).toBeNull();
      }
    });

    it("keeps karaoke beside a named dance style (D-278)", () => {
      for (const title of [
        "Bachata & Karaoke Social Event - Class, Social & Karaoke for Foreigners & Locals",
        "Salsa Night + Karaoke",
      ]) {
        expect(screenTitle(title), title).toBeNull();
      }
    });

    it("still screens karaoke with no dance style", () => {
      for (const title of ["KARAOKE NIGHT", "Karaoke Party", "Noite de Videokê"]) {
        expect(screenTitle(title)?.kind, title).toBe("not_dance_scope");
      }
    });

    it("screens karaoke with only club music genre (D-497)", () => {
      for (const title of ["Emo Night Karaoke – With a Live Band", "Techno Karaoke Party"]) {
        expect(screenTitle(title)?.kind, title).toBe("not_dance_scope");
      }
    });

    // Band billings are screened on mixed calendars only (a venue's whole calendar, D-121).
    const mixed = { mixedCalendar: true };
    const at7pm = (title: string) => ({
      title,
      styles: [] as string[],
      startsAt: new Date("2026-10-19T19:00:00-04:00"),
      nightDate: "2026-10-19",
      tz: "America/New_York",
    });

    it("screens band billings without dance words on a mixed calendar", () => {
      for (const title of ["PEDRO GIRAUDO TANGO QUARTET", "The Bad Plus Trio"]) {
        expect(screenNoDance({ ...at7pm(title), styles: ["tango"] }, mixed), title).toEqual({
          kind: "not_dance_scope",
          reason: "a band's concert billing (the owner lists none, 2026-10-18)",
        });
      }
    });

    it("keeps band billings with dance words, and every band billing off a mixed calendar", () => {
      for (const title of [
        "Milonga with Quinteto Grande",
        "Salsa Night with Trio Caliente",
        "Live Trio Swing Dance",
        "Sunday Milonga ft. Tango Trio",
      ]) {
        expect(screenNoDance({ ...at7pm(title), styles: ["salsa"] }, mixed), title).toBeNull();
      }
      for (const title of [
        "PEDRO GIRAUDO TANGO QUARTET",
        "Swing Remix with the George Gee Orchestra",
      ]) {
        expect(screenTitle(title), title).toBeNull();
        expect(screenNoDance(at7pm(title), { mixedCalendar: false }), title).toBeNull();
      }
    });

    it("screens ICLUB tokens", () => {
      for (const title of [
        "LOST IN PARADISE ROOFTOP PARTY - REGGAETON -ICLUB",
        "ICLUBNYC Rooftop",
      ]) {
        expect(screenTitle(title), title).toEqual({
          kind: "not_dance_scope",
          reason: "an ICLUB party (booze cruises; the owner lists none, 2026-10-17)",
        });
      }
    });

    it("keeps titles with 'iclubbing' (not exact token)", () => {
      expect(screenTitle("Iclubbing Night")).toBeNull();
    });
  });

  describe("isButtonLabel / screenTitle button labels", () => {
    it("isButtonLabel true for exact folded button labels", () => {
      for (const title of [
        "TICKETS AND INFO",
        "Tickets & Info",
        "JOIN THE WAITING LIST",
        "Buy Tickets",
        "Book now",
        "More info",
        "SOLD OUT",
        "Comprar ingressos",
        "Saiba mais",
        "Más información",
        "Available on the door",
      ]) {
        expect(isButtonLabel(title), title).toBe(true);
      }
    });

    it("isButtonLabel false for titles that merely contain the words", () => {
      for (const title of [
        "Tickets for Salsa Night",
        "Book Club Social Dance",
        "Info Night Swing",
        "Salsa",
        "The Big 90s Night",
        "",
      ]) {
        expect(isButtonLabel(title), title).toBe(false);
      }
    });

    it("screenTitle returns date_or_heading for button labels", () => {
      const result = screenTitle("TICKETS AND INFO");
      expect(result).toEqual({
        kind: "date_or_heading",
        reason: "a button's label (tickets, more info, waiting list), not an event",
      });
    });

    it("screenTitle returns null for real event titles", () => {
      expect(screenTitle("The Big 90s Night")).toBeNull();
    });
  });
});
