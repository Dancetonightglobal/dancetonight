import { describe, expect, it } from "vitest";
import { contradictingDate, dateBesideTitle, foldPage } from "@/src/domain/text-facts";

// SomSardana (somsardana.cat agenda, read 41045905409, 2026-10-30) prints each event on one line:
// a category word, the date and time, the title, the cobla and the place. The date before the
// title was not read as the listing's (the line opens with "BALLADA", not a date), and the next
// card's "02 Nov" was taken as this one's, so the ballada of 1 November was rejected.
const SOM_PAGE = `Agenda d’esdeveniments

S'han trobat: 1 ballada | 1 concert

BALLADA Dg. 01 Nov. 2026 11:15h Ballada de sardanes Cobla: Reus Jove Pla de la Catedral - BARCELONA BALLADA Veure més [https://somsardana.cat/sardanisme/agenda/503901]

CONCERT Dl. 02 Nov. 2026 19:00h 15è Aniversari de la Cobla Sol de Banyuls Cobla: Sol de Banyuls Casino l'Aliança del Poble Nou - BARCELONA CONCERT Veure més [https://somsardana.cat/sardanisme/agenda/504285]

Es mostren tots els resultats.
`;

const TITLE = "Ballada de sardanes";

describe("a one-line card whose date follows a category word (D-371)", () => {
  it("reads the date before the title as the listing's", () => {
    const page = foldPage(SOM_PAGE);
    expect(dateBesideTitle(page, TITLE, "2026-11-01", "ca", []).stated).toBe(true);
    expect(contradictingDate(page, SOM_PAGE, TITLE, "2026-11-01", "ca", [])).toBeNull();
  });

  it("does not take the next card's date as a contradiction", () => {
    const page = foldPage(SOM_PAGE);
    expect(contradictingDate(page, SOM_PAGE, TITLE, "2026-11-01", "es", [])).toBeNull();
  });

  it("still rejects a date the card contradicts", () => {
    const page = foldPage(SOM_PAGE);
    expect(dateBesideTitle(page, TITLE, "2026-11-08", "ca", []).stated).toBe(false);
    expect(contradictingDate(page, SOM_PAGE, TITLE, "2026-11-08", "ca", [])).not.toBeNull();
  });

  it("reads a date with a time between it and the title", () => {
    const page = foldPage("Dg. 01 Nov. 2026 11:15h Ballada de sardanes Cobla: Reus Jove\n");
    expect(dateBesideTitle(page, TITLE, "2026-11-01", "ca", []).stated).toBe(true);
  });
});

describe("one-line cards on other metros' pages (D-371)", () => {
  it("an English card that opens with a category word still states its date", () => {
    const text =
      "LIVE Fri 31 Oct 9pm Salsa Night at Club Uno Tickets [https://x.test/1]\n\nLIVE Sat 1 Nov 9pm Bachata Social Tickets [https://x.test/2]\n";
    const page = foldPage(text);
    expect(dateBesideTitle(page, "Salsa Night", "2026-10-31", "en", []).stated).toBe(true);
    expect(contradictingDate(page, text, "Salsa Night", "2026-10-31", "en", [])).toBeNull();
    expect(contradictingDate(page, text, "Bachata Social", "2026-10-31", "en", [])).not.toBeNull();
  });

  it("a lower-case word before the date is not a category word (as before)", () => {
    const text = "see you Fri 31 Oct for the Salsa Night at Club Uno\n";
    const page = foldPage(text);
    expect(contradictingDate(page, text, "Salsa Night", "2026-11-07", "en", [])).toBeNull();
  });

  it("a weekday in capitals is not a category word: the short lead states, never contradicts", () => {
    const text = "FRI 31 Oct Salsa Night at Club Uno\n";
    const page = foldPage(text);
    expect(dateBesideTitle(page, "Salsa Night", "2026-10-31", "en", []).stated).toBe(true);
    expect(contradictingDate(page, text, "Salsa Night", "2026-11-07", "en", [])).toBeNull();
  });
});
