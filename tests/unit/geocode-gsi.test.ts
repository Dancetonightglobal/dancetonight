// Contract test for the GSI Japan-only fallback geocoder (D-1241). Written before the build.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Geocoder } from "@/src/pipeline/geocode";
import {
  gsiAnswer,
  gsiGeocoder,
  gsiQuery,
  gsiRefusal,
  gsiUrl,
  withJapanFallback,
} from "@/src/pipeline/geocode-gsi";
import { createPoliteHttp } from "@/src/pipeline/http";

const TOKYO: Metro = {
  id: "m",
  slug: "tokyo",
  name: "Tokyo",
  countryCode: "JP",
  center: { lat: 35.6762, lng: 139.6503 },
  radiusKm: 50,
  tz: "Asia/Tokyo",
  languages: ["ja", "en"],
};

const NYC: Metro = {
  id: "n",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};

const feature = (lng: number, lat: number, title: string) => ({
  geometry: { coordinates: [lng, lat], type: "Point" },
  type: "Feature",
  properties: { addressCode: "", title },
});

// Real bodies probed from msearch.gsi.go.jp on 2026-11-10.
const DOGENZAKA = [feature(139.699249, 35.657711, "東京都渋谷区道玄坂一丁目６番５号")];
const KANDA = [feature(139.779526, 35.697456, "東京都千代田区神田佐久間町四丁目７番地")];
const GOHONGI = [feature(139.685272, 35.636311, "東京都目黒区五本木二丁目１番１４号")];

const fakeHttp = (body: unknown) => {
  const urls: string[] = [];
  const http = createPoliteHttp({
    userAgent: "t",
    sleep: async () => {},
    transport: async (req) => {
      urls.push(req.url);
      return { url: req.url, status: 200, headers: {}, body: JSON.stringify(body) };
    },
  });
  return { http, urls };
};

const fixed = (
  point: { lat: number; lng: number } | null,
  why: string | null = null,
): Geocoder & {
  calls: string[];
} => {
  const calls: string[] = [];
  return {
    id: "fixed",
    calls,
    geocode: async (a) => {
      calls.push(a);
      return point;
    },
    building: async () => point,
    elsewhere: async () => "elsewhere-from-primary",
    refusal: async () => (point ? null : why),
  };
};

describe("gsiUrl", () => {
  it("url-encodes the address into the GSI address search", () => {
    expect(gsiUrl("東京都渋谷区道玄坂1-6-5")).toBe(
      "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" +
        encodeURIComponent("東京都渋谷区道玄坂1-6-5"),
    );
  });
});

describe("gsiQuery", () => {
  it("drops the postcode and anything after the last lot number", () => {
    expect(gsiQuery("〒111-0051 東京都台東区蔵前２丁目１−２３ 3F K2B")).toBe(
      "東京都台東区蔵前2丁目1-23",
    );
    expect(gsiQuery("東京都目黒区五本木2-1-14 b1")).toBe("東京都目黒区五本木2-1-14");
    expect(gsiQuery("渋谷区道玄坂1丁目6番5号 B1F")).toBe("渋谷区道玄坂1丁目6番5号");
  });
});

describe("gsiAnswer", () => {
  it("accepts a 番/号-level title whose 丁目 and 番 match the address (hyphen form)", () => {
    expect(gsiAnswer(DOGENZAKA, "東京都渋谷区道玄坂1-6-5", TOKYO)).toEqual({
      lat: 35.657711,
      lng: 139.699249,
    });
  });

  it("accepts the 丁目/番/号 written form and full-width digits in the address", () => {
    expect(gsiAnswer(DOGENZAKA, "渋谷区道玄坂1丁目6番5号 B1F", TOKYO)).not.toBeNull();
    expect(gsiAnswer(GOHONGI, "〒153-0053 東京都目黒区五本木２丁目１−１４", TOKYO)).not.toBeNull();
  });

  it("accepts a 番地 title (Kanda)", () => {
    expect(gsiAnswer(KANDA, "千代田区神田佐久間町4-7-3", TOKYO)).toEqual({
      lat: 35.697456,
      lng: 139.779526,
    });
  });

  it("refuses a town- or 丁目-level title", () => {
    const town = [feature(139.699, 35.657, "東京都渋谷区道玄坂一丁目")];
    expect(gsiAnswer(town, "東京都渋谷区道玄坂1-6-5", TOKYO)).toBeNull();
    expect(gsiRefusal(town, "東京都渋谷区道玄坂1-6-5", TOKYO)).toBe("gsi: too vague");
  });

  it("refuses when the 丁目 or 番 number differs from the address", () => {
    expect(gsiAnswer(DOGENZAKA, "東京都渋谷区道玄坂2-6-5", TOKYO)).toBeNull();
    expect(gsiAnswer(DOGENZAKA, "東京都渋谷区道玄坂1-7-5", TOKYO)).toBeNull();
    expect(gsiRefusal(DOGENZAKA, "東京都渋谷区道玄坂1-7-5", TOKYO)).toBe("gsi: too vague");
  });

  it("refuses when the title's ward is not named in the address", () => {
    expect(gsiAnswer(DOGENZAKA, "東京都新宿区道玄坂1-6-5", TOKYO)).toBeNull();
  });

  it("refuses the same ward and numbers in another town", () => {
    const kuramae = [feature(139.790268, 35.702099, "東京都台東区蔵前二丁目１番２３号")];
    expect(gsiAnswer(kuramae, "東京都台東区蔵前2-1-23", TOKYO)).not.toBeNull();
    expect(gsiAnswer(kuramae, "東京都台東区浅草2-1-23", TOKYO)).toBeNull();
    expect(gsiRefusal(kuramae, "東京都台東区浅草2-1-23", TOKYO)).toBe("gsi: too vague");
  });

  it("refuses a romaji answer that GSI matched to a single kanji elsewhere", () => {
    const junk = [feature(138.305145, 37.130356, "新潟県上越市二")];
    expect(gsiAnswer(junk, "2-26-1 Nishiasakusa, Taito-ku, Tokyo", TOKYO)).toBeNull();
  });

  it("refuses a matching answer outside the metro", () => {
    const niigata = [feature(138.2445, 37.1478, "新潟県上越市本町一丁目６番５号")];
    expect(gsiAnswer(niigata, "新潟県上越市本町1-6-5", TOKYO)).toBeNull();
    expect(gsiRefusal(niigata, "新潟県上越市本町1-6-5", TOKYO)).toBe("gsi: outside metro");
  });

  it("uses only the first feature", () => {
    const two = [feature(139.699, 35.657, "東京都渋谷区道玄坂一丁目"), DOGENZAKA[0]];
    expect(gsiAnswer(two, "東京都渋谷区道玄坂1-6-5", TOKYO)).toBeNull();
  });

  it("returns no answer for an empty or malformed body", () => {
    expect(gsiAnswer([], "東京都渋谷区道玄坂1-6-5", TOKYO)).toBeNull();
    expect(gsiRefusal([], "東京都渋谷区道玄坂1-6-5", TOKYO)).toBe("gsi: no answer");
    expect(gsiRefusal({ x: 1 }, "東京都渋谷区道玄坂1-6-5", TOKYO)).toBe("gsi: no answer");
    expect(gsiRefusal(DOGENZAKA, "東京都渋谷区道玄坂1-6-5", TOKYO)).toBeNull();
  });
});

