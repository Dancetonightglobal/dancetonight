import { describe, expect, it } from "vitest";
import { venueSeedFor } from "@/src/pipeline/source-venue";
import { NYC_SOURCES } from "@/config/sources/nyc";

describe("venueSeedFor", () => {
  const seeds = [
    { url: "https://example.com/events", venueAddress: "123 Main St", venuePage: true },
    { url: "https://www.example.com/calendar", venueAddress: "456 Oak St", venuePage: true },
    { url: "https://other.com/", venueAddress: "789 Pine St", venuePage: false },
    { url: "https://houseofyes.org/", venueAddress: "111 Venue St", venuePage: true },
    { url: "https://calendar.houseofyes.org/", venueAddress: "222 Other St", venuePage: true },
    { url: "https://exactmatch.com/", venueAddress: undefined, venuePage: true },
  ];

  it("exact URL match returned", () => {
    const result = venueSeedFor("https://example.com/events", seeds);
    expect(result?.url).toBe("https://example.com/events");
    expect(result?.venueAddress).toBe("123 Main St");
  });

  it("host match with www ignored", () => {
    // Seed has www, source doesn't
    const result1 = venueSeedFor("https://example.com/events/page2", seeds);
    expect(result1?.url).toBe("https://example.com/events");
    expect(result1?.venueAddress).toBe("123 Main St");

    // Source has www, seed doesn't
    const result2 = venueSeedFor("https://www.example.com/events/page3", seeds);
    expect(result2?.url).toBe("https://example.com/events");
    expect(result2?.venueAddress).toBe("123 Main St");
  });

  it("host match with www seed and non-www source", () => {
    const result = venueSeedFor("https://example.com/calendar", seeds);
    expect(result?.url).toBe("https://example.com/events");
    expect(result?.venueAddress).toBe("123 Main St");
  });

  it("seed with venueAddress but venuePage undefined: no host match", () => {
    const result = venueSeedFor("https://other.com/page", seeds);
    expect(result).toBeUndefined();
  });

  it("different subdomains do not match", () => {
    const result = venueSeedFor("https://houseofyes.org/page", seeds);
    expect(result?.url).toBe("https://houseofyes.org/");
    expect(result?.venueAddress).toBe("111 Venue St");

    const result2 = venueSeedFor("https://calendar.houseofyes.org/page", seeds);
    expect(result2?.url).toBe("https://calendar.houseofyes.org/");
    expect(result2?.venueAddress).toBe("222 Other St");
  });

  it("unparsable source URL returns undefined", () => {
    const result = venueSeedFor("not a url", seeds);
    expect(result).toBeUndefined();
  });

  it("exact-URL seed without venueAddress wins over host-matching seed", () => {
    const customSeeds = [
      { url: "https://exactmatch.com/", venueAddress: undefined, venuePage: true },
      { url: "https://www.exactmatch.com/other", venueAddress: "999 Host St", venuePage: true },
    ];
    const result = venueSeedFor("https://exactmatch.com/", customSeeds);
    expect(result?.url).toBe("https://exactmatch.com/");
    expect(result?.venueAddress).toBeUndefined();
  });

  it("using real NYC_SOURCES", () => {
    // LPR exact match
    const lprResult = venueSeedFor("https://lpr.com/", NYC_SOURCES);
    expect(lprResult?.venueAddress).toBe("158 Bleecker St, New York, NY 10012");

    // Somewhere Nowhere page-2 URL should match by host
    const somewhereResult = venueSeedFor(
      "https://www.somewherenowherenyc.com/events?9dda5f90_page=2",
      NYC_SOURCES,
    );
    expect(somewhereResult?.venueAddress).toBe("112 W 25th St, New York, NY 10001");
  });
});
