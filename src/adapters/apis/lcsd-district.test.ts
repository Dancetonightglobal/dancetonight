// Contract for D-740: an LCSD event listed at a district placeholder ("Venues in Sha Tin district")
// takes each session's own venue from the Chinese description's session list (日期 / 地點 lines).
// D-583 permission covers facts only: the venue name is a fact; no description text may reach a row.
import { describe, expect, it } from "vitest";
import { lcsdToListings, parseLcsdDescVenues } from "@/src/adapters/apis/lcsd";
import type { Metro } from "@/src/adapters/types";

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

const NIGHTS = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 10, 3 + i));
  return d.toISOString().slice(0, 10);
});

const DESCC_189347 = `針對區內長者而設的全新工作坊，共八節的課堂。舞蹈藝術家藉著「藝術在公園」的主題，引領參加者重新感受自然空間。

工作坊(1)：
日期：29.10.2026 (四)
時間：10:00-12:00
地點：沙田公園露天劇場

工作坊(2)：
日期：3.11.2026 (二)
時間：10:00-12:00
地點：馬鞍山公園太極場

工作坊(3)：
日期：5.11.2026 (四)
時間：10:00-12:00
地點：沙田公園露天劇場

工作坊(4)：
日期：10.11.2026 (二)
時間：10:00-12:00
地點：顯田遊樂場太極場

網上登記：
https://www.art-mate.net/doc/100449?test=1

每場工作坊長約兩小時。
名額有限，先到先得，額滿即止。`;

const VENUES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<venues>
  <venue id="8344">
    <venuec><![CDATA[沙田區內場地]]></venuec>
    <venuee><![CDATA[Venues in Sha Tin district]]></venuee>
    <latitude />
    <longitude />
  </venue>
  <venue id="50110">
    <venuec><![CDATA[香港文化中心大劇院]]></venuec>
    <venuee><![CDATA[Hong Kong Cultural Centre Grand Theatre]]></venuee>
    <latitude><![CDATA[22.2937]]></latitude>
    <longitude><![CDATA[114.1700]]></longitude>
  </venue>
</venues>`;

function eventXml(id: string, venueid: string, predateE: string, descc: string): string {
  return `  <event id="${id}">
    <titlec><![CDATA[《身體年輪》長者舞蹈計劃──「野向公園玩藝術」工作坊]]></titlec>
    <titlee><![CDATA["Body in Time" Elderly Dance Project — Arts in the Park Workshops]]></titlee>
    <cat2><![CDATA[inc4sc3]]></cat2>
    <predateE><![CDATA[${predateE}]]></predateE>
    <progtimee><![CDATA[2 Hours]]></progtimee>
    <venueid><![CDATA[${venueid}]]></venueid>
    <pricee><![CDATA[Free Activities]]></pricee>
    <descc><![CDATA[${descc}]]></descc>
    <desce><![CDATA[Please refer to the Chinese version.]]></desce>
    <tagenturle />
  </event>`;
}

function run(events: string[]) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<events>\n${events.join("\n")}\n</events>`;
  return lcsdToListings(xml, VENUES_XML, {
    metro: HONG_KONG,
    nights: NIGHTS,
    fetchedAt: new Date("2026-11-05T00:00:00Z"),
  });
}

const PREDATE_189347 = `29/10/2026 (Thu) 10am
03/11/2026 (Tue) 10am
05/11/2026 (Thu) 10am
10/11/2026 (Tue) 10am`;

