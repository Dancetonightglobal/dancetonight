import { describe, expect, it } from "vitest";
import { screenNoDance, screenEvidenceText } from "@/src/domain/listing-screen";
import { buildListing } from "@/src/adapters/structured";
import type { StructuredEvent } from "@/src/adapters/structured";

describe("structured description evidence (D-261)", () => {
  const tz = "America/Sao_Paulo";
  const night = "2026-10-30";
  const at9pm = (title: string, evidenceText?: string | null) => ({
    title,
    styles: [],
    startsAt: new Date("2026-10-30T21:00:00-03:00"),
    nightDate: night,
    tz,
    evidenceText,
  });
  const mixed = { mixedCalendar: true, styles: [] };

  describe("screenNoDance with evidenceText", () => {
    it("keeps 'FUNDO DE QUINTAL NO BAR DA LAPA' with pagode in evidence", () => {
      const result = screenNoDance(
        at9pm("FUNDO DE QUINTAL NO BAR DA LAPA", "Noite de pagode com Fundo de Quintal"),
        mixed,
      );
      expect(result).toBeNull();
    });

    it("screens same title with non-dance evidence", () => {
      const result = screenNoDance(
        at9pm("FUNDO DE QUINTAL NO BAR DA LAPA", "show acústico de MPB"),
        mixed,
      );
      expect(result?.kind).toBe("not_a_dance");
    });

    it("keeps 'SAMBINHA DA ASHA' (party kind in title)", () => {
      const result = screenNoDance(at9pm("SAMBINHA DA ASHA"), mixed);
      expect(result).toBeNull();
    });

    it("screens 'Recital' with pagode evidence but seated show", () => {
      const result = screenNoDance(at9pm("Recital", "pagode depois do recital"), mixed);
      expect(result).not.toBeNull();
      expect(result?.kind).toBe("not_a_dance");
    });
  });

  describe("buildListing description evidence", () => {
    const baseEvent: StructuredEvent = {
      externalId: null,
      title: "Test Event",
      start: { day: "2026-10-30", night: "2026-10-30", time: "21:00", zone: tz, absolute: false },
      end: null,
      description: null,
      venue: { name: null, address: null, url: null, location: null },
      organizer: { name: null, url: null },
      prices: null,
      ticketUrl: null,
      cancelled: false,
      styles: [],
      type: null,
      bands: [],
      djs: [],
      evidence: {},
      recurrence: null,
    };
    const options = {
      sourceUrl: "https://www.sympla.com.br/evento/x/1",
      fetchedAt: new Date(),
      method: "jsonld" as const,
      currency: "BRL",
    };

    it("sets evidence.description when description contains dance/party words", () => {
      const event: StructuredEvent = {
        ...baseEvent,
        description: "Ingressos no site.\nNoite de PAGODE com Fundo de Quintal. Traga amigos.",
      };
      const result = buildListing(event, options);
      expect(result.listing.evidence.description).toBe("Noite de PAGODE com Fundo de Quintal.");
    });

    it("sets evidence.description for dance word 'dançar'", () => {
      const event: StructuredEvent = {
        ...baseEvent,
        description: "Venha dançar forró a noite toda",
      };
      const result = buildListing(event, options);
      expect(result.listing.evidence.description).toBe("Venha dançar forró a noite toda");
    });

    it("does not set evidence.description when no dance/party words", () => {
      const event: StructuredEvent = {
        ...baseEvent,
        description: "Palestra sobre economia",
      };
      const result = buildListing(event, options);
      expect(result.listing.evidence.description).toBeUndefined();
    });

    it("screenEvidenceText picks up description evidence", () => {
      const event: StructuredEvent = {
        ...baseEvent,
        description: "Ingressos no site.\nNoite de PAGODE com Fundo de Quintal. Traga amigos.",
      };
      const result = buildListing(event, options);
      const evidenceText = screenEvidenceText(result.listing.evidence);
      expect(evidenceText).toContain("PAGODE");
    });
  });
});
