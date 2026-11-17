import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";

describe("Miami Baila Calle 8 known venue", () => {
  it("files TangoMango's website-as-venue under the studio's name and address", () => {
    const entry = KNOWN_VENUES.miami?.find((v) => v.names.includes("www.Miamibaila.Com"));
    expect(entry?.names[0]).toBe("Miami Baila Calle 8");
    expect(entry?.address).toBe("760 SW 10th Ave, Miami, FL 33130");
    expect(entry?.canonical).toBe(true);
  });
});
