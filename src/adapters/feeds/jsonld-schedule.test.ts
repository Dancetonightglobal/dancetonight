import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractJsonLd, jsonLdToListings } from "@/src/adapters/feeds/jsonld";

describe("JSON-LD weekly eventSchedule (D-513)", () => {
  const baseUrl = "https://mapadosamba.com.br/roda/";
  const fetchedAt = new Date("2026-10-31T12:00:00Z");
  const options = {
    pageUrl: "",
    fetchedAt,
    metroTz: "America/Sao_Paulo",
    countryCode: "BR",
    fromNight: "2026-10-31",
  };

  it("bip-bip: Thu+Sun, untimed", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__/mapadosamba-bip-bip.html"),
      "utf8",
    );
    const { blocks } = extractJsonLd(html);
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: `${baseUrl}bip-bip`,
    });
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=TH,SU",
      dtstartLocal: "2026-11-01T12:00",
      exdates: [],
      timeListed: false,
    });
    expect(listing.listing.local_date).toBe("2026-11-01");
    expect(listing.venueLocation?.lat).toBeCloseTo(-22.95151);
  });

  it("pagode-da-garagem: Tue, 18:00", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__/mapadosamba-pagode-da-garagem.html"),
      "utf8",
    );
    const { blocks } = extractJsonLd(html);
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: `${baseUrl}pagode-da-garagem`,
    });
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      dtstartLocal: "2026-11-03T18:00",
      exdates: [],
    });
    expect(listing.listing.local_date).toBe("2026-11-03");
  });

  it("beco-do-rato: all days, 19:00", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__/mapadosamba-beco-do-rato.html"),
      "utf8",
    );
    const { blocks } = extractJsonLd(html);
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: `${baseUrl}beco-do-rato`,
    });
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU",
      dtstartLocal: "2026-10-31T19:00",
      exdates: [],
    });
    expect(listing.listing.local_date).toBe("2026-10-31");
  });

  it("samba-do-trabalhador: Mon, untimed", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__/mapadosamba-samba-do-trabalhador.html"),
      "utf8",
    );
    const { blocks } = extractJsonLd(html);
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: `${baseUrl}samba-do-trabalhador`,
    });
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.recurrence).toEqual({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstartLocal: "2026-11-02T12:00",
      exdates: [],
      timeListed: false,
    });
    expect(listing.listing.local_date).toBe("2026-11-02");
  });

  it("poeira-pura: monthly written as weekly, skipped", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__/mapadosamba-poeira-pura.html"),
      "utf8",
    );
    const { blocks } = extractJsonLd(html);
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: `${baseUrl}poeira-pura`,
    });
    expect(listings).toHaveLength(0);
    expect(notes).toEqual([expect.stringContaining("monthly night written as weekly, skipped")]);
  });

  it("3preto-bar: untimed weekly (FR,SA,SU)", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__/mapadosamba-3preto-bar.html"),
      "utf8",
    );
    const { blocks } = extractJsonLd(html);
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: `${baseUrl}3preto-bar`,
    });
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.recurrence).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=FR,SA,SU",
    });
    expect(listing.recurrence?.timeListed).toBe(false);
  });

  describe("guard table", () => {
    const makeBlock = (byDay: string[], description: string) => ({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Test Roda",
      url: "https://mapadosamba.com.br/roda/test",
      eventSchedule: {
        "@type": "Schedule",
        repeatFrequency: "P1W",
        byDay,
      },
      description,
      location: {
        "@type": "Place",
        name: "Test Venue",
        address: "123 Test St",
      },
    });

    it.each([
      ["Segunda, Toda segunda, a partir das 19h", 1],
      ["Segunda, terça, quarta, quinta, sexta, sábado e domingo, a partir das 19:00", 1],
      ["Sexta, a partir da primeira sexta do mês", 0],
      ["Roda quinzenal", 0],
      ["a cada 15 dias", 0],
      ["1º e 3º sábado", 0],
      ["segunda sexta de cada mês", 0],
      ["Samba mensal", 0],
    ])("description '%s' -> %d listing(s)", (desc, expected) => {
      const blocks = [makeBlock(["Monday"], desc)];
      const { listings, notes } = jsonLdToListings(blocks, {
        ...options,
        pageUrl: "https://mapadosamba.com.br/roda/test",
      });
      expect(listings).toHaveLength(expected);
      if (expected === 0) {
        expect(notes[0]).toMatch(/monthly night written as weekly, skipped/);
      }
    });
  });

  it("two times in description -> untimed", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Two Times",
        url: "https://mapadosamba.com.br/roda/two",
        eventSchedule: {
          "@type": "Schedule",
          repeatFrequency: "P1W",
          byDay: ["Friday"],
        },
        description: "a partir das 18h, roda às 20h",
        location: {
          "@type": "Place",
          name: "Venue",
          address: "Addr",
        },
      },
    ];
    const { listings } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: "https://mapadosamba.com.br/roda/two",
    });
    expect(listings).toHaveLength(1);
    expect(listings[0]!.recurrence?.timeListed).toBe(false);
  });

  it("sidebar schedule for another page, skipped", () => {
    const html = readFileSync(
      path.join(__dirname, "__fixtures__/mapadosamba-bip-bip.html"),
      "utf8",
    );
    const { blocks } = extractJsonLd(html);
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: `${baseUrl}other`,
    });
    expect(listings).toHaveLength(0);
    expect(notes[0]).toMatch(/weekly schedule for another page, skipped/);
  });

  it("startTime wins over description", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "StartTime Test",
        url: "https://mapadosamba.com.br/roda/starttime",
        eventSchedule: {
          "@type": "Schedule",
          repeatFrequency: "P1W",
          byDay: ["Friday"],
          startTime: "21:30",
        },
        description: "a partir das 19h",
        location: {
          "@type": "Place",
          name: "Venue",
          address: "Addr",
        },
      },
    ];
    const { listings } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: "https://mapadosamba.com.br/roda/starttime",
    });
    expect(listings).toHaveLength(1);
    expect(listings[0]!.recurrence?.dtstartLocal).toBe("2026-11-06T21:30");
  });

  it("non-weekly repeatFrequency -> no readable start", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Monthly",
        url: "https://mapadosamba.com.br/roda/monthly",
        eventSchedule: {
          "@type": "Schedule",
          repeatFrequency: "P1M",
          byDay: ["Friday"],
        },
        description: "Monthly event",
        location: {
          "@type": "Place",
          name: "Venue",
          address: "Addr",
        },
      },
    ];
    const { listings, notes } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: "https://mapadosamba.com.br/roda/monthly",
    });
    expect(listings).toHaveLength(0);
    expect(notes[0]).toMatch(/no readable start/);
  });

  it("block with startDate ignores eventSchedule", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Dated Event",
        startDate: "2026-11-01T20:00:00-03:00",
        url: "https://mapadosamba.com.br/roda/dated",
        eventSchedule: {
          "@type": "Schedule",
          repeatFrequency: "P1W",
          byDay: ["Friday"],
        },
        location: {
          "@type": "Place",
          name: "Venue",
          address: "Addr",
        },
      },
    ];
    const { listings } = jsonLdToListings(blocks, {
      ...options,
      pageUrl: "https://mapadosamba.com.br/roda/dated",
    });
    expect(listings).toHaveLength(1);
    expect(listings[0]!.recurrence).toBeNull();
  });

  describe("no repeatFrequency", () => {
    const dubaiOptions = {
      pageUrl: "https://papadubai.ae/bad-decisions",
      fetchedAt: new Date("2026-11-07T12:00:00Z"),
      metroTz: "Asia/Dubai",
      countryCode: "AE",
      fromNight: "2026-11-07",
    };

    it("byDay string, startTime, no repeatFrequency -> weekly listing", () => {
      const blocks = [
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: "Bad Decisions",
          url: "https://papadubai.ae/bad-decisions",
          eventSchedule: {
            "@type": "Schedule",
            byDay: "Monday",
            startTime: "23:00",
            endTime: "04:00",
          },
          location: {
            "@type": "Place",
            name: "Papa Dubai",
            address: "V Hotel, Atrium Level 3, Al Habtoor City",
          },
        },
      ];
      const { listings, notes } = jsonLdToListings(blocks, dubaiOptions);
      expect(notes).toEqual([]);
      expect(listings).toHaveLength(1);
      const listing = listings[0]!;
      expect(listing.recurrence).toEqual({
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstartLocal: "2026-11-09T23:00",
        exdates: [],
      });
      expect(listing.listing.local_date).toBe("2026-11-09");
    });

    it("byDay URL form -> weekly listing", () => {
      const blocks = [
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: "Bad Decisions",
          url: "https://papadubai.ae/bad-decisions",
          eventSchedule: {
            "@type": "Schedule",
            byDay: ["https://schema.org/Monday"],
            startTime: "23:00",
          },
          location: {
            "@type": "Place",
            name: "Papa Dubai",
            address: "V Hotel, Atrium Level 3, Al Habtoor City",
          },
        },
      ];
      const { listings, notes } = jsonLdToListings(blocks, dubaiOptions);
      expect(notes).toEqual([]);
      expect(listings).toHaveLength(1);
      const listing = listings[0]!;
      expect(listing.recurrence).toMatchObject({
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        dtstartLocal: "2026-11-09T23:00",
      });
    });

    it("byDay with byMonthDay -> not weekly", () => {
      const blocks = [
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: "Bad Decisions",
          url: "https://papadubai.ae/bad-decisions",
          eventSchedule: {
            "@type": "Schedule",
            byDay: "Monday",
            startTime: "23:00",
            byMonthDay: 1,
          },
          location: {
            "@type": "Place",
            name: "Papa Dubai",
            address: "V Hotel, Atrium Level 3, Al Habtoor City",
          },
        },
      ];
      const { listings, notes } = jsonLdToListings(blocks, dubaiOptions);
      expect(listings).toHaveLength(0);
      expect(notes[0]).toMatch(/no readable start/);
    });

    it("repeatFrequency P1M -> not weekly", () => {
      const blocks = [
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: "Bad Decisions",
          url: "https://papadubai.ae/bad-decisions",
          eventSchedule: {
            "@type": "Schedule",
            byDay: "Monday",
            startTime: "23:00",
            repeatFrequency: "P1M",
          },
          location: {
            "@type": "Place",
            name: "Papa Dubai",
            address: "V Hotel, Atrium Level 3, Al Habtoor City",
          },
        },
      ];
      const { listings, notes } = jsonLdToListings(blocks, dubaiOptions);
      expect(listings).toHaveLength(0);
      expect(notes[0]).toMatch(/no readable start/);
    });

    it("weekly schedule for another page, skipped", () => {
      const blocks = [
        {
          "@context": "https://schema.org",
          "@type": "Event",
          name: "La Santa",
          url: "https://papadubai.ae/la-santa",
          eventSchedule: {
            "@type": "Schedule",
            byDay: "Monday",
            startTime: "23:00",
          },
          location: {
            "@type": "Place",
            name: "Papa Dubai",
            address: "V Hotel, Atrium Level 3, Al Habtoor City",
          },
        },
      ];
      const { listings, notes } = jsonLdToListings(blocks, dubaiOptions);
      expect(listings).toHaveLength(0);
      expect(notes[0]).toMatch(/weekly schedule for another page, skipped/);
    });
  });
});
