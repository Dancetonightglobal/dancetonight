import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  circuitoPeneroEvents,
  keepForDancing,
  circuitoPeneroAdapter,
  nextFlightText,
} from "@/src/adapters/apis/circuitopenero";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, type TransportRequest } from "@/src/pipeline/http";

const DIR = path.join(__dirname, "__fixtures__/circuitopenero");
const HTML = readFileSync(path.join(DIR, "eventos-2026-11-01.html"), "utf8");

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
  url: "https://circuitopeñero.com/eventos",
  kind: "jsonld",
  trustTier: "directory",
  platform: "circuitopenero",
  feedUrl: null,
  metroId: "m",
  styles: ["argentine_folklore"],
  etag: null,
  lastModified: null,
  contentHash: null,
};

function ctxFor(html: string): RunCtx {
  let t = new Date("2026-11-01T15:00:00Z").getTime();
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
        if (req.url === "https://circuitopeñero.com/robots.txt") {
          return {
            url: req.url,
            status: 200,
            headers: {},
            body: "User-agent: *\nAllow: /\n",
          };
        }
        if (req.url === "https://circuitopeñero.com/eventos") {
          return { url: req.url, status: 200, headers: {}, body: html };
        }
        return { url: req.url, status: 404, headers: {}, body: "" };
      },
    }),
  };
}

describe("nextFlightText", () => {
  it("decodes chunks and joins them", () => {
    const text = nextFlightText(HTML);
    expect(text).toContain('"titulo":"Peña Folklorica POSTA BERMEJO');
    expect(text).not.toContain("self.__next_f.push");
  });

  it("returns original html when no chunks", () => {
    const html = "<html></html>";
    expect(nextFlightText(html)).toBe(html);
  });
});

describe("circuitoPeneroEvents", () => {
  it("extracts 29 distinct records", () => {
    const events = circuitoPeneroEvents(HTML);
    expect(events).toHaveLength(29);
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(29);
  });

  it("parses record with id 117 correctly", () => {
    const events = circuitoPeneroEvents(HTML);
    const event = events.find((e) => e.id === 117);
    expect(event).toBeDefined();
    expect(event!.title).toBe("Peña Folklorica POSTA BERMEJO");
    expect(event!.day).toBe("2026-11-14");
    expect(event!.time).toBe("19:00");
    expect(event!.rubro).toBe("ambos");
    expect(event!.lat).toBeCloseTo(-34.613725);
    expect(event!.lng).toBeCloseTo(-58.4206106);
    expect(event!.address).toBe("Castró Barros 137");
  });

  it("handles brace matching with escaped quotes", () => {
    const synthetic = `<script>self.__next_f.push([1,"{\\"id\\":999,\\"titulo\\":\\"Test\\",\\"descripcion\\":\\"a { b } \\\\\\"quote\\\\\\"\\",\\"fecha\\":\\"2026-11-02\\",\\"hora\\":\\"20:00\\",\\"rubro\\":\\"ambos\\",\\"pena\\":{\\"lat\\":-34.6,\\"lng\\":-58.4}}"])</script>`;
    const events = circuitoPeneroEvents(synthetic);
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe(999);
  });

  it("returns empty array for empty html", () => {
    expect(circuitoPeneroEvents("<html></html>")).toEqual([]);
  });
});

