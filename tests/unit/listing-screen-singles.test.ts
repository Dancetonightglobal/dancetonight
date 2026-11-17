import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

describe("screenTitle singles mixers and speed dating", () => {
  it("screens singles mixers and speed dating that name no dance", () => {
    for (const title of [
      "HALLOWEEN SOLTEROS ( +35 años )",
      "Speed Dating Night 30-45",
      "Citas Rápidas para Solteros",
      "Singles Mixer at The Rooftop",
    ]) {
      expect(screenTitle(title)).toEqual({
        kind: "not_dance_scope",
        reason: "a singles mixer or speed dating that names no dance",
      });
    }
  });

  it("keeps singles events that name a dance", () => {
    for (const title of [
      "La Noche Latina - para solteros en CDMX",
      "Salsa Speed Dating & Social",
      "Singles Dance Party",
      "Bachata para solteros",
      "Fiesta de Solteros",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("still screens karaoke as before", () => {
    expect(screenTitle("KARAOKE NIGHT")?.kind).toBe("not_dance_scope");
  });
});
