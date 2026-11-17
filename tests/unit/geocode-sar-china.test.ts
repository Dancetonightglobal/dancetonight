// "Central, Hong Kong, China" is Hong Kong, not elsewhere (D-668): RA writes ", China" after every Hong Kong venue.
import { describe, expect, it } from "vitest";

import { geoapifyElsewhere } from "@/src/pipeline/geocode";

const parsed = (fields: Record<string, string>) => ({ query: { parsed: fields } });
const HK = { countryCode: "HK" };
const MO = { countryCode: "MO" };
const NYC = { countryCode: "US" };

describe("geoapifyElsewhere: Hong Kong and Macau written with China (D-668)", () => {
  it("keeps a Hong Kong address that ends in China", () => {
    expect(
      geoapifyElsewhere(parsed({ city: "central", state: "hong kong", country: "china" }), HK),
    ).toBeNull();
    expect(geoapifyElsewhere(parsed({ city: "hong kong", country: "china" }), HK)).toBeNull();
    expect(geoapifyElsewhere(parsed({ state: "hong kong sar", country: "china" }), HK)).toBeNull();
    expect(
      geoapifyElsewhere(
        parsed({ city: "wan chai", state: "hong kong island", country: "china" }),
        HK,
      ),
    ).toBeNull();
  });

  it("keeps a Macau address that ends in China", () => {
    expect(geoapifyElsewhere(parsed({ city: "macau", country: "china" }), MO)).toBeNull();
    expect(geoapifyElsewhere(parsed({ city: "macao", country: "china" }), MO)).toBeNull();
  });

  it("still names mainland China, and Macau from Hong Kong", () => {
    expect(
      geoapifyElsewhere(parsed({ city: "shenzhen", state: "guangdong", country: "china" }), HK),
    ).toBe("shenzhen, guangdong, china");
    expect(geoapifyElsewhere(parsed({ city: "macau", country: "china" }), HK)).toBe("macau, china");
    expect(geoapifyElsewhere(parsed({ city: "hong kong", country: "china" }), MO)).toBe(
      "hong kong, china",
    );
  });

  it("does not change other countries", () => {
    expect(geoapifyElsewhere(parsed({ city: "hong kong", country: "china" }), NYC)).toBe(
      "hong kong, china",
    );
    expect(geoapifyElsewhere(parsed({ city: "central", country: "hong kong" }), HK)).toBeNull();
  });
});
