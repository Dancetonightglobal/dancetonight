import { describe, expect, it } from "vitest";
import { screenEvidenceText, screenNoDance } from "@/src/domain/listing-screen";

describe("evidence text keeps dance words (D-257)", () => {
  const tz = "America/Chicago";
  const night = "2026-11-14";
  const at9pm = (title: string, styles: string[] = [], evidenceText?: string | null) => ({
    title,
    styles,
    startsAt: new Date("2026-11-14T21:00:00-06:00"),
    nightDate: night,
    tz,
    evidenceText,
  });
  const mixed = { mixedCalendar: true, styles: [] };

  it("keeps 'Heatwave!' with dance words in evidence", () => {
    const result = screenNoDance(
      at9pm("Heatwave!", [], "all-vinyl oldies dance party on the second Saturday of every month"),
      mixed,
    );
    expect(result).toBeNull();
  });

  it("screens 'Heatwave!' with non-dance evidence", () => {
    const result = screenNoDance(at9pm("Heatwave!", [], "an evening of jazz standards"), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("screens 'Heatwave!' with seated show words in evidence", () => {
    const result = screenNoDance(at9pm("Heatwave!", [], "a dance theatre performance"), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("keeps 'RESURRECTION GOTH NIGHT' (goth night in title)", () => {
    const result = screenNoDance(at9pm("RESURRECTION GOTH NIGHT"), mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Darkwave Wednesdays' (darkwave in title)", () => {
    const result = screenNoDance(at9pm("Darkwave Wednesdays"), mixed);
    expect(result).toBeNull();
  });

  it("screens 'Heatwave!' with Ball & Chain in evidence (no dance word)", () => {
    const result = screenNoDance(at9pm("Heatwave!", [], "Live at Ball & Chain"), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  describe("screenEvidenceText", () => {
    it("skips venue, address, organizer, price, ticket, url keys", () => {
      const result = screenEvidenceText({
        venue: "Mid-City Dance Hall",
        listing_type: "concert",
        venue_address: "1 Main St",
        organizer_name: "John",
        price_general: "$10",
        ticket_url: "https://example.com",
        url: "https://example.com",
      });
      expect(result).toBe("concert");
    });

    it("returns null for empty evidence", () => {
      expect(screenEvidenceText({})).toBeNull();
      expect(screenEvidenceText(null)).toBeNull();
      expect(screenEvidenceText(undefined)).toBeNull();
    });

    it("joins remaining non-empty values", () => {
      const result = screenEvidenceText({
        styles: "salsa",
        listing_type: "social",
        extra: "  ",
        note: "fun",
      });
      expect(result).toBe("salsa social fun");
    });
  });
});
