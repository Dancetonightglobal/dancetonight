// London's postcode prefixes (D-194): a London postcode stays, a postcode elsewhere in the UK is outside.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import { postcodeOutsideMetro } from "@/src/pipeline/geocode";

const LONDON: Pick<Metro, "slug" | "countryCode"> = { slug: "london", countryCode: "GB" };

describe("postcodeOutsideMetro in London", () => {
  it.each([
    "51 Croftdown Road, London NW5 1HE",
    "109 Peckham High Street, London SE15 5SE",
    "1 Rich Mix, Bethnal Green Road, London E1 6LA",
    "Old Street, London EC1V 9NR",
    "Denmark Street, London WC2H 8NJ",
    "N22 7AY",
    "W1D 4HS",
    "Croydon CR0 1NX",
    "Romford RM1 3EE",
    "Kingston upon Thames KT1 1EU",
  ])("keeps %s", (address) => {
    expect(postcodeOutsideMetro(address, LONDON)).toBeNull();
  });

  it.each([
    ["Norwich NR2 4PG", "NR24PG"],
    ["Northampton NN1 1AA", "NN11AA"],
    ["Newcastle NE1 4XF", "NE14XF"],
    ["Brighton BN1 1AE", "BN11AE"],
    ["Oxford OX1 2JD", "OX12JD"],
    ["Slough SL1 1XW", "SL11XW"],
  ])("puts %s outside", (address, code) => {
    expect(postcodeOutsideMetro(address, LONDON)).toContain(code);
  });
});
