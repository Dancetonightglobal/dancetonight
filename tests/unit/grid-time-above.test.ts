import { describe, expect, it } from "vitest";
import { titleBlocks } from "@/src/domain/title-blocks";
import { checkListingTimes } from "@/src/domain/stated-times";
import { rawListingSchema } from "@/src/domain/listing";

const GRICEL_PAGE = `Domingos
2
18.30 hs
CLASE
Clase de Tango
Maestros invitados
20 a 01 hs
MILONGA
La Porteña Milonga
Reservas 11 6446 3782
Lunes
1
18 a 01 hs
MILONGA
Milonga De Lucy
Reservas 11 6519 9573
Miércoles
2
21 a 22.15 hs
CLASE
Americano, Rock n’ Roll y más
Reservas 11 2860 3404
22.15 a 03 hs
SOCIAL
Baile Social
Americano, Rock n’ Roll y más
Reservas 11 2860 3404`;

const OTHERS = [
  "Clase de Tango",
  "La Porteña Milonga",
  "Milonga De Lucy",
  "Americano, Rock n’ Roll y más",
  "Baile Social",
];

describe("weekly grid time above a title (D-253)", () => {
  it("titleBlocks with grid:true includes time line above, skipping one label line", () => {
    const blocks = titleBlocks(GRICEL_PAGE, "La Porteña Milonga", OTHERS, "es", undefined, {
      grid: true,
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.above).toContain("20 a 01 hs");
    // Without grid, above would be empty (or not contain the time)
    const blocksNoGrid = titleBlocks(
      GRICEL_PAGE,
      "La Porteña Milonga",
      OTHERS,
      "es",
      undefined,
      {},
    );
    expect(blocksNoGrid[0]!.above).not.toContain("20 a 01 hs");
  });

  it("keeps times that match the time line above", () => {
    const blocks = titleBlocks(GRICEL_PAGE, "La Porteña Milonga", OTHERS, "es", undefined, {
      grid: true,
    });
    const listing = rawListingSchema.parse({
      title: "La Porteña Milonga",
      listing_type: "social",
      styles: [],
      organizer: {},
      venue: { name: "A studio" },
      dancing_time: "20:00",
      end_time: "01:00",
    });
    const checked = checkListingTimes(listing, {
      blocks,
      pageText: GRICEL_PAGE,
      title: "La Porteña Milonga",
      date: null,
      lang: "es",
    });
    expect(checked.withdrawn).toBe(false);
    expect(checked.listing.dancing_time).toBe("20:00");
    expect(checked.listing.end_time).toBe("01:00");
  });

  it("withdraws a time that does not match the time line above", () => {
    const blocks = titleBlocks(GRICEL_PAGE, "La Porteña Milonga", OTHERS, "es", undefined, {
      grid: true,
    });
    const listing = rawListingSchema.parse({
      title: "La Porteña Milonga",
      listing_type: "social",
      styles: [],
      organizer: {},
      venue: { name: "A studio" },
      dancing_time: "18:30", // this is the class's time above the previous title
      end_time: "01:00",
    });
    const checked = checkListingTimes(listing, {
      blocks,
      pageText: GRICEL_PAGE,
      title: "La Porteña Milonga",
      date: null,
      lang: "es",
    });
    expect(checked.withdrawn).toBe(true);
    expect(checked.listing.dancing_time).toBeNull();
  });

  it("handles Milonga De Lucy (18 a 01 hs)", () => {
    const blocks = titleBlocks(GRICEL_PAGE, "Milonga De Lucy", OTHERS, "es", undefined, {
      grid: true,
    });
    const listing = rawListingSchema.parse({
      title: "Milonga De Lucy",
      listing_type: "social",
      styles: [],
      organizer: {},
      venue: { name: "A studio" },
      dancing_time: "18:00",
      end_time: "01:00",
    });
    const checked = checkListingTimes(listing, {
      blocks,
      pageText: GRICEL_PAGE,
      title: "Milonga De Lucy",
      date: null,
      lang: "es",
    });
    expect(checked.withdrawn).toBe(false);
    expect(checked.listing.dancing_time).toBe("18:00");
    expect(checked.listing.end_time).toBe("01:00");
  });

  it("handles Baile Social (22.15 a 03 hs)", () => {
    const blocks = titleBlocks(GRICEL_PAGE, "Baile Social", OTHERS, "es", undefined, {
      grid: true,
    });
    const listing = rawListingSchema.parse({
      title: "Baile Social",
      listing_type: "social",
      styles: [],
      organizer: {},
      venue: { name: "A studio" },
      dancing_time: "22:15",
      end_time: "03:00",
    });
    const checked = checkListingTimes(listing, {
      blocks,
      pageText: GRICEL_PAGE,
      title: "Baile Social",
      date: null,
      lang: "es",
    });
    expect(checked.withdrawn).toBe(false);
    expect(checked.listing.dancing_time).toBe("22:15");
    expect(checked.listing.end_time).toBe("03:00");
  });

  it("handles Clase de Tango (18.30 hs)", () => {
    const blocks = titleBlocks(GRICEL_PAGE, "Clase de Tango", OTHERS, "es", undefined, {
      grid: true,
    });
    const listing = rawListingSchema.parse({
      title: "Clase de Tango",
      listing_type: "class",
      styles: [],
      organizer: {},
      venue: { name: "A studio" },
      lesson_time: "18:30",
      end_time: null,
    });
    const checked = checkListingTimes(listing, {
      blocks,
      pageText: GRICEL_PAGE,
      title: "Clase de Tango",
      date: null,
      lang: "es",
    });
    expect(checked.withdrawn).toBe(false);
    expect(checked.listing.lesson_time).toBe("18:30");
  });
});
