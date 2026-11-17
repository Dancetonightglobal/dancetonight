// BAMilonga: the City of Buenos Aires' register of milongas, read from its Mapa Milonguero 2026 PDF (owner's Q1 = A, D-402).
// Fixtures are not needed; the PDF is fetched only to detect changes.
import { describe, expect, it } from "vitest";

import {
  bamilongaAdapter,
  readFromOwnSite,
  diaCode,
  horaInicio,
  MAPA_MILONGUERO_URL,
} from "@/src/adapters/apis/bamilonga";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import {
  createPoliteHttp,
  type TransportRequest,
  type TransportResponse,
} from "@/src/pipeline/http";
import {
  MAPA_MILONGUERO_ETAG,
  MAPA_MILONGUERO_LAST_MODIFIED,
  MAPA_MILONGUERO_LAST_NIGHT,
} from "@/src/adapters/apis/bamilonga-register";

const NOW = new Date("2026-10-29T20:00:00Z"); // Thursday 17:00 in Buenos Aires
const BA: Metro = {
  id: "m",
  slug: "buenos-aires",
  name: "Buenos Aires",
  countryCode: "AR",
  center: { lat: -34.6037, lng: -58.3816 },
  radiusKm: 25,
  tz: "America/Argentina/Buenos_Aires",
  languages: ["es"],
};
const SOURCE: Source = {
  id: "s",
  url: MAPA_MILONGUERO_URL,
  kind: "platform_api",
  trustTier: "directory",
  platform: "bamilonga",
  feedUrl: null,
  metroId: "m",
  styles: ["tango", "milonga"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctx(
  seen: string[],
  pdfResponse: { status: number; etag?: string; body?: string },
): RunCtx {
  let t = NOW.getTime();
  return {
    metro: BA,
    now: () => new Date(t),
    env: {},
    log: () => {},
    http: createPoliteHttp({
      userAgent: "test",
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      transport: async (req: TransportRequest) => {
        seen.push(req.url);
        if (req.url === "https://static.buenosaires.gob.ar/robots.txt") {
          return { url: req.url, status: 404, headers: {}, body: "" };
        }
        if (req.url === MAPA_MILONGUERO_URL) {
          const headers: Record<string, string> = {};
          if (pdfResponse.etag) headers["etag"] = pdfResponse.etag;
          if (pdfResponse.status === 304) {
            return { url: req.url, status: 304, headers, body: "" };
          }
          return {
            url: req.url,
            status: pdfResponse.status,
            headers,
            body: pdfResponse.body ?? "",
          };
        }
        return { url: req.url, status: 404, headers: {}, body: "" };
      },
    }),
  };
}

describe("diaCode", () => {
  it("maps Spanish weekdays to RRULE codes", () => {
    expect(diaCode("LUNES")).toBe("MO");
    expect(diaCode("MARTES")).toBe("TU");
    expect(diaCode("MIERCOLES")).toBe("WE");
    expect(diaCode("MIÉRCOLES")).toBe("WE");
    expect(diaCode("JUEVES")).toBe("TH");
    expect(diaCode("VIERNES")).toBe("FR");
    expect(diaCode("SABADO")).toBe("SA");
    expect(diaCode("SÁBADO")).toBe("SA");
    expect(diaCode("DOMINGO")).toBe("SU");
    expect(diaCode("lunes")).toBe("MO");
    expect(diaCode("")).toBeNull();
    expect(diaCode(null)).toBeNull();
    expect(diaCode("PRIMER SABADO")).toBeNull();
  });
});

describe("horaInicio", () => {
  it("extracts leading HH:MM", () => {
    expect(horaInicio("13:00")).toBe("13:00");
    expect(horaInicio("13:00 A 20:00")).toBe("13:00");
    expect(horaInicio("9:30")).toBe("09:30");
    expect(horaInicio("25:00")).toBeNull();
    expect(horaInicio("")).toBeNull();
    expect(horaInicio("invalid")).toBeNull();
  });
});

describe("readFromOwnSite", () => {
  it("skips venues and milongas read from their own site's grid", () => {
    expect(readFromOwnSite("LA VIRUTA TANGO CLUB", "LA VIRUTA")).toBe(true);
    expect(readFromOwnSite("MILONGA DE LUCY", "CLUB GRICEL")).toBe(true);
    expect(readFromOwnSite("MILONGA CACHIRULO", "EL BESO")).toBe(true);
    expect(readFromOwnSite("TANGO CAMARGO", "EL BESO")).toBe(false);
  });
});

describe("bamilongaAdapter", () => {
  it("is Argentina only", () => {
    expect(bamilongaAdapter.id).toBe("bamilonga");
    expect(bamilongaAdapter.countries).toEqual(["AR"]);
  });

  it("lists 59 weekly rows when PDF unchanged (304)", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(
      SOURCE,
      ctx(seen, { status: 304, etag: MAPA_MILONGUERO_ETAG }),
    );
    expect(seen.filter((u) => u === MAPA_MILONGUERO_URL)).toHaveLength(1);
    expect(result.listings).toHaveLength(59);
    // No title contains "Viruta" or "Cachirulo"
    const lowerTitles = result.listings.map((l) => l.listing.title.toLowerCase());
    expect(lowerTitles.some((t) => t.includes("viruta"))).toBe(false);
    expect(lowerTitles.some((t) => t.includes("cachirulo"))).toBe(false);
    // No venue is "Club Gricel"
    const venues = result.listings.map((l) => l.listing.venue?.name?.toLowerCase() ?? "");
    expect(venues).not.toContain("club gricel");
    // First note matches pattern
    expect(result.notes?.[0]).toBe(
      "93 rows on the 2026 Mapa Milonguero; 70 weekly; 59 listed; 21 monthly and 2 fortnightly left out (week not stated); 11 read from their own site instead; 0 not understood",
    );
    // No note contains "changed" or "could not"
    const allNotes = result.notes?.join(" ") ?? "";
    expect(allNotes).not.toContain("changed");
    expect(allNotes).not.toContain("could not");
    // unchanged is not true
    expect(result.unchanged).toBeUndefined();
    // PDF requested exactly once
    expect(seen.filter((u) => u === MAPA_MILONGUERO_URL)).toHaveLength(1);
  });

  it("includes exact listing for Tango Camargo Monday", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(
      SOURCE,
      ctx(seen, { status: 304, etag: MAPA_MILONGUERO_ETAG }),
    );
    const camargo = result.listings.find(
      (l) => l.externalId === "bamilonga:tango-camargo:el-beso:MO:1300",
    );
    expect(camargo).toBeDefined();
    expect(camargo!.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(camargo!.recurrence?.dtstartLocal).toBe("2026-11-02T13:00");
    expect(camargo!.listing.venue?.address).toBe("Riobamba 416, Balvanera, CABA");
    expect(camargo!.venueLocation).toBeNull();
  });

  it("Thursday Tango Camargo row's dtstartLocal is 2026-10-29T13:00", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(
      SOURCE,
      ctx(seen, { status: 304, etag: MAPA_MILONGUERO_ETAG }),
    );
    const camargo = result.listings.find(
      (l) => l.externalId === "bamilonga:tango-camargo:el-beso:TH:1300",
    );
    expect(camargo).toBeDefined();
    expect(camargo!.recurrence?.dtstartLocal).toBe("2026-10-29T13:00");
  });

  it("El Abrazo Tango Club (hora 13:00 A 20:00) is listed at 13:00", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(
      SOURCE,
      ctx(seen, { status: 304, etag: MAPA_MILONGUERO_ETAG }),
    );
    const abrazo = result.listings.find((l) => l.listing.title.toLowerCase().includes("abrazo"));
    expect(abrazo).toBeDefined();
    expect(abrazo!.listing.dancing_time).toBe("13:00");
  });

  it("still lists 59 rows when PDF changed (200, other etag)", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(
      SOURCE,
      ctx(seen, { status: 200, etag: '"other"', body: "x" }),
    );
    expect(result.listings).toHaveLength(59);
    const allNotes = result.notes?.join(" ") ?? "";
    expect(allNotes).toContain("has changed since it was transcribed");
  });

  it("still lists 59 rows when fetch fails (404)", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(SOURCE, ctx(seen, { status: 404 }));
    expect(result.listings).toHaveLength(59);
    const allNotes = result.notes?.join(" ") ?? "";
    expect(allNotes).toContain("could not be fetched");
    expect(result.doc).toBeUndefined();
  });

  it("still lists 59 rows when fetch fails (500)", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(SOURCE, ctx(seen, { status: 500 }));
    expect(result.listings).toHaveLength(59);
    const allNotes = result.notes?.join(" ") ?? "";
    expect(allNotes).toContain("could not be fetched");
    expect(result.doc).toBeUndefined();
  });

  it("lists nothing after the year", async () => {
    const oldNow = new Date("2027-02-15T20:00:00Z");
    const seen: string[] = [];
    let t = oldNow.getTime();
    const ctx: RunCtx = {
      metro: BA,
      now: () => new Date(t),
      env: {},
      log: () => {},
      http: createPoliteHttp({
        userAgent: "test",
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
        transport: async (req: TransportRequest): Promise<TransportResponse> => {
          seen.push(req.url);
          if (req.url === "https://static.buenosaires.gob.ar/robots.txt") {
            return { url: req.url, status: 404, headers: {}, body: "" };
          }
          if (req.url === MAPA_MILONGUERO_URL) {
            return { url: req.url, status: 304, headers: { etag: MAPA_MILONGUERO_ETAG }, body: "" };
          }
          return { url: req.url, status: 404, headers: {}, body: "" };
        },
      }),
    };
    const result = await bamilongaAdapter.harvest!(SOURCE, ctx);
    expect(result.listings).toHaveLength(0);
    const allNotes = result.notes?.join(" ") ?? "";
    expect(allNotes).toContain("out of date");
  });

  it("every externalId is unique", async () => {
    const seen: string[] = [];
    const result = await bamilongaAdapter.harvest!(
      SOURCE,
      ctx(seen, { status: 304, etag: MAPA_MILONGUERO_ETAG }),
    );
    const ids = result.listings.map((l) => l.externalId);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });
});