describe("keepForDancing", () => {
  it("returns true for rubro ambos", () => {
    const e = {
      id: 1,
      title: "",
      day: "",
      endDay: null,
      time: null,
      address: null,
      rubro: "ambos",
      venueName: null,
      city: null,
      lat: null,
      lng: null,
    };
    expect(keepForDancing(e)).toBe(true);
  });

  it("returns false for rubro musica", () => {
    const e = {
      id: 1,
      title: "",
      day: "",
      endDay: null,
      time: null,
      address: null,
      rubro: "musica",
      venueName: null,
      city: null,
      lat: null,
      lng: null,
    };
    expect(keepForDancing(e)).toBe(false);
  });

  it("returns false for other rubro", () => {
    const e = {
      id: 1,
      title: "",
      day: "",
      endDay: null,
      time: null,
      address: null,
      rubro: "otro",
      venueName: null,
      city: null,
      lat: null,
      lng: null,
    };
    expect(keepForDancing(e)).toBe(false);
  });

  it("returns false for null rubro", () => {
    const e = {
      id: 1,
      title: "",
      day: "",
      endDay: null,
      time: null,
      address: null,
      rubro: null,
      venueName: null,
      city: null,
      lat: null,
      lng: null,
    };
    expect(keepForDancing(e)).toBe(false);
  });
});

describe("circuitoPeneroAdapter", () => {
  it("has correct metadata", () => {
    expect(circuitoPeneroAdapter.id).toBe("circuitopenero");
    expect(circuitoPeneroAdapter.tier).toBe("A");
    expect(circuitoPeneroAdapter.countries).toEqual(["AR"]);
  });

  it("harvests events inside metro, filters by rubro", async () => {
    const ctx = ctxFor(HTML);
    const result = await circuitoPeneroAdapter.harvest!(SOURCE, ctx);
    // Should list the CABA events with rubro "ambos" in window
    expect(result.listings.length).toBeGreaterThan(0);
    // No record from Rosario etc.
    expect(
      result.listings.some((l) => /ROSARIO|Cosquin|JUNIN|Quilmes/i.test(l.listing.title)),
    ).toBe(false);
    // Check one known event
    const bermejo = result.listings.find((l) => l.listing.title.includes("POSTA BERMEJO"));
    expect(bermejo).toBeDefined();
    expect(bermejo!.listing.local_date).toBe("2026-11-14");
    expect(bermejo!.listing.doors_time).toBe("19:00"); // structured start becomes doors_time
    expect(bermejo!.venueLocation).toEqual({ lat: -34.613725, lng: -58.4206106 });
    // ExternalId starts with circuitopenero:
    expect(result.listings.every((l) => l.externalId?.startsWith("circuitopenero:"))).toBe(true);
    // Description is null
    expect(
      result.listings.every((l) => (l.listing as { description?: unknown }).description == null),
    ).toBe(true);
  });

  it("merges one peña night posted twice, keeping the title that does not open with a date", async () => {
    const result = await circuitoPeneroAdapter.harvest!(SOURCE, ctxFor(HTML));
    const bermejo = result.listings.filter(
      (l) => l.listing.local_date === "2026-11-14" && l.venueLocation?.lat === -34.613725,
    );
    expect(bermejo).toHaveLength(1);
    expect(bermejo[0]?.listing.title).toBe("Peña Folklorica POSTA BERMEJO");
    expect(result.notes?.[0]).toMatch(/1 posted twice, merged/);
  });

  it("stores the event page with the punycode host", async () => {
    const result = await circuitoPeneroAdapter.harvest!(SOURCE, ctxFor(HTML));
    expect(result.listings.length).toBeGreaterThan(0);
    for (const l of result.listings) {
      expect(l.eventUrl).toMatch(/^https:\/\/xn--circuitopeero-rkb\.com\/eventos\/\d+$/);
    }
  });

  it("throws when page has no records", async () => {
    const ctx = ctxFor("<html></html>");
    await expect(circuitoPeneroAdapter.harvest!(SOURCE, ctx)).rejects.toThrow(
      "circuitopeñero.com/eventos shows no event records",
    );
  });

  it("notes include counts", async () => {
    const ctx = ctxFor(HTML);
    const result = await circuitoPeneroAdapter.harvest!(SOURCE, ctx);
    expect(result.notes?.[0]).toMatch(
      /29 events on the page; \d+ in the window; \d+ concert-only \(rubro musica\) left out; \d+ outside the metro; \d+ without coordinates; \d+ posted twice, merged; \d+ listed/,
    );
  });
});
