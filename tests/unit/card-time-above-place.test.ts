import { describe, expect, it } from "vitest";
import { titleBlocks } from "@/src/domain/title-blocks";
import { checkListingTimes } from "@/src/domain/stated-times";
import { rawListingSchema } from "@/src/domain/listing";

// Dio Club (sevendance.com/es/dio-club, read 41045905409, 2026-10-30): each card prints its date,
// then its time range, then its place, then its title. The place line between the time and the
// title hid the time, so all six times were dropped as "not written".
const DIO_PAGE = `Próximos Eventos

- Vie, 30 Oct

- 23:00-03:00

- Carrer del Perill 10 - BCN Gràcia

Viernes de Bachata Nights & Dio Club Salsa [https://www.sevendance.com/es/practicas-de-baile/1447]

Los viernes se baila bachata y salsa en dos salas.

Más información

- Dom, 1 Nov

- 18:00-22:00

- BCN Gràcia

Domingo TARDEO de Bachateo [https://www.sevendance.com/es/practicas-de-baile/1449]

Disfrutaremos de 4 horas de sesión para bailar desde el primer minuto.

Más información

- Vie, 6 Nov

- 19:45-22:00

- Carrer del Perill 10 - BCN Gràcia

Bailes de Salón [https://www.sevendance.com/es/practicas-de-baile/1446]

Para disfrutar de Dio Club es imprescindible estar registrado previamente.
`;

const TITLES = [
  "Viernes de Bachata Nights & Dio Club Salsa",
  "Domingo TARDEO de Bachateo",
  "Bailes de Salón",
];

function check(title: string, date: string, dancing: string, end: string) {
  const others = TITLES.filter((t) => t !== title);
  const blocks = titleBlocks(DIO_PAGE, title, others, "es");
  const listing = rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: [],
    organizer: {},
    venue: { name: "Dio Club" },
    local_date: date,
    dancing_time: dancing,
    end_time: end,
  });
  return checkListingTimes(listing, { blocks, pageText: DIO_PAGE, title, date, lang: "es" });
}

describe("a card's time above its place line (D-370)", () => {
  it("keeps the time range written above the place line", () => {
    const friday = check(TITLES[0]!, "2026-10-30", "23:00", "03:00");
    expect(friday.withdrawn).toBe(false);
    expect(friday.listing.dancing_time).toBe("23:00");
    expect(friday.listing.end_time).toBe("03:00");

    const sunday = check(TITLES[1]!, "2026-11-01", "18:00", "22:00");
    expect(sunday.listing.dancing_time).toBe("18:00");
    expect(sunday.listing.end_time).toBe("22:00");

    const ballroom = check(TITLES[2]!, "2026-11-06", "19:45", "22:00");
    expect(ballroom.listing.dancing_time).toBe("19:45");
  });

  it("does not take another card's time", () => {
    // Sunday's card says 18:00-22:00; Friday's 23:00 is not Sunday's.
    const wrong = check(TITLES[1]!, "2026-11-01", "23:00", "03:00");
    expect(wrong.listing.dancing_time).not.toBe("23:00");
  });

  it("leaves a time under the previous title, then a place line, to that title", () => {
    // Title first, time under it, then a venue line: the time is the first title's, never the
    // second's (the layout that lists each time under its own title).
    const page = `Salsa Night\n\n9pm-2am\n\nClub Uno\n\nBachata Social\n\n10pm-1am\n\nClub Dos\n`;
    const blocks = titleBlocks(page, "Bachata Social", ["Salsa Night"], "en");
    const listing = rawListingSchema.parse({
      title: "Bachata Social",
      listing_type: "social",
      styles: [],
      organizer: {},
      venue: { name: "Club Dos" },
      dancing_time: "21:00",
    });
    const checked = checkListingTimes(listing, {
      blocks,
      pageText: page,
      title: "Bachata Social",
      date: null,
      lang: "en",
    });
    expect(checked.listing.dancing_time).not.toBe("21:00");
  });

  it("does not skip another listing's title to take its time", () => {
    // Salsa Night's card writes its date and time above it; Bachata Social, under it, has none.
    const page = `Sat, Nov 1, 10:00 PM\n\nSalsa Night\n\nBachata Social\n\nCome dance.\n`;
    const blocks = titleBlocks(page, "Bachata Social", ["Salsa Night"], "en");
    expect(blocks[0]!.above).not.toContain("10:00 PM");
  });

  it("does not skip a place line when no date stands above its clock line", () => {
    // A clock above the place line but no date anywhere above it: the place line is not skipped,
    // so the title gets no time from above.
    const page = `Doors 9pm\n\nClub Uno\n\nBachata Social\n\nCome dance.\n`;
    const blocks = titleBlocks(page, "Bachata Social", [], "en");
    expect(blocks[0]!.above).not.toContain("9pm");
  });
});
