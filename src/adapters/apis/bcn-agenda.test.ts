import { describe, it, expect, vi } from "vitest";
import { bcnAgendaAdapter, bcnAgendaToListings } from "./bcn-agenda";
import type { Metro, NightDate, RunCtx } from "@/src/adapters/types";
import fixture from "./__fixtures__/bcn-agenda.json";

const BARCELONA_METRO: Metro = {
  id: "barcelona",
  slug: "barcelona",
  name: "Barcelona",
  countryCode: "ES",
  center: { lat: 41.3851, lng: 2.1734 },
  radiusKm: 15,
  tz: "Europe/Madrid",
  languages: ["ca", "es"],
};

const NON_BARCELONA_METRO: Metro = {
  id: "madrid",
  slug: "madrid",
  name: "Madrid",
  countryCode: "ES",
  center: { lat: 40.4168, lng: -3.7038 },
  radiusKm: 15,
  tz: "Europe/Madrid",
  languages: ["es"],
};

describe("bcnAgendaToListings", () => {
  it("returns sardanes event for nights 2026-11-07 and 2026-11-08", () => {
    const nights: NightDate[] = ["2026-11-07", "2026-11-08"];
    const result = bcnAgendaToListings(fixture, {
      metro: BARCELONA_METRO,
      nights,
      fetchedAt: new Date(),
    });

    // Should include sardanes event and two Jamboree events (regular and cancelled)
    expect(result.listings).toHaveLength(3);
    const sardanes = result.listings.find(
      (l) =>
        l.listing.title === "Ballada de sardanes a la plaça de Sarrià amb la Cobla Baix Llobregat",
    );
    expect(sardanes).toBeDefined();
    expect(sardanes!.listing.local_date).toBe("2026-11-08");
    expect(sardanes!.listing.doors_time).toBe("11:30");
    expect(sardanes!.listing.venue?.name).toBe("Plaça de Sarrià");
    expect(sardanes!.listing.venue?.address).toContain("08017");
    expect(sardanes!.venueLocation?.lat).toBeCloseTo(41.400011, 5);
    expect(sardanes!.venueLocation?.lng).toBeCloseTo(2.122121, 5);
  });

  it("returns Jamboree event for night 2026-11-07", () => {
    const nights: NightDate[] = ["2026-11-07"];
    const result = bcnAgendaToListings(fixture, {
      metro: BARCELONA_METRO,
      nights,
      fetchedAt: new Date(),
    });

    // Should have 2 listings: one regular, one cancelled
    expect(result.listings).toHaveLength(2);
    const regular = result.listings.find((l) => !l.listing.cancelled);
    const cancelled = result.listings.find((l) => l.listing.cancelled);

    expect(regular).toBeDefined();
    expect(regular?.listing.title).toBe("Disco Saturday Night: Dj Eley");
    expect(regular?.listing.local_date).toBe("2026-11-07");
    expect(regular?.listing.doors_time).toBe("23:59");
    expect(regular?.eventUrl).toBe(
      "https://guia.barcelona.cat/ca/detall/festa-disco-saturday-night-dj-eley_99400715380.html",
    );

    expect(cancelled).toBeDefined();
    expect(cancelled?.listing.cancelled).toBe(true);
    expect(cancelled?.listing.title).toBe("Disco Saturday Night: Dj Eley");
  });

  it("returns Balls per a gent gran for night 2026-11-03", () => {
    const nights: NightDate[] = ["2026-11-03"];
    const result = bcnAgendaToListings(fixture, {
      metro: BARCELONA_METRO,
      nights,
      fetchedAt: new Date(),
    });

    expect(result.listings).toHaveLength(1);
    const listing = result.listings[0]!;
    expect(listing.listing.title).toBe(
      "Balls per a gent gran a Sants - Montjuïc (octubre - desembre)",
    );
    expect(listing.listing.local_date).toBe("2026-11-03");
    expect(listing.listing.doors_time).toBe("17:00");
    expect(listing.venueLocation).toBeFalsy();
    expect(listing.listing.venue?.address).toBeFalsy();
  });

  it("skips Taller courses", () => {
    const nights: NightDate[] = ["2026-10-16", "2026-10-23"];
    const result = bcnAgendaToListings(fixture, {
      metro: BARCELONA_METRO,
      nights,
      fetchedAt: new Date(),
    });

    // Should not include Taller 'Balls de saló'
    const hasTaller = result.listings.some((l) => l.listing.title.includes("Taller"));
    expect(hasTaller).toBe(false);
  });

  it("skips non-dance events", () => {
    const nights: NightDate[] = ["2026-12-19", "2027-03-07"];
    const result = bcnAgendaToListings(fixture, {
      metro: BARCELONA_METRO,
      nights,
      fetchedAt: new Date(),
    });

    // Should not include concert or espectacle
    expect(result.listings).toHaveLength(0);
  });

  it("slugifies title correctly", () => {
    // This is a test of the internal function; we'll need to export it or test indirectly
    // For now, we can test via eventUrl generation
    const nights: NightDate[] = ["2026-11-07"];
    const result = bcnAgendaToListings(fixture, {
      metro: BARCELONA_METRO,
      nights,
      fetchedAt: new Date(),
    });

    const listing = result.listings.find((l) => l.listing.title.includes("Disco"));
    expect(listing?.eventUrl).toBe(
      "https://guia.barcelona.cat/ca/detall/festa-disco-saturday-night-dj-eley_99400715380.html",
    );
  });
});