describe("parseLcsdDescVenues", () => {
  it("pairs each session date with its own venue", () => {
    const map = parseLcsdDescVenues(DESCC_189347);
    expect(Object.fromEntries(map)).toEqual({
      "2026-10-29": "沙田公園露天劇場",
      "2026-11-03": "馬鞍山公園太極場",
      "2026-11-05": "沙田公園露天劇場",
      "2026-11-10": "顯田遊樂場太極場",
    });
  });

  it("reads a list of days sharing one month and a slashed date", () => {
    const map = parseLcsdDescVenues(
      "新進工作坊(A班)：\n日期：1, 8, 15.12.2026 (二)\n時間：09:00-11:00\n地點：瀝源社區會堂\n\n" +
        "新進工作坊(B班)：\n日期：15 / 11 / 2026（日）\n時間：10:00-12:00\n地點: 秦石社區會堂",
    );
    expect(Object.fromEntries(map)).toEqual({
      "2026-12-01": "瀝源社區會堂",
      "2026-12-08": "瀝源社區會堂",
      "2026-12-15": "瀝源社區會堂",
      "2026-11-15": "秦石社區會堂",
    });
  });

  it("reads no date from a range, and nothing from text without session lines", () => {
    expect(parseLcsdDescVenues("日期：10.10-7.11.2026 (詳細日期)\n地點：沙田公園").size).toBe(0);
    expect(parseLcsdDescVenues("日期：6.9.2026-20.12.2026\n地點：沙田公園").size).toBe(0);
    expect(parseLcsdDescVenues("「節拍部落」邀請你踏上一場獨特的遊牧旅程。").size).toBe(0);
    expect(parseLcsdDescVenues("").size).toBe(0);
  });

  it("keeps the first venue when one date is listed twice", () => {
    const map = parseLcsdDescVenues("日期：5.11.2026\n地點：甲場地\n日期：5.11.2026\n地點：乙場地");
    expect(map.get("2026-11-05")).toBe("甲場地");
  });
});

describe("lcsdToListings at a district placeholder (D-740)", () => {
  it("gives each night the session's own venue and a geocodable address", () => {
    const { listings } = run([eventXml("189347", "8344", PREDATE_189347, DESCC_189347)]);
    const byNight = new Map(listings.map((l) => [l.listing.local_date, l]));
    expect([...byNight.keys()].sort()).toEqual(["2026-11-03", "2026-11-05", "2026-11-10"]);
    expect(byNight.get("2026-11-03")?.listing.venue).toMatchObject({
      name: "馬鞍山公園太極場",
      address: "馬鞍山公園太極場, Sha Tin, Hong Kong",
    });
    expect(byNight.get("2026-11-03")?.venueLocation).toBeNull();
    expect(byNight.get("2026-11-05")?.listing.venue.name).toBe("沙田公園露天劇場");
    expect(byNight.get("2026-11-10")?.listing.venue.address).toBe(
      "顯田遊樂場太極場, Sha Tin, Hong Kong",
    );
  });

  it("stores no description text anywhere in the rows", () => {
    const { listings, notes, screened } = run([
      eventXml("189347", "8344", PREDATE_189347, DESCC_189347),
    ]);
    expect(listings.length).toBeGreaterThan(0);
    const stored = JSON.stringify({ listings, notes, screened });
    for (const fragment of [
      "針對區內長者",
      "藝術家",
      "名額有限",
      "每場工作坊",
      "工作坊(",
      "日期",
      "時間",
      "地點",
      "art-mate",
      "Chinese version",
    ]) {
      expect(stored).not.toContain(fragment);
    }
  });

  it("keeps the placeholder when the description names no venue for that night", () => {
    const { listings } = run([
      eventXml(
        "189298",
        "8344",
        "05/11/2026 (Thu) 15:00",
        "「節拍部落」邀請你踏上一場獨特的遊牧旅程。",
      ),
    ]);
    expect(listings).toHaveLength(1);
    expect(listings[0]?.listing.venue).toMatchObject({
      name: "Venues in Sha Tin district",
      address: null,
    });
    expect(listings[0]?.venueLocation).toBeNull();
  });

  it("never overrides a real venue", () => {
    const { listings } = run([eventXml("189999", "50110", "05/11/2026 (Thu) 15:00", DESCC_189347)]);
    expect(listings).toHaveLength(1);
    expect(listings[0]?.listing.venue).toMatchObject({
      name: "Hong Kong Cultural Centre Grand Theatre",
      address: null,
    });
    expect(listings[0]?.venueLocation).toEqual({ lat: 22.2937, lng: 114.17 });
  });
});

describe("parseLcsdDescVenues, calendar check", () => {
  it("reads no date that is not on the calendar", () => {
    expect(parseLcsdDescVenues("日期：31.2.2026\n地點：沙田公園").size).toBe(0);
    expect(parseLcsdDescVenues("日期：30, 31.11.2026\n地點：沙田公園")).toEqual(
      new Map([["2026-11-30", "沙田公園"]]),
    );
  });
});
