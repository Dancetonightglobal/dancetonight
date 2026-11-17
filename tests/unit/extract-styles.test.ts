// A model read's style stands only where the page names its family or the source is of it (D-107).

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";
import { decideStyles } from "@/src/pipeline/normalize";

const read = (
  url: string,
  text: string,
  listings: Array<Record<string, unknown>>,
  sourceStyles: string[],
) =>
  extractionToHarvested(
    rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: listings.map((l) => ({
        listing_type: "social",
        venue: { name: "A hall" },
        organizer: {},
        ...l,
      })),
    }),
    {
      pageUrl: url,
      fetchedAt: new Date("2026-09-30T12:00:00Z"),
      today: "2026-09-30",
      pageText: text,
      countryCode: "US",
      sourceStyles,
    },
  );

const stylesOf = (r: ReturnType<typeof read>, title: string) =>
  r.listings.find((h) => h.listing.title === title)!.listing.styles;

describe("Swing Remix: The Brooks Prumo Orchestra was listed as tango (D-083, D-107)", () => {
  const page = readFileSync("evals/links/pages/swingremixnyc-com.txt", "utf8");
  const r = read(
    "https://swingremixnyc.com/",
    page,
    [{ title: "The Brooks Prumo Orchestra", local_date: "2026-10-03", styles: ["tango"] }],
    ["lindy_hop"],
  );
  it("withdraws a style whose family the page never names, and says so", () => {
    expect(stylesOf(r, "The Brooks Prumo Orchestra")).toEqual([]);
    expect(r.notes.join("\n")).toContain(
      "came with a style the page never names; left to the title or the source: The Brooks Prumo Orchestra (tango)",
    );
  });
  it("leaves the night to the source's own style", () => {
    const listing = r.listings[0]!.listing;
    expect(decideStyles(listing, ["lindy_hop"], "social").styles).toEqual(["lindy_hop"]);
  });
  it("keeps a style of the source's family the page does not name either", () => {
    const kept = read(
      "https://swingremixnyc.com/",
      page,
      [{ title: "The Brooks Prumo Orchestra", local_date: "2026-10-03", styles: ["balboa"] }],
      ["lindy_hop"],
    );
    expect(stylesOf(kept, "The Brooks Prumo Orchestra")).toEqual(["balboa"]);
  });
});

describe("a style the page does not name (D-107)", () => {
  const page = ["Friday Social", "9pm to 1am at the hall", "$15 at the door"].join("\n");
  it("keeps a style of the source's own family", () => {
    const r = read(
      "https://example.com/",
      page,
      [{ title: "Friday Social", styles: ["tango"] }],
      ["tango"],
    );
    expect(stylesOf(r, "Friday Social")).toEqual(["tango"]);
  });
  it("withdraws only the unnamed one of two", () => {
    const r = read(
      "https://example.com/",
      page,
      [{ title: "Friday Social", styles: ["tango", "salsa"] }],
      ["tango"],
    );
    expect(stylesOf(r, "Friday Social")).toEqual(["tango"]);
    expect(r.notes.join("\n")).toContain("Friday Social (salsa)");
  });
  it("keeps a style of a family the page names anywhere", () => {
    const named = `${page}\nSalsa and bachata every week`;
    const r = read(
      "https://example.com/",
      named,
      [{ title: "Friday Social", styles: ["salsa"] }],
      [],
    );
    expect(stylesOf(r, "Friday Social")).toEqual(["salsa"]);
  });
});
