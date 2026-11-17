import { describe, expect, it } from "vitest";
import { restateVenue } from "@/src/pipeline/source-venue";

describe("restateVenue", () => {
  const seeds = [
    {
      url: "https://lpr.com/",
      label: "Le Poisson Rouge",
      venuePage: true,
      venueAddress: "158 Bleecker St, New York, NY 10012",
      onlyHere: true,
    },
  ];
  const known = [
    {
      names: ["The Last Word"],
      address: "31-30 Ditmars Blvd, Astoria, NY 11105",
    },
  ];

  it("applies venueAddress and onlyHere when source has no venue", () => {
    const result = restateVenue(
      { name: "Main Space", address: null },
      {
        sourceUrl: "https://lpr.com/",
        sourceHasVenue: false,
        seeds,
        known: [],
      },
    );
    expect(result).toEqual({
      name: "Le Poisson Rouge",
      address: "158 Bleecker St, New York, NY 10012",
    });
  });

  it("does not apply venueAddress when source already has a venue", () => {
    const result = restateVenue(
      { name: "Main Space", address: null },
      {
        sourceUrl: "https://lpr.com/",
        sourceHasVenue: true,
        seeds,
        known: [],
      },
    );
    expect(result).toEqual({
      name: "Le Poisson Rouge",
      address: null,
    });
  });

  it("applies known venue address", () => {
    const result = restateVenue(
      { name: "The Last Word", address: null },
      {
        sourceUrl: "https://example.org/",
        sourceHasVenue: false,
        seeds: [],
        known,
      },
    );
    expect(result).toEqual({
      name: "The Last Word",
      address: "31-30 Ditmars Blvd, Astoria, NY 11105",
    });
  });

  it("returns unchanged when no fixes apply", () => {
    const result = restateVenue(
      { name: null, address: null },
      {
        sourceUrl: "https://example.org/",
        sourceHasVenue: false,
        seeds: [],
        known: [],
      },
    );
    expect(result).toEqual({ name: null, address: null });
  });

  it("keeps existing address when no fixes apply", () => {
    const result = restateVenue(
      { name: "Somewhere", address: "1 Main St, New York, NY 10001" },
      {
        sourceUrl: "https://example.org/",
        sourceHasVenue: false,
        seeds: [],
        known: [],
      },
    );
    expect(result).toEqual({
      name: "Somewhere",
      address: "1 Main St, New York, NY 10001",
    });
  });
});
