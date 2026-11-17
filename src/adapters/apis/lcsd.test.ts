import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  lcsdAdapter,
  lcsdToListings,
  parseLcsdDates,
  LCSD_VENUES_URL,
  LCSD_EVENTS_URL,
} from "@/src/adapters/apis/lcsd";
import type { Metro, RunCtx } from "@/src/adapters/types";

const HONG_KONG: Metro = {
  id: "mHK",
  slug: "hong-kong",
  name: "Hong Kong",
  countryCode: "HK",
  center: { lat: 22.3193, lng: 114.1694 },
  radiusKm: 30,
  tz: "Asia/Hong_Kong",
  languages: ["en", "zh"],
};

const NIGHTS = [
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
  "2026-11-08",
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
  "2026-11-16",
];

describe("LCSD", () => {
  it("parseLcsdDates handles various formats", () => {
    expect(parseLcsdDates("07/11/2026 (Sat) 15:00")).toMatchObject([
      { date: "2026-11-07", time: "15:00", line: "07/11/2026 (Sat) 15:00" },
    ]);
    expect(parseLcsdDates("29/10/2026 (Thu) 10am")).toMatchObject([
      { date: "2026-10-29", time: "10:00", line: "29/10/2026 (Thu) 10am" },
    ]);
    expect(parseLcsdDates("03/11/2026 (Tue) 7:30pm")).toMatchObject([
      { date: "2026-11-03", time: "19:30", line: "03/11/2026 (Tue) 7:30pm" },
    ]);
    expect(parseLcsdDates("13/11/2026 (Fri)\n10:00, 14:00\n14/11/2026 (Sat)\n10:00")).toMatchObject(
      [
        { date: "2026-11-13", time: "10:00", line: "13/11/2026 (Fri)" },
        { date: "2026-11-13", time: "14:00", line: "13/11/2026 (Fri)" },
        { date: "2026-11-14", time: "10:00", line: "14/11/2026 (Sat)" },
      ],
    );
    expect(parseLcsdDates("30/10-14/11/2026 (Fri-Sat)")).toEqual([]);
    expect(parseLcsdDates("13/11/2026 (Fri) 20:00, 14:00").map((o) => o.time)).toEqual([
      "20:00",
      "14:00",
    ]);
    expect(parseLcsdDates("08/11/2026 (Sun)\n22/11/2026 (Sun)")).toMatchObject([
      { date: "2026-11-08", time: null, line: "08/11/2026 (Sun)" },
      { date: "2026-11-22", time: null, line: "22/11/2026 (Sun)" },
    ]);
    // New tests for time ranges
    expect(parseLcsdDates("07/11/2026 (Sat) 2:30pm - 4:30pm")).toMatchObject([
      { date: "2026-11-07", time: "14:30", line: "07/11/2026 (Sat) 2:30pm - 4:30pm" },
    ]);
    expect(parseLcsdDates("07/11/2026 (Sat) 10:00am-12:00nn")).toMatchObject([
      { date: "2026-11-07", time: "10:00", line: "07/11/2026 (Sat) 10:00am-12:00nn" },
    ]);
    expect(parseLcsdDates("07/11/2026 (Sat) 12:00nn")).toMatchObject([
      { date: "2026-11-07", time: "12:00", line: "07/11/2026 (Sat) 12:00nn" },
    ]);
    expect(parseLcsdDates("07/11/2026 (Sat) 1930-2130")).toMatchObject([
      { date: "2026-11-07", time: "19:30", line: "07/11/2026 (Sat) 1930-2130" },
    ]);
    expect(parseLcsdDates("07/11/2026 (Sat) evening")).toMatchObject([
      { date: "2026-11-07", time: null, line: "07/11/2026 (Sat) evening" },
    ]);
  });

  it("lcsdToListings keeps 189347 workshops on correct nights", () => {
    const eventsXml = `<?xml version="1.0" encoding="UTF-8"?>
<events>
  <event id="189347">
    <titlec><![CDATA[2026-27年度「十八有藝──沙田社區演藝計劃」《身體年輪》長者舞蹈計劃──「野向公園玩藝術」工作坊]]></titlec>
    <titlee><![CDATA[2026-27 "18dART — Community Arts Scheme in Sha Tin" — "Body in Time" Elderly Dance Project — Arts in the Park Workshops]]></titlee>
    <cat1><![CDATA[inc4]]></cat1>
    <cat2><![CDATA[inc4sc3]]></cat2>
    <predateC><![CDATA[29/10/2026 (四) 上午10時
03/11/2026 (二) 上午10時
05/11/2026 (四) 上午10時
10/11/2026 (二) 上午10時
12/11/2026 (四) 上午10時
17/11/2026 (二) 上午10時
19/11/2026 (四) 上午10時
24/11/2026 (二) 上午10時]]></predateC>
    <predateE><![CDATA[29/10/2026 (Thu) 10am
03/11/2026 (Tue) 10am
05/11/2026 (Thu) 10am
10/11/2026 (Tue) 10am
12/11/2026 (Thu) 10am
17/11/2026 (Tue) 10am
19/11/2026 (Thu) 10am
24/11/2026 (Tue) 10am]]></predateE>
    <progtimec><![CDATA[2小時]]></progtimec>
    <progtimee><![CDATA[2 Hours]]></progtimee>
    <venueid><![CDATA[8344]]></venueid>
    <agelimitc />
    <agelimite />
    <pricec><![CDATA[免費節目]]></pricec>
    <pricee><![CDATA[Free Activities]]></pricee>
    <descc><![CDATA[]]></descc>
    <desce><![CDATA[]]></desce>
    <urlc><![CDATA[https://www.unlock.com.hk]]></urlc>
    <urle><![CDATA[https://www.unlock.com.hk]]></urle>
    <tagenturlc />
    <tagenturle />
    <remarkc><![CDATA[憑登記免費入場]]></remarkc>
    <remarke><![CDATA[Free admission by registration]]></remarke>
    <enquiry><![CDATA[2778 3488]]></enquiry>
    <fax />
    <email><![CDATA[admin@unlock.com.hk]]></email>
    <saledate />
    <interbook />
    <presenterorgc><![CDATA[不加鎖舞踊館主辦]]></presenterorgc>
    <presenterorge><![CDATA[Presented by Unlock Dancing Plaza]]></presenterorge>
    <prog_image />
    <detail_image1 />
    <detail_image2 />
    <detail_image3 />
    <detail_image4 />
    <detail_image5 />
    <video_link />
    <video2_link />
    <submitdate><![CDATA[2026-11-02 21:00:55.000]]></submitdate>
  </event>
</events>`;
    const venuesXml = `<?xml version="1.0" encoding="UTF-8"?>
<venues>
  <venue id="8344">
    <venuec><![CDATA[沙田區內場地]]></venuec>
    <venuee><![CDATA[Venues in Sha Tin district]]></venuee>
    <latitude />
    <longitude />
  </venue>
</venues>`;

    const { listings, screened } = lcsdToListings(eventsXml, venuesXml, {
      metro: HONG_KONG,
      nights: NIGHTS,
      fetchedAt: new Date("2026-11-02T09:00:00Z"),
    });

    expect(listings).toHaveLength(4); // 03,05,10,12 Nov
    expect(screened).toHaveLength(0);
    const listing = listings[0]!;
    expect(listing.externalId).toMatch(/^lcsd:189347:2026-11-03T10:00$/);
    expect(listing.listing.title).toBe(
      '2026-27 "18dART — Community Arts Scheme in Sha Tin" — "Body in Time" Elderly Dance Project — Arts in the Park Workshops',
    );
    expect(listing.listing.local_date).toBe("2026-11-03");
    expect(listing.listing.doors_time).toBe("10:00");
    expect(listing.listing.end_time).toBe("12:00"); // 2 hours later
    expect(listing.listing.prices).toEqual([
      { label: "Free", amount: 0, currency: "HKD", includes: null },
    ]);
    expect(listing.venueLocation).toBeNull();
    expect(listing.eventUrl).toBe(
      "https://www.lcsd.gov.hk/clpss/en/search/culture/DetailForm.do?id=189347",
    );
    // description is not included in the listing
  });

  it("keeps Sankofa interactive drumming", () => {
    const eventsXml = `<?xml version="1.0" encoding="UTF-8"?>
<events>
  <event id="189294">
    <titlec><![CDATA[2026社區文化大使: 香港非洲藝術文化協會「節拍部落」互動鼓舞巡演]]></titlec>
    <titlee><![CDATA[Community Cultural Ambassador 2026: Sankofa Hong Kong African Arts and Culture Association 'The Rhythm Tribe' Interactive Drumming and Dance Performance]]></titlee>
    <cat1><![CDATA[inc9]]></cat1>
    <cat2><![CDATA[inc9sc3]]></cat2>
    <predateC><![CDATA[07/11/2026 (六) 15:00]]></predateC>
    <predateE><![CDATA[7/11/2026 (Sat) 15:00]]></predateE>
    <progtimec><![CDATA[節目約長1小時]]></progtimec>
    <progtimee><![CDATA[Duration: Approximately 1 hours]]></progtimee>
    <venueid><![CDATA[8332]]></venueid>
    <agelimitc />
    <agelimite />
    <pricec><![CDATA[免費節目]]></pricec>
    <pricee><![CDATA[Free Activities]]></pricee>
    <descc><![CDATA[]]></descc>
    <desce><![CDATA[]]></desce>
    <urlc><![CDATA[https://www.instagram.com/sankofa.hk]]></urlc>
    <urle><![CDATA[https://www.instagram.com/sankofa.hk]]></urle>
    <tagenturlc />
    <tagenturle />
    <remarkc />
    <remarke />
    <enquiry />
    <fax />
    <email />
    <saledate />
    <interbook />
    <presenterorgc><![CDATA[香港非洲藝術文化協會主辦]]></presenterorgc>
    <presenterorge><![CDATA[Presented by Sankofa Hong Kong African Arts and Culture Association]]></presenterorge>
    <prog_image />
    <detail_image1 />
    <detail_image2 />
    <detail_image3 />
    <detail_image4 />
    <detail_image5 />
    <video_link />
    <video2_link />
    <submitdate><![CDATA[2026-11-02 21:01:00.000]]></submitdate>
  </event>
</events>`;
    const venuesXml = `<?xml version="1.0" encoding="UTF-8"?>
<venues>
  <venue id="8332">
    <venuec><![CDATA[東區區內場地]]></venuec>
    <venuee><![CDATA[Venues in Eastern district]]></venuee>
    <latitude />
    <longitude />
  </venue>
</venues>`;

    const { listings, screened } = lcsdToListings(eventsXml, venuesXml, {
      metro: HONG_KONG,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(1);
    expect(screened).toHaveLength(0);
    expect(listings[0]!.listing.local_date).toBe("2026-11-07");
    expect(listings[0]!.listing.doors_time).toBe("15:00");
    expect(listings[0]!.listing.end_time).toBe("16:00");
  });

  it("screens term classes, non-participatory, no price", () => {
    // Use the full fixture files
    const eventsXml = readFileSync(join(__dirname, "__fixtures__", "lcsd-events.xml"), "utf8");
    const venuesXml = readFileSync(join(__dirname, "__fixtures__", "lcsd-venues.xml"), "utf8");

    const { screened } = lcsdToListings(eventsXml, venuesXml, {
      metro: HONG_KONG,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    const reasons = screened.map((s) => s.reason);
    expect(reasons).toContain("a term class (weekly course, enrolment by phone; D-583)");
    expect(reasons).toContain(
      "a show, competition, exhibition or screening, not something people join (D-570)",
    );
    expect(reasons).toContain("no price, free entry or booking listed (D-583)");
  });

  it("ignores non-dance cat2", () => {
    const eventsXml = `<?xml version="1.0" encoding="UTF-8"?>
<events>
  <event id="188359">
    <titlec><![CDATA[「冬日開懷集」系列：厘米概念《小蟻大暴走》]]></titlec>
    <titlee><![CDATA['Cheers!' Series: 'ANTNETIC LOST' by Creman Concept]]></titlee>
    <cat1><![CDATA[inc4]]></cat1>
    <cat2><![CDATA[inc4sc7]]></cat2>
    <predateC><![CDATA[11/12/2026 (五) 19:30
12/12/2026 (六) 15:00, 19:30
13/12/2026 (日) 11:00, 15:00]]></predateC>
    <predateE><![CDATA[11/12/2026 (Fri) 19:30
12/12/2026 (Sat) 15:00, 19:30
13/12/2026 (Sun) 11:00, 15:00]]></predateE>
    <progtimec><![CDATA[每場演出長約1小時，不設中場休息。]]></progtimec>
    <progtimee><![CDATA[The running time of each performance is approximately 1 hour without intermission.]]></progtimee>
    <venueid><![CDATA[50110016]]></venueid>
    <agelimitc><![CDATA[適合6歲或以上觀眾欣賞]]></agelimitc>
    <agelimite><![CDATA[Suitable for ages 6 and above]]></agelimite>
    <pricec><![CDATA[$300]]></pricec>
    <pricee><![CDATA[$300]]></pricee>
    <descc><![CDATA[]]></descc>
    <desce><![CDATA[]]></desce>
    <urlc><![CDATA[https://cmconcept.hk/]]></urlc>
    <urle><![CDATA[https://cmconcept.hk/]]></urle>
    <tagenturlc><![CDATA[https://www.urbtix.hk/]]></tagenturlc>
    <tagenturle><![CDATA[https://www.urbtix.hk/]]></tagenturle>
    <remarkc />
    <remarke />
    <enquiry><![CDATA[5100 2254]]></enquiry>
    <fax />
    <email />
    <saledate><![CDATA[2026-10-14 00:00:00.000]]></saledate>
    <interbook><![CDATA[Y]]></interbook>
    <presenterorgc><![CDATA[厘米概念主辦]]></presenterorgc>
    <presenterorge><![CDATA[Presented by Creman Concept]]></presenterorge>
    <prog_image />
    <detail_image1 />
    <detail_image2 />
    <detail_image3 />
    <detail_image4 />
    <detail_image5 />
    <video_link />
    <video2_link />
    <submitdate><![CDATA[2026-11-02 21:01:00.000]]></submitdate>
  </event>
</events>`;
    const venuesXml = `<?xml version="1.0" encoding="UTF-8"?>
<venues>
  <venue id="50110016">
    <venuec><![CDATA[香港文化中心 (劇場)]]></venuec>
    <venuee><![CDATA[Hong Kong Cultural Centre (Studio Theatre)]]></venuee>
    <latitude><![CDATA[22.29386]]></latitude>
    <longitude><![CDATA[114.17053]]></longitude>
  </venue>
</venues>`;

    const { listings, screened } = lcsdToListings(eventsXml, venuesXml, {
      metro: HONG_KONG,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(0);
    expect(screened).toHaveLength(0); // ignored silently
  });

  it("harvestMetro with fake http", async () => {
    const eventsXml = readFileSync(join(__dirname, "__fixtures__", "lcsd-events.xml"), "utf8");
    const venuesXml = readFileSync(join(__dirname, "__fixtures__", "lcsd-venues.xml"), "utf8");

    const mockHttp = {
      request: async (opts: { url: string }) => {
        if (opts.url === LCSD_VENUES_URL) {
          return {
            body: venuesXml,
            fetchedAt: new Date("2026-11-02T09:00:00Z"),
          };
        }
        if (opts.url === LCSD_EVENTS_URL) {
          return {
            body: eventsXml,
            fetchedAt: new Date("2026-11-02T09:00:00Z"),
          };
        }
        throw new Error(`Unexpected URL: ${opts.url}`);
      },
    };

    const ctx = {
      http: mockHttp,
      now: () => new Date("2026-11-02T09:00:00Z"),
    };

    const result = await lcsdAdapter.harvestMetro!(HONG_KONG, NIGHTS, ctx as unknown as RunCtx);
    expect(result.listings.length).toBeGreaterThan(0);
    expect((result.notes ?? []).some((note) => note.includes("events in the LCSD feed"))).toBe(
      true,
    );
    expect(result.doc?.url).toBe(LCSD_EVENTS_URL);
  });

  it("harvestMetro throws on empty venues feed", async () => {
    const eventsXml = readFileSync(join(__dirname, "__fixtures__", "lcsd-events.xml"), "utf8");
    const venuesXml = '<?xml version="1.0"?><venues></venues>';

    const mockHttp = {
      request: async (opts: { url: string }) => {
        if (opts.url === LCSD_VENUES_URL) {
          return {
            body: venuesXml,
            fetchedAt: new Date("2026-11-02T09:00:00Z"),
          };
        }
        if (opts.url === LCSD_EVENTS_URL) {
          return {
            body: eventsXml,
            fetchedAt: new Date("2026-11-02T09:00:00Z"),
          };
        }
        throw new Error(`Unexpected URL: ${opts.url}`);
      },
    };

    const ctx = {
      http: mockHttp,
      now: () => new Date("2026-11-02T09:00:00Z"),
    };

    await expect(
      lcsdAdapter.harvestMetro!(HONG_KONG, NIGHTS, ctx as unknown as RunCtx),
    ).rejects.toThrow("LCSD feed empty: venues.xml had no <venue> blocks");
  });

  it("harvestMetro throws on empty events feed", async () => {
    const eventsXml = '<?xml version="1.0"?><events></events>';
    const venuesXml = readFileSync(join(__dirname, "__fixtures__", "lcsd-venues.xml"), "utf8");

    const mockHttp = {
      request: async (opts: { url: string }) => {
        if (opts.url === LCSD_VENUES_URL) {
          return {
            body: venuesXml,
            fetchedAt: new Date("2026-11-02T09:00:00Z"),
          };
        }
        if (opts.url === LCSD_EVENTS_URL) {
          return {
            body: eventsXml,
            fetchedAt: new Date("2026-11-02T09:00:00Z"),
          };
        }
        throw new Error(`Unexpected URL: ${opts.url}`);
      },
    };

    const ctx = {
      http: mockHttp,
      now: () => new Date("2026-11-02T09:00:00Z"),
    };

    await expect(
      lcsdAdapter.harvestMetro!(HONG_KONG, NIGHTS, ctx as unknown as RunCtx),
    ).rejects.toThrow("LCSD feed empty: events.xml had no <event> blocks");
  });

  it("harvestMetro returns empty for non-hong-kong", async () => {
    const LONDON: Metro = {
      id: "m2",
      slug: "london",
      name: "London",
      countryCode: "GB",
      center: { lat: 51.5074, lng: -0.1278 },
      radiusKm: 50,
      tz: "Europe/London",
      languages: ["en"],
    };
    const ctx = {
      http: {
        request: async () => {
          throw new Error("should not be called");
        },
      },
      now: () => new Date(),
    };
    const result = await lcsdAdapter.harvestMetro!(LONDON, NIGHTS, ctx as unknown as RunCtx);
    expect(result.listings).toHaveLength(0);
    expect((result.notes ?? [])[0]).toBe("no LCSD feed for london");
    expect(result.doc?.url).toBe(LCSD_EVENTS_URL);
  });
});