describe("bcnAgendaAdapter", () => {
  it("returns empty result for non-Barcelona metro", async () => {
    const ctx = {
      metro: NON_BARCELONA_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn(),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    const result = await bcnAgendaAdapter.harvestMetro!(NON_BARCELONA_METRO, ["2026-11-07"], ctx);

    expect(result.listings).toHaveLength(0);
    expect(result.notes).toEqual([]);
    expect(ctx.http.request).not.toHaveBeenCalled();
  });

  it("fails the source when the download fails", async () => {
    const ctx = {
      metro: BARCELONA_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockRejectedValue(new Error("Network error")),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(
      bcnAgendaAdapter.harvestMetro!(BARCELONA_METRO, ["2026-11-07"], ctx),
    ).rejects.toThrow(/^bcn_agenda: download failed/);
    expect(ctx.http.request).toHaveBeenCalled();
  });

  it("fails the source on a body that is not JSON", async () => {
    const ctx = {
      metro: BARCELONA_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockResolvedValue({
          body: "invalid json",
          fetchedAt: new Date(),
        }),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(
      bcnAgendaAdapter.harvestMetro!(BARCELONA_METRO, ["2026-11-07"], ctx),
    ).rejects.toThrow("bcn_agenda: unexpected body");
  });

  it("fails the source on a body that is not a list", async () => {
    const ctx = {
      metro: BARCELONA_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockResolvedValue({
          body: JSON.stringify({ error: true }),
          fetchedAt: new Date(),
        }),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(
      bcnAgendaAdapter.harvestMetro!(BARCELONA_METRO, ["2026-11-07"], ctx),
    ).rejects.toThrow("bcn_agenda: unexpected body");
  });

  it("fails the source on HTTP 403", async () => {
    const ctx = {
      metro: BARCELONA_METRO,
      now: () => new Date(),
      http: {
        request: vi.fn().mockResolvedValue({
          status: 403,
          body: "Forbidden",
          fetchedAt: new Date(),
        }),
      },
      env: {},
      log: vi.fn(),
    } as unknown as RunCtx;

    await expect(
      bcnAgendaAdapter.harvestMetro!(BARCELONA_METRO, ["2026-11-07"], ctx),
    ).rejects.toThrow(/download failed \(HTTP 403\)/);
  });
});

describe("party words", () => {
  it("keeps a DJ session whose party word carries an accent (Sessió)", () => {
    const jamboree = (fixture as Array<Record<string, unknown>>).find(
      (e) => e.register_id === 99400715380,
    )!;
    const event = { ...jamboree, register_id: 99400715399, name: "Sessió de DJ al casal" };
    const result = bcnAgendaToListings([event], {
      metro: BARCELONA_METRO,
      nights: ["2026-11-07"] as NightDate[],
      fetchedAt: new Date("2026-11-01T10:00:00Z"),
    });
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]!.listing.title).toBe("Sessió de DJ al casal");
  });
});
