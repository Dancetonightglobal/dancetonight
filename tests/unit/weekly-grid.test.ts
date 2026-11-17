import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const NOW = new Date("2026-10-29T14:00:00Z");
const TONIGHT = "2026-10-29";

function reply(listings: Array<Record<string, unknown>>, language: string = "es") {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language,
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "A studio" },
      organizer: {},
      ...l,
    })),
  });
}

const read = (
  pageUrl: string,
  text: string,
  listings: Array<Record<string, unknown>>,
  extra: { weeklyGrid?: boolean; countryCode?: string; language?: string } = {},
) =>
  extractionToHarvested(reply(listings, extra.language ?? "es"), {
    pageUrl,
    fetchedAt: NOW,
    today: TONIGHT,
    pageText: text,
    countryCode: "AR",
    ...extra,
  });

describe("weekly grid rule extraction (D-402)", () => {
  const gricel = `Programación y Reservas
Domingos
20 a 01 hs
MILONGA
La Porteña Milonga
Reservas 11 6446 3782
Lunes
18 a 01 hs
MILONGA
Milonga De Lucy
Jueves
19.30 a 21.15 hs
CLASE
Clase de Tango
Viernes
19.30 hs
CLASE
Clase de Tango
21 a 03 hs
MILONGA
Milonga Yira Yira`;

  const viruta = `Viruta Tango Club
HORARIOS
MIÉRCOLES
23:00
BAILE
VIERNES
23:00
BAILE
DOMINGO
23:00
BAILE
La Viruta Tango Club | Todos los derechos reservados | 2023`;

  const cachirulo = `Cachirulo
Esta tradicional milonga nació en el año 2003.
Organizan Norma y Héctor. Martes y sábados, 20:30 hs.
Riobamba 416, Buenos Aires, Argentina`;

  it("Gricel: La Porteña Milonga -> SU", () => {
    const result = read("https://example.com/", gricel, [{ title: "La Porteña Milonga" }], {
      weeklyGrid: true,
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
  });

  it("Gricel: Milonga Yira Yira -> FR", () => {
    const result = read("https://example.com/", gricel, [{ title: "Milonga Yira Yira" }], {
      weeklyGrid: true,
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
  });

  it("Gricel: Milonga De Lucy -> MO", () => {
    const result = read("https://example.com/", gricel, [{ title: "Milonga De Lucy" }], {
      weeklyGrid: true,
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("Gricel: Clase de Tango -> TH,FR", () => {
    const result = read("https://example.com/", gricel, [{ title: "Clase de Tango" }], {
      weeklyGrid: true,
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR");
  });

  it("Viruta: La Viruta Tango Club with phrase MIÉRCOLES -> WE", () => {
    const result = read(
      "https://example.com/",
      viruta,
      [{ title: "La Viruta Tango Club", recurrence_text: "MIÉRCOLES" }],
      { weeklyGrid: true },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");
    expect(result.notes).toContainEqual(
      expect.stringContaining("weekly grid came with no rule and no date"),
    );
  });

  it("Cachirulo: Cachirulo -> TU,SA", () => {
    const result = read("https://example.com/", cachirulo, [{ title: "Cachirulo" }], {
      weeklyGrid: true,
    });
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,SA");
  });

  it("without weeklyGrid flag: no recurrence", () => {
    const result = read("https://example.com/", gricel, [{ title: "La Porteña Milonga" }], {
      weeklyGrid: false,
    });
    // Passed on with no date and no rule; normalize rejects it ("no date listed").
    expect(result.listings.every((l) => l.recurrence === null)).toBe(true);
  });

  it("listing with a stated date is not given a rule", () => {
    const page = "Domingos\nFiesta Especial 2026-11-02\n";
    const result = read(
      "https://example.com/",
      page,
      [{ title: "Fiesta Especial", local_date: "2026-11-02" }],
      { weeklyGrid: true },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence).toBeNull();
    expect(result.listings[0]?.listing.local_date).toBe("2026-11-02");
  });

  it("dated heading does not produce a rule", () => {
    const page = "Domingo 2 de noviembre\nMilonga X\n";
    const result = read("https://example.com/", page, [{ title: "Milonga X" }], {
      weeklyGrid: true,
    });
    // Passed on with no date and no rule; normalize rejects it ("no date listed").
    expect(result.listings.every((l) => l.recurrence === null)).toBe(true);
  });

  it("weeklyGridRule direct test for Clase de Tango", async () => {
    // This test is to verify the written field contains "jueves" and "viernes"
    const { foldPage } = await import("@/src/domain/text-facts");
    const { weeklyGridRule } = await import("@/src/pipeline/weekly-grid");
    const page = foldPage(gricel);
    const rule = weeklyGridRule(page, gricel, "Clase de Tango", null, "es");
    expect(rule).not.toBeNull();
    expect(rule!.rrule).toBe("FREQ=WEEKLY;BYDAY=TH,FR");
    const written = rule!.written.toLowerCase();
    expect(written).toContain("jueves");
    expect(written).toContain("viernes");
  });

  it("Maison: 'EVERY FRIDAY' heading yields FR rule", () => {
    const maison = `The Maison
EVERY FRIDAY
11pm – Dance Party w/ rotating DJs every week.
EVERY SATURDAY
11pm – Dance Party w/ rotating DJs every week.`;
    const result = read(
      "https://example.com/",
      maison,
      [{ title: "Dance Party w/ rotating DJs" }],
      {
        weeklyGrid: true,
      },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    // The listing appears under both headings, so the rule includes both days
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA");
  });

  const virutaFull = `HORARIOS

Horario de apertura: 20:00 hs.

MIÉRCOLES

20:30

CLASES DE

ROCK

22:00

CLASES DE

TANGO

23:00

BAILE

VIERNES

20:30

CLASES DE

SALSA

21:45

CLASES DE

TANGO

23:00

SHOW

BAILE

AL FINALIZAR EL SHOW

DOMINGO

20:30

CLASES DE

MILONGA

22:00

CLASES DE

TANGO

23:00

BAILE

RESERVAS E INFORMES:

Armenia 1366, Palermo, CBA

La Viruta Tango Club | Todos los derechos reservados | 2023`;

  it("La Viruta: three listings with times from weekday sections", () => {
    const result = read(
      "https://example.com/",
      virutaFull,
      [
        {
          title: "La Viruta Tango Club",
          recurrence_text: "MIÉRCOLES",
          lesson_time: "20:30",
          dancing_time: "23:00",
        },
        {
          title: "La Viruta Tango Club",
          recurrence_text: "VIERNES",
          lesson_time: "20:30",
          dancing_time: "23:00",
        },
        {
          title: "La Viruta Tango Club",
          recurrence_text: "DOMINGO",
          lesson_time: "20:30",
          dancing_time: "23:00",
        },
      ],
      { weeklyGrid: true },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(3);
    const rules = result.listings.map((l) => l.recurrence?.rrule);
    expect(rules).toContain("FREQ=WEEKLY;BYDAY=WE");
    expect(rules).toContain("FREQ=WEEKLY;BYDAY=FR");
    expect(rules).toContain("FREQ=WEEKLY;BYDAY=SU");
    for (const l of result.listings) {
      expect(l.listing.dancing_time).toBe("23:00");
    }
  });

  it("La Viruta: time not written in section is dropped", () => {
    const result = read(
      "https://example.com/",
      virutaFull,
      [{ title: "La Viruta Tango Club", recurrence_text: "MIÉRCOLES", dancing_time: "01:00" }],
      { weeklyGrid: true },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.dancing_time).toBeNull();
  });

  describe("Portuguese -feira weekday headings (D-294)", () => {
    const barDoOmar = `Programação
Quinta-feira
Misturadinho do Compasso
Roda de samba com convidados.
A partir das 17h
Sexta-feira
Pagode do Vitu
Pagode ao vivo.
A partir das 17h
Sábado
Noca Neto
Samba de raiz.
A partir das 15h
Domingo
Dose dupla de Samba
Duas rodas.
A partir das 1h`;

    it("Misturadinho do Compasso -> TH", () => {
      const result = read(
        "https://example.com/",
        barDoOmar,
        [{ title: "Misturadinho do Compasso" }],
        { weeklyGrid: true, countryCode: "BR", language: "pt" },
      );
      expect(result.rejected).toEqual([]);
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
    });

    it("Pagode do Vitu -> FR", () => {
      const result = read("https://example.com/", barDoOmar, [{ title: "Pagode do Vitu" }], {
        weeklyGrid: true,
        countryCode: "BR",
        language: "pt",
      });
      expect(result.rejected).toEqual([]);
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=FR");
    });

    it("Noca Neto -> SA", () => {
      const result = read("https://example.com/", barDoOmar, [{ title: "Noca Neto" }], {
        weeklyGrid: true,
        countryCode: "BR",
        language: "pt",
      });
      expect(result.rejected).toEqual([]);
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SA");
    });

    it("Dose dupla de Samba -> SU", () => {
      const result = read("https://example.com/", barDoOmar, [{ title: "Dose dupla de Samba" }], {
        weeklyGrid: true,
        countryCode: "BR",
        language: "pt",
      });
      expect(result.rejected).toEqual([]);
      expect(result.listings).toHaveLength(1);
      expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=SU");
    });
  });

  it("weeklyGridSection returns correct section", async () => {
    const { weeklyGridSection } = await import("@/src/pipeline/weekly-grid");
    const section = weeklyGridSection(virutaFull, "MIÉRCOLES", "es");
    expect(section).not.toBeNull();
    expect(section).toContain("20:30");
    expect(section).toContain("ROCK");
    expect(section).not.toContain("SALSA");
    expect(section).not.toContain("VIERNES");
  });

  it("Gricel: Clase de Tango still works (title inside section)", () => {
    const result = read(
      "https://example.com/",
      gricel,
      [{ title: "Clase de Tango", recurrence_text: "Jueves", lesson_time: "19:30" }],
      { weeklyGrid: true },
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=TH");
    expect(result.listings[0]?.listing.lesson_time).toBe("19:30");
  });
});
