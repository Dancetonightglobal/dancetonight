import { describe, expect, it } from "vitest";
import { METRO_SOURCES } from "@/config/sources";
import { RA_AREAS, RA_NOT_DANCE_NIGHTS } from "@/config/sources/ra";
import { adapterFor } from "@/src/pipeline/runner";
import { REGISTRY } from "@/src/pipeline/ingest";
import { ADAPTER_DEFAULTS } from "@/config/flags";
import { raAdapter } from "@/src/adapters/apis/ra";

describe("RA sources wiring", () => {
  it("has RA_AREAS for 27 metros", () => {
    expect(Object.keys(RA_AREAS)).toEqual([
      "nyc",
      "london",
      "barcelona",
      "lisbon",
      "miami",
      "philadelphia",
      "mexico-city",
      "new-orleans",
      "buenos-aires",
      "rio-de-janeiro",
      "san-juan",
      "raleigh",
      "los-angeles",
      "mumbai",
      "delhi",
      "hong-kong",
      "medellin",
      "istanbul",
      "dubai",
      "pune",
      "berlin",
      "beirut",
      "paris",
      "tulum",
      "nashville",
      "tokyo",
      "austin",
      "marrakesh",
    ]);
  });

  it("each metro in RA_AREAS has exactly one RA source for its area in METRO_SOURCES", () => {
    for (const metro of Object.keys(RA_AREAS)) {
      const sources = METRO_SOURCES[metro] ?? [];
      const ra = sources.filter(
        (s) => s.platform === "ra" && s.url === `https://ra.co/graphql?area=${RA_AREAS[metro]}`,
      );
      expect(ra).toHaveLength(1);
      const source = ra[0]!;
      expect(source.url).toBe(`https://ra.co/graphql?area=${RA_AREAS[metro]}`);
      expect(source.kind).toBe("ticketing_api");
      expect(source.trustTier).toBe("ticketing");
      expect(source.styles).toEqual(["dj_night"]);
      expect(source.label).toMatch(/^Resident Advisor/);
    }
  });

  it("only Tulum reads a second RA area (Playa del Carmen 684, D-1080)", () => {
    for (const metro of Object.keys(METRO_SOURCES)) {
      const urls = (METRO_SOURCES[metro] ?? [])
        .filter((s) => s.platform === "ra")
        .map((s) => s.url);
      if (metro === "tulum") {
        expect(urls.sort()).toEqual([
          "https://ra.co/graphql?area=523",
          "https://ra.co/graphql?area=684",
        ]);
      } else {
        expect(urls.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("metros without RA area have no RA source", () => {
    const noRa = ["atlantis"];
    for (const metro of noRa) {
      const sources = METRO_SOURCES[metro] ?? [];
      const ra = sources.filter((s) => s.platform === "ra");
      expect(ra).toHaveLength(0);
    }
  });

  it("no two sources in any metro share a url", () => {
    for (const metro of Object.keys(METRO_SOURCES)) {
      const sources = METRO_SOURCES[metro] ?? [];
      const urls = sources.map((s) => s.url);
      const unique = new Set(urls);
      expect(unique.size).toBe(urls.length);
    }
  });

  it("adapterFor returns ra adapter for Miami RA source", () => {
    const miamiRa = (METRO_SOURCES.miami ?? []).find((s) => s.platform === "ra");
    expect(miamiRa).toBeDefined();
    const adapter = adapterFor(
      { kind: "ticketing_api", platform: miamiRa!.platform ?? null },
      REGISTRY,
    );
    expect(adapter?.id).toBe("ra");
  });

  it("ADAPTER_DEFAULTS.ra is true", () => {
    expect(ADAPTER_DEFAULTS.ra).toBe(true);
  });

  it("reads Istanbul from RA area 73 as Resident Advisor Istanbul", () => {
    const ra = (METRO_SOURCES["istanbul"] ?? []).filter((s) => s.platform === "ra");
    expect(ra).toHaveLength(1);
    expect(ra[0]?.url).toBe("https://ra.co/graphql?area=73");
    expect(ra[0]?.label).toBe("Resident Advisor Istanbul");
  });

  it("Barcelona's RA source leaves out its checked non-dance titles; Miami's has none", () => {
    const bcn = (METRO_SOURCES["barcelona"] ?? []).find((s) => s.platform === "ra");
    expect(bcn?.notDanceNights).toEqual([
      "Entity Radio // Viajes Sonoros",
      "Pedro Son Lab: Open Studio with Entity Radio",
      "DRAKE'S R&B WORLD - FILM SCREENING & LISTENING SESSION - SESIÓN DE ESCUCHA",
      "Ambient Sauna *",
    ]);
    const miami = (METRO_SOURCES.miami ?? []).find((s) => s.platform === "ra");
    expect(miami).toBeDefined();
    expect(miami).not.toHaveProperty("notDanceNights");
  });

  it("Hong Kong's RA source leaves out its checked listening sessions", () => {
    const hk = (METRO_SOURCES["hong-kong"] ?? []).find((s) => s.platform === "ra");
    expect(hk?.notDanceNights).toEqual([
      "Focus On: Pablo Valentino (Listening Session)",
      "Listening Session presented by Chucheewa",
    ]);
  });

  it("raAdapter.countries is undefined", () => {
    expect(raAdapter.countries).toBeUndefined();
  });

  it("has London's non-dance night from the live check", () => {
    expect(RA_NOT_DANCE_NIGHTS.london).toEqual([
      "Club Hunni Academy: In Conversation with Logic1000",
      "Pitchblack Playback *",
      "Ambient Sauna *",
    ]);
  });

  it("has Los Angeles's networking mixer from the daily check", () => {
    expect(RA_NOT_DANCE_NIGHTS["los-angeles"]).toEqual(["IndustryHours Monthly Networking Mixer"]);
  });
});
