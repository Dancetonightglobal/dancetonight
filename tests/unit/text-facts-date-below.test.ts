import { describe, expect, it } from "vitest";
import {
  listedOnlyUnderOtherDates,
  foldPage,
  dateBesideTitle,
  contradictingDate,
} from "@/src/domain/text-facts";

const CLUB_ORACULO_PAGE = `EVENTOS
29 de octubre – 01 de noviembre
¡UNIRME A LA COMUNIDAD!
Jueves de Karaoke
Fecha
Jueves 29 de octubre, 2026
Horario
De 10 pm a 3:45 am
DJ
Criss Arias
¡Reservar!
Viernes de Show Drag
Fecha
Viernes 30 de octubre, 2026
Horario
De 10 pm a 3:45 am
¡Reservar!
Sábados de Show Drag
Fecha
Sábado 31 de octubre, 2026
Horario
De 09 pm a 3:45 am
¡Reservar!
Domingo de Bellakeo
Fecha
Domingo 01 de noviembre, 2026
Horario
De 10:30 pm a 3:45 am
¡Reservar!`;

describe("date below title with a short label line (Club Oráculo)", () => {
  it("returns null when each card is on its own date (label line skipped)", () => {
    expect(
      listedOnlyUnderOtherDates(CLUB_ORACULO_PAGE, "Jueves de Karaoke", "2026-10-29", "es"),
    ).toBeNull();
    expect(
      listedOnlyUnderOtherDates(CLUB_ORACULO_PAGE, "Viernes de Show Drag", "2026-10-30", "es"),
    ).toBeNull();
    expect(
      listedOnlyUnderOtherDates(CLUB_ORACULO_PAGE, "Sábados de Show Drag", "2026-10-31", "es"),
    ).toBeNull();
    expect(
      listedOnlyUnderOtherDates(CLUB_ORACULO_PAGE, "Domingo de Bellakeo", "2026-11-01", "es"),
    ).toBeNull();
  });

  it("rejects a card on a different date (non-null)", () => {
    expect(
      listedOnlyUnderOtherDates(CLUB_ORACULO_PAGE, "Viernes de Show Drag", "2026-10-31", "es"),
    ).not.toBeNull();
    expect(
      listedOnlyUnderOtherDates(CLUB_ORACULO_PAGE, "Domingo de Bellakeo", "2026-10-30", "es"),
    ).not.toBeNull();
  });

  it("does not skip a long line between title and date", () => {
    const modified = CLUB_ORACULO_PAGE.replace(
      "Viernes de Show Drag\nFecha\n",
      "Viernes de Show Drag\nCon DJs Camz y Criss Arias toda la noche\n",
    );
    expect(
      listedOnlyUnderOtherDates(modified, "Viernes de Show Drag", "2026-10-30", "es"),
    ).not.toBeNull();
  });

  it("accepts an English label line", () => {
    const page = `Monday, October 5
Salsa Night
Date:
Tuesday, October 6
Bachata Night`;
    expect(listedOnlyUnderOtherDates(page, "Salsa Night", "2026-10-06", "en")).toBeNull();
  });
});

describe("dateBesideTitle with short label line (Club Oráculo)", () => {
  const TITLES = [
    "Jueves de Karaoke",
    "Viernes de Show Drag",
    "Sábados de Show Drag",
    "Domingo de Bellakeo",
  ];
  const page = foldPage(CLUB_ORACULO_PAGE);

  it("states true for each card's own date", () => {
    expect(dateBesideTitle(page, "Viernes de Show Drag", "2026-10-30", "es", TITLES).stated).toBe(
      true,
    );
    expect(dateBesideTitle(page, "Sábados de Show Drag", "2026-10-31", "es", TITLES).stated).toBe(
      true,
    );
    expect(dateBesideTitle(page, "Domingo de Bellakeo", "2026-11-01", "es", TITLES).stated).toBe(
      true,
    );
  });

  it("contradictingDate is null for own date", () => {
    expect(
      contradictingDate(
        page,
        CLUB_ORACULO_PAGE,
        "Viernes de Show Drag",
        "2026-10-30",
        "es",
        TITLES,
      ),
    ).toBeNull();
    expect(
      contradictingDate(
        page,
        CLUB_ORACULO_PAGE,
        "Sábados de Show Drag",
        "2026-10-31",
        "es",
        TITLES,
      ),
    ).toBeNull();
    expect(
      contradictingDate(page, CLUB_ORACULO_PAGE, "Domingo de Bellakeo", "2026-11-01", "es", TITLES),
    ).toBeNull();
  });

  it("contradictingDate is not null for a different date", () => {
    expect(
      contradictingDate(
        page,
        CLUB_ORACULO_PAGE,
        "Viernes de Show Drag",
        "2026-10-31",
        "es",
        TITLES,
      ),
    ).not.toBeNull();
  });

  it("without label line, dateBesideTitle returns false", () => {
    const modified = CLUB_ORACULO_PAGE.replace(
      "Viernes de Show Drag\nFecha\n",
      "Viernes de Show Drag\nCon DJs Camz y Criss Arias toda la noche\n",
    );
    const page2 = foldPage(modified);
    expect(dateBesideTitle(page2, "Viernes de Show Drag", "2026-10-30", "es", TITLES).stated).toBe(
      false,
    );
  });

  it("never takes the next card's label and date as a dateless card's own", () => {
    const text = `Sábado 31 de octubre, 2026
Noche Sin Fecha
Noche Siguiente
Fecha
Miércoles 4 de noviembre, 2026`;
    const titles = ["Noche Sin Fecha", "Noche Siguiente"];
    const page3 = foldPage(text);
    expect(dateBesideTitle(page3, "Noche Sin Fecha", "2026-11-04", "es", titles).stated).toBe(
      false,
    );
    expect(dateBesideTitle(page3, "Noche Siguiente", "2026-11-04", "es", titles).stated).toBe(true);
  });
});
