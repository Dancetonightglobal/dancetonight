import { describe, it, expect } from "vitest";
import { parsePlace } from "@/src/adapters/apis/agendadeltango";

describe("parsePlace", () => {
  it("handles street address only: C/ Pallars, 74 Barcelona", () => {
    const result = parsePlace("C/ Pallars, 74 Barcelona");
    expect(result.name).toBeNull();
    expect(result.street).toBe("C/ Pallars, 74");
    // The existing town extraction logic will extract "Barcelona" from the text
    expect(result.town).toBe("Barcelona");
  });

  it("handles street address with house number variant: Carrer de Sants, 12B (Barcelona)", () => {
    const result = parsePlace("Carrer de Sants, 12B (Barcelona)");
    expect(result.name).toBeNull();
    expect(result.street).toBe("Carrer de Sants, 12B");
    expect(result.town).toBe("Barcelona");
  });

  it("keeps venue name when street prefix but house number not present: C/ Pallars, local 2 (Barcelona)", () => {
    const result = parsePlace("C/ Pallars, local 2 (Barcelona)");
    expect(result.name).toBe("C/ Pallars");
    expect(result.street).toBe("local 2");
    expect(result.town).toBe("Barcelona");
  });

  it("keeps venue name when no street prefix: Centre Cívic, 74 (Barcelona)", () => {
    const result = parsePlace("Centre Cívic, 74 (Barcelona)");
    expect(result.name).toBe("Centre Cívic");
    expect(result.street).toBe("74");
    expect(result.town).toBe("Barcelona");
  });

  it("handles venue name with street address: La Paloma, C/ Tigre 27 (Barcelona)", () => {
    const result = parsePlace("La Paloma, C/ Tigre 27 (Barcelona)");
    // Note: The existing code splits at first comma, so name becomes "La Paloma", street "C/ Tigre 27"
    // This is correct and should remain unchanged
    expect(result.name).toBe("La Paloma");
    expect(result.street).toBe("C/ Tigre 27");
    expect(result.town).toBe("Barcelona");
  });

  it("handles null input", () => {
    const result = parsePlace(null);
    expect(result.name).toBeNull();
    expect(result.street).toBeNull();
    expect(result.town).toBeNull();
  });

  it("handles address with range house number: Av. Diagonal, 10-12 Barcelona", () => {
    const result = parsePlace("Av. Diagonal, 10-12 Barcelona");
    expect(result.name).toBeNull();
    expect(result.street).toBe("Av. Diagonal, 10-12");
    expect(result.town).toBe("Barcelona");
  });

  it("handles address with suffix letter: C/ Sants, 12B Barcelona", () => {
    const result = parsePlace("C/ Sants, 12B Barcelona");
    expect(result.name).toBeNull();
    expect(result.street).toBe("C/ Sants, 12B");
    expect(result.town).toBe("Barcelona");
  });

  it("does not modify when street prefix but house number pattern not matched: C/ Sants, local B", () => {
    const result = parsePlace("C/ Sants, local B");
    expect(result.name).toBe("C/ Sants");
    expect(result.street).toBe("local B");
    expect(result.town).toBeNull(); // No town in parentheses or trailing
  });
});