describe("gsiGeocoder", () => {
  it("asks GSI once per normalised address and never claims a building", async () => {
    const { http, urls } = fakeHttp(DOGENZAKA);
    const g = gsiGeocoder(http, TOKYO);
    expect(g.id).toBe("gsi");
    expect(await g.geocode("東京都渋谷区道玄坂1-6-5")).toEqual({ lat: 35.657711, lng: 139.699249 });
    expect(await g.geocode("東京都渋谷区道玄坂1-6-5")).not.toBeNull();
    expect(await g.building("東京都渋谷区道玄坂1-6-5")).toBeNull();
    expect(await g.refusal!("東京都渋谷区道玄坂1-6-5")).toBeNull();
    expect(urls).toHaveLength(1);
    expect(g.requests()).toBe(1);
  });

  it("makes no request for an address with no Japanese script", async () => {
    const { http, urls } = fakeHttp(DOGENZAKA);
    const g = gsiGeocoder(http, TOKYO);
    expect(await g.geocode("2-26-1 Nishiasakusa, Taito-ku, Tokyo")).toBeNull();
    expect(await g.refusal!("2-26-1 Nishiasakusa, Taito-ku, Tokyo")).toBe(
      "gsi: not in Japanese script",
    );
    expect(urls).toHaveLength(0);
  });

  it("a failed request never throws: null with a refusal", async () => {
    const http = createPoliteHttp({
      userAgent: "t",
      sleep: async () => {},
      transport: async () => {
        throw new Error("network error");
      },
    });
    const g = gsiGeocoder(http, TOKYO);
    expect(await g.geocode("東京都渋谷区道玄坂1-6-5")).toBeNull();
    expect(await g.refusal!("東京都渋谷区道玄坂1-6-5")).toBe("gsi: request failed");
  });
});

describe("withJapanFallback", () => {
  it("returns the primary unchanged for a non-JP metro, and GSI is never asked", async () => {
    const { http, urls } = fakeHttp(DOGENZAKA);
    const primary = fixed(null, "no answer");
    const g = withJapanFallback(primary, gsiGeocoder(http, NYC), NYC);
    expect(g).toBe(primary);
    expect(await g.geocode("東京都渋谷区道玄坂1-6-5")).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it("uses the primary's point when it has one, without asking GSI", async () => {
    const { http, urls } = fakeHttp(DOGENZAKA);
    const p = { lat: 35.6, lng: 139.7 };
    const g = withJapanFallback(fixed(p), gsiGeocoder(http, TOKYO), TOKYO);
    expect(await g.geocode("東京都渋谷区道玄坂1-6-5")).toEqual(p);
    expect(await g.refusal!("東京都渋谷区道玄坂1-6-5")).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it("falls back to GSI when the primary gives no point", async () => {
    const { http } = fakeHttp(DOGENZAKA);
    const g = withJapanFallback(
      fixed(null, "too vague (district, confidence 0)"),
      gsiGeocoder(http, TOKYO),
      TOKYO,
    );
    expect(await g.geocode("東京都渋谷区道玄坂1-6-5")).toEqual({ lat: 35.657711, lng: 139.699249 });
    expect(await g.refusal!("東京都渋谷区道玄坂1-6-5")).toBeNull();
  });

  it("building and elsewhere stay the primary's", async () => {
    const { http } = fakeHttp(DOGENZAKA);
    const g = withJapanFallback(fixed(null, "no answer"), gsiGeocoder(http, TOKYO), TOKYO);
    expect(await g.building("東京都渋谷区道玄坂1-6-5")).toBeNull();
    expect(await g.elsewhere!("東京都渋谷区道玄坂1-6-5")).toBe("elsewhere-from-primary");
  });

  it("joins both refusals when both fail", async () => {
    const { http } = fakeHttp([]);
    const g = withJapanFallback(fixed(null, "no answer"), gsiGeocoder(http, TOKYO), TOKYO);
    expect(await g.geocode("東京都渋谷区道玄坂1-6-5")).toBeNull();
    expect(await g.refusal!("東京都渋谷区道玄坂1-6-5")).toBe("no answer; gsi: no answer");
  });
});
