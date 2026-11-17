import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { symplaAdapter, listSearchData } from "@/src/adapters/feeds/sympla";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__");
const p1Fixture = () => readFileSync(path.join(DIR, "sympla-rio-hoje-p1-2026-10-30.html"), "utf8");
const p2Fixture = () => readFileSync(path.join(DIR, "sympla-rio-hoje-p2-2026-10-30.html"), "utf8");

const RIO: Metro = {
  id: "m",
  slug: "rio",
  name: "Rio de Janeiro",
  countryCode: "BR",
  center: { lat: -22.9068, lng: -43.1729 },
  radiusKm: 50,
  tz: "America/Sao_Paulo",
  languages: ["pt"],
};

const source = (url: string): Source => ({
  id: "s",
  url,
  kind: "html",
  trustTier: "first_party",
  platform: "sympla",
  feedUrl: null,
  metroId: "m",
  styles: ["forro"],
  etag: null,
  lastModified: null,
  contentHash: null,
});

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const seen = new Set<string>();
  const enhanced: Fixture[] = [];
  for (const f of fixtures) {
    const url = f.request.url;
    const domain = new URL(url).origin;
    if (!seen.has(domain)) {
      seen.add(domain);
      enhanced.push({
        request: { method: "GET", url: `${domain}/robots.txt` },
        response: {
          url: `${domain}/robots.txt`,
          status: 200,
          headers: { "content-type": "text/plain" },
          body: "User-agent: *\nAllow: /\n",
        },
      });
    }
    enhanced.push(f);
  }
  const transport = fixtureTransport(enhanced);
  let t = now.getTime();
  return {
    metro: RIO,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "t",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
    requests: transport.requests,
  };
}

describe("sympla bileto list data", () => {
  it("listSearchData on p1 fixture", () => {
    const html = p1Fixture();
    const result = listSearchData(html);
    expect(result).toBeDefined();
    expect(result!.items).toHaveLength(16);
    expect(result!.total).toBe(89);
    expect(result!.limit).toBe(16);
    const first = result!.items[0]!;
    expect(first.id).toBe(50127707);
    expect(first.name).toBe("Epiderme: Ciganagem Carioca ");
    expect(first.url).toBe("https://bileto.sympla.com.br/event/127707");
  });

  it("listSearchData on html without data returns null", () => {
    const result = listSearchData("<html><body>no data</body></html>");
    expect(result).toBeNull();
  });

  it("harvest does not throw on p1 fixture, requests page 2, returns bileto rows", async () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const run = ctx(
      [
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
            status: 200,
            headers: { "content-type": "text/html" },
            body: p1Fixture(),
          },
        },
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=2",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=2",
            status: 200,
            headers: { "content-type": "text/html" },
            body: p2Fixture(),
          },
        },
        // Page 3 is not given, so paging stops there; /evento pages are not given (their fetches fail and are noted).
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje"),
      run,
    );

    // Should not throw
    expect(result.listings).toHaveLength(19); // 16 from p1 + 3 bileto from p2 (the p2 fixture has 3 bileto items)
    const biletoNotes = result.notes?.filter((n) =>
      n.includes("bileto event(s) read from the list data"),
    );
    expect(biletoNotes).toHaveLength(1);
    expect(biletoNotes![0]).toBe("19 bileto event(s) read from the list data");
    // Rio Scenarium row
    const scenarium = result.listings.find((l) => l.externalId === "sympla-bileto:50127549");
    expect(scenarium).toBeDefined();
    expect(scenarium!.listing.title).toBe(
      "GRUPO SÃO SEBASTIÃO + FLÁVIA ENNE NO RIO SCENARIUM  30.10",
    );
    expect(scenarium!.listing.local_date).toBe("2026-10-30");
    expect(scenarium!.listing.doors_time).toBeNull();
    expect(scenarium!.listing.end_time).toBeNull();
    expect(scenarium!.listing.venue.name).toBe("Rio Scenarium");
    expect(scenarium!.listing.venue.address).toBe("Rua do Lavradio, 20, Rio de Janeiro - RJ");
    expect(scenarium!.venueLocation).toEqual({ lat: -22.9101033, lng: -43.1829718 });
    expect(scenarium!.eventUrl).toBe("https://bileto.sympla.com.br/event/127549");
    // Cypher do Passinho row (from page 2)
    const cypher = result.listings.find((l) => l.externalId === "sympla-bileto:50127270");
    expect(cypher).toBeDefined();
    expect(cypher!.listing.doors_time).toBe("22:00");
    // Multi-day item (VÍBORAS) should have end null
    const viboras = result.listings.find((l) => l.externalId === "sympla-bileto:50126646");
    expect(viboras).toBeDefined();
    expect(viboras!.listing.end_time).toBeNull();
    // Requests should include page 2 and the /evento page
    expect(run.requests).toContain(
      "GET https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=2",
    );
    expect(run.requests.some((r) => r.includes("/evento/pagode-e-gelinho"))).toBe(true);
  });

  it("paging stops at total", async () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const modifiedP1 = p1Fixture().replace('"total":89', '"total":16');
    const run = ctx(
      [
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
            status: 200,
            headers: { "content-type": "text/html" },
            body: modifiedP1,
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje"),
      run,
    );
    // Should not request page 2
    expect(run.requests).not.toContain(
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=2",
    );
    // Should have bileto items from page 1 only
    expect(result.listings.length).toBeGreaterThan(0);
  });

  it("page with no links and no data throws", async () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const run = ctx(
      [
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
            status: 200,
            headers: { "content-type": "text/html" },
            body: "<html>no links</html>",
          },
        },
      ],
      now,
    );

    await expect(
      symplaAdapter.harvest!(
        source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje"),
        run,
      ),
    ).rejects.toThrow("the page lists no Sympla event links");
  });
  it("listSearchData drops organiser and location fields of the wrong type", () => {
    const chunk = JSON.stringify(
      '1:{"searchDataResult":{"data":[{"id":1,"name":"N","url":"https://bileto.sympla.com.br/event/1","start_date":"2026-10-30T22:00:00+00:00","organizer":7,"location":{"name":{"x":1},"city":"Rio de Janeiro","lat":"-22.9","lon":-43.1}}],"total":1,"limit":16}}',
    ).slice(1, -1);
    const html = `<script>self.__next_f.push([1,"${chunk}"])</script>`;
    const item = listSearchData(html)!.items[0]!;
    expect(item.organizer).toBeUndefined();
    expect(item.location).toEqual({ city: "Rio de Janeiro", lon: -43.1 });
  });

  it("bileto rows with start == end at 23:59 become untimed", async () => {
    const now = new Date("2026-10-31T19:00:00Z");
    const chunk = JSON.stringify(
      '1:{"searchDataResult":{"data":[' +
        '{"id":50127550,"name":"YAGO COSTA NO RIO SCENARIUM  31.10","url":"https://bileto.sympla.com.br/event/127550","start_date":"2026-11-01T02:59:00+00:00","end_date":"2026-11-01T02:59:00+00:00","location":{"name":"Rio Scenarium","address":"Rua do Lavradio, 20","city":"Rio de Janeiro","state":"RJ","lat":-22.9101033,"lon":-43.1829718}},' +
        '{"id":50129109,"name":"VÉSPERA DE FERIADO COM FAMILIA MOADIR NO RIO SCENARIUM  01.11","url":"https://bileto.sympla.com.br/event/129109","start_date":"2026-11-02T02:59:00+00:00","end_date":"2026-11-02T02:59:00+00:00","location":{"name":"Rio Scenarium","address":"Rua do Lavradio, 20","city":"Rio de Janeiro","state":"RJ","lat":-22.9101033,"lon":-43.1829718}},' +
        '{"id":9001,"name":"Real late start","url":"https://bileto.sympla.com.br/event/9001","start_date":"2026-11-01T02:59:00+00:00","end_date":"2026-11-01T07:00:00+00:00","location":{"name":"Rio Scenarium","address":"Rua do Lavradio, 20","city":"Rio de Janeiro","state":"RJ","lat":-22.9101033,"lon":-43.1829718}},' +
        '{"id":9002,"name":"Equal start and end at 22:00","url":"https://bileto.sympla.com.br/event/9002","start_date":"2026-11-01T01:00:00+00:00","end_date":"2026-11-01T01:00:00+00:00","location":{"name":"Rio Scenarium","address":"Rua do Lavradio, 20","city":"Rio de Janeiro","state":"RJ","lat":-22.9101033,"lon":-43.1829718}}' +
        '],"total":4,"limit":16}}',
    ).slice(1, -1);
    const html = `<script>self.__next_f.push([1,"${chunk}"])</script>`;
    const run = ctx(
      [
        {
          request: {
            method: "GET",
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
          },
          response: {
            url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
            status: 200,
            headers: { "content-type": "text/html" },
            body: html,
          },
        },
      ],
      now,
    );

    const result = await symplaAdapter.harvest!(
      source("https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje"),
      run,
    );

    expect(result.listings).toHaveLength(4);
    const yago = result.listings.find((l) => l.externalId === "sympla-bileto:50127550");
    expect(yago).toBeDefined();
    expect(yago!.listing.local_date).toBe("2026-10-31");
    expect(yago!.listing.doors_time).toBeNull();
    const familia = result.listings.find((l) => l.externalId === "sympla-bileto:50129109");
    expect(familia).toBeDefined();
    expect(familia!.listing.local_date).toBe("2026-11-01");
    expect(familia!.listing.doors_time).toBeNull();
    const late = result.listings.find((l) => l.externalId === "sympla-bileto:9001");
    expect(late).toBeDefined();
    expect(late!.listing.local_date).toBe("2026-10-31");
    expect(late!.listing.doors_time).toBe("23:59");
    const equal = result.listings.find((l) => l.externalId === "sympla-bileto:9002");
    expect(equal).toBeDefined();
    expect(equal!.listing.local_date).toBe("2026-10-31");
    expect(equal!.listing.doors_time).toBe("22:00");
  });
});
