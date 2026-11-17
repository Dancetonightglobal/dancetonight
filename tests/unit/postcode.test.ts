import { describe, expect, it } from "vitest";
import { hasPostcode, postcodeWord, postcodeOf } from "@/src/domain/postcode";

describe("hasPostcode", () => {
  describe("GB", () => {
    it("returns true for full UK postcodes", () => {
      expect(hasPostcode("1 Islington High St, London N1 9GU", "GB")).toBe(true);
      expect(hasPostcode("Buckingham Palace, London SW1A 1AA", "GB")).toBe(true);
      expect(hasPostcode("77a Charterhouse St, London EC1M 6HJ", "GB")).toBe(true);
      expect(hasPostcode("ec1m 6hj", "GB")).toBe(true);
      expect(hasPostcode("London E1 6AN, UK", "GB")).toBe(true);
      expect(hasPostcode("GIR 0AA", "GB")).toBe(true);
      expect(hasPostcode("N19GU", "GB")).toBe(true);
    });

    it("returns false for outward code only", () => {
      expect(hasPostcode("London N1", "GB")).toBe(false);
      expect(hasPostcode("SW1A", "GB")).toBe(false);
      expect(hasPostcode("Hackney, London", "GB")).toBe(false);
      expect(hasPostcode("123 Street, City", "GB")).toBe(false);
      expect(hasPostcode("Brooklyn, NY 11218", "GB")).toBe(false);
    });
  });

  describe("US (and other non-GB)", () => {
    it("returns true for 5-digit ZIP", () => {
      expect(hasPostcode("1016 Beverley Rd, Brooklyn, NY 11218", "US")).toBe(true);
      expect(hasPostcode("Seattle, WA 98101", "US")).toBe(true);
      expect(hasPostcode("12345", "US")).toBe(true);
    });

    it("returns false for non-ZIP", () => {
      expect(hasPostcode("London N1 9GU", "US")).toBe(false);
      expect(hasPostcode("Brooklyn, NY", "US")).toBe(false);
      expect(hasPostcode("1234", "US")).toBe(false);
      expect(hasPostcode("123456", "US")).toBe(false);
    });
  });

  describe("PT, BR and AR postcodes (D-231)", () => {
    describe("Portugal (PT)", () => {
      it("matches 4-3 format", () => {
        expect(hasPostcode("Rua X 12, 1100-148 Lisboa", "PT")).toBe(true);
        expect(postcodeOf("Rua X 12, 1100-148 Lisboa", "PT")).toBe("1100-148");
      });
      it("does not match 4 digits alone", () => {
        expect(hasPostcode("1100", "PT")).toBe(false);
      });
      it('uses word "postcode"', () => {
        expect(postcodeWord("PT")).toBe("postcode");
      });
    });

    describe("Brazil (BR)", () => {
      it("matches hyphenated 5-3", () => {
        expect(hasPostcode("22050-002", "BR")).toBe(true);
        expect(postcodeOf("22050-002", "BR")).toBe("22050002");
      });
      it("matches unhyphenated 8 digits", () => {
        expect(hasPostcode("22050002", "BR")).toBe(true);
        expect(postcodeOf("22050002", "BR")).toBe("22050002");
      });
      it("does not match 9+ digits", () => {
        expect(hasPostcode("22050-0021", "BR")).toBe(false);
        expect(hasPostcode("220500021", "BR")).toBe(false);
      });
      it('uses word "CEP"', () => {
        expect(postcodeWord("BR")).toBe("CEP");
      });
    });

    describe("Argentina (AR)", () => {
      it("matches CPA format", () => {
        expect(hasPostcode("C1414ABC", "AR")).toBe(true);
        expect(postcodeOf("C1414ABC", "AR")).toBe("C1414ABC");
        expect(hasPostcode("c1414abc", "AR")).toBe(true);
        expect(postcodeOf("c1414abc", "AR")).toBe("C1414ABC");
      });
      it("matches letter + 4 digits", () => {
        expect(hasPostcode("C1414", "AR")).toBe(true);
        expect(postcodeOf("C1414", "AR")).toBe("C1414");
      });
      it("matches C.P. 1414 variants", () => {
        expect(hasPostcode("C.P. 1414", "AR")).toBe(true);
        expect(postcodeOf("C.P. 1414", "AR")).toBe("1414");
        expect(hasPostcode("CP 1414", "AR")).toBe(true);
        expect(postcodeOf("CP 1414", "AR")).toBe("1414");
        expect(hasPostcode("C.P.1414", "AR")).toBe(true);
        expect(postcodeOf("C.P.1414", "AR")).toBe("1414");
      });
      it("matches (1414)", () => {
        expect(postcodeOf("Av. Corrientes 1414 (1043) Buenos Aires", "AR")).toBe("1043");
        expect(hasPostcode("(1414)", "AR")).toBe(true);
        expect(postcodeOf("(1414)", "AR")).toBe("1414");
      });
      it("does not match bare 4-digit street number", () => {
        expect(hasPostcode("Av. Corrientes 1414", "AR")).toBe(false);
      });
      it('uses word "postcode"', () => {
        expect(postcodeWord("AR")).toBe("postcode");
      });
    });
  });

  describe("Colombia (CO), D-640", () => {
    it("returns true for plate with Medellín area town", () => {
      expect(hasPostcode("Cra 43A # 10-50, El Poblado, Medellín", "CO")).toBe(true);
      expect(hasPostcode("Calle 53 #42-55, Medellín", "CO")).toBe(true);
      expect(hasPostcode("Carrera 70 No. 44B-10, Laureles", "CO")).toBe(true);
      expect(hasPostcode("Cra. 73 # 44 - 56, Medellin, Antioquia", "CO")).toBe(true);
      expect(hasPostcode("Cl 10 Sur # 50FF-28, Medellín", "CO")).toBe(true);
      expect(hasPostcode("Carrera 48 # 50 Sur-128, Envigado", "CO")).toBe(true);
      expect(hasPostcode("Calle 75 Sur # 43A-50, Sabaneta", "CO")).toBe(true);
      expect(hasPostcode("Diagonal 64C # 32-15, Bello", "CO")).toBe(true);
      expect(hasPostcode("Tv 39B # 75-50, Itagüí", "CO")).toBe(true);
      expect(hasPostcode("Calle 50, Medellín 050012", "CO")).toBe(true);
    });

    it("returns false when missing plate or town", () => {
      expect(hasPostcode("Cra 43A # 10-50", "CO")).toBe(false);
      expect(hasPostcode("Parque Lleras, Medellín", "CO")).toBe(false);
      expect(hasPostcode("Calle 85 # 11-53, Bogotá", "CO")).toBe(false);
      expect(hasPostcode("Calle 53, Medellín", "CO")).toBe(false);
      expect(hasPostcode("Medellín, Antioquia", "CO")).toBe(false);
      expect(hasPostcode("", "CO")).toBe(false);
    });

    it("extracts postcode when present", () => {
      expect(postcodeOf("Cra 43A # 10-50, Medellín 050021", "CO")).toBe("050021");
      expect(postcodeOf("Calle 53 #42-55, Medellín", "CO")).toBe(null);
    });

    it('uses word "postcode"', () => {
      expect(postcodeWord("CO")).toBe("postcode");
    });

    it("does not affect other countries", () => {
      expect(hasPostcode("Calle 53 #42-55, Medellín", "US")).toBe(false);
    });

    it("accepts a letter after the last number and Unicode dashes (2026-10-31)", () => {
      // Letter after last number
      expect(hasPostcode("Calle 9 Sur #47-2A, El Poblado, Medellín, Colombia", "CO")).toBe(true);
      expect(hasPostcode("Cra 43 # 10-2 B, Medellín", "CO")).toBe(true);
      // Unicode dash U+2011 (non-breaking hyphen)
      expect(hasPostcode("Carrera 35 #8A‑30, Barrio Provenza, Medellín", "CO")).toBe(true);
      // Unicode dash U+2013 (en dash)
      expect(hasPostcode("Carrera 69 #43–55, Laureles, Medellín", "CO")).toBe(true);
      // Unicode dash U+2014 (em dash)
      expect(hasPostcode("Calle 10 #40—20, Envigado", "CO")).toBe(true);
      // Missing town
      expect(hasPostcode("Calle 9 Sur #47-2A", "CO")).toBe(false);
      // Bogotá is not a metro town
      expect(hasPostcode("Calle 9 Sur #47-2AB, Bogotá", "CO")).toBe(false);
      expect(hasPostcode("Carrera 35 #8A‑30, Bogotá", "CO")).toBe(false);
    });
  });

  describe("Puerto Rico without ZIP (D-262)", () => {
    it("returns true for house number and street in San Juan metro ending in PR", () => {
      expect(hasPostcode("148 Calle San Sebastián, Viejo San Juan, San Juan, PR", "US")).toBe(true);
      expect(hasPostcode("#54 Ave. Paraná, San Juan, PR", "US")).toBe(true);
      expect(hasPostcode("1348 Calle Orbeta, San Juan, PR", "US")).toBe(true);
    });
    it("returns false for highway without house number before street word", () => {
      expect(hasPostcode("PR-169, Guaynabo, PR", "US")).toBe(false);
    });
    it("returns false for no number", () => {
      expect(hasPostcode("Rincón, PR", "US")).toBe(false);
    });
    it("returns false for non-PR US address", () => {
      expect(hasPostcode("123 Main St, New York, NY", "US")).toBe(false);
    });
    it("returns true when ZIP present (unchanged)", () => {
      expect(hasPostcode("771 C. 1, Marginal Kennedy San Juan, PR 00920", "US")).toBe(true);
    });
  });

  describe("Other countries remain unchanged", () => {
    it("ES (Spain) uses 5-digit rule", () => {
      expect(hasPostcode("Carrer de Mallorca 401, 08013 Barcelona", "ES")).toBe(true);
      expect(postcodeOf("Carrer de Mallorca 401, 08013 Barcelona", "ES")).toBe("08013");
    });
    it("MX (Mexico) uses 5-digit rule", () => {
      expect(hasPostcode("Col. Roma Nte., 06700 CDMX", "MX")).toBe(true);
      expect(postcodeOf("Col. Roma Nte., 06700 CDMX", "MX")).toBe("06700");
    });
    it("US still works", () => {
      expect(hasPostcode("1016 Beverley Rd, Brooklyn, NY 11218", "US")).toBe(true);
      expect(postcodeOf("1016 Beverley Rd, Brooklyn, NY 11218", "US")).toBe("11218");
    });
    it("GB still works", () => {
      expect(hasPostcode("London N1 9GU", "GB")).toBe(true);
      expect(postcodeOf("London N1 9GU", "GB")).toBe("N19GU");
    });
  });

  describe("AR street addresses in CABA (D-236)", () => {
    it("returns true for street+number with CABA word", () => {
      expect(hasPostcode("Agrelo 3399 - CABA", "AR")).toBe(true);
      expect(hasPostcode("Riobamba 416, CABA", "AR")).toBe(true);
      expect(hasPostcode("Avenida Córdoba 5064, Ciudad Autónoma de Buenos Aires", "AR")).toBe(true);
      expect(hasPostcode("Humberto Primo 1783, C.A.B.A.", "AR")).toBe(true);
      expect(hasPostcode("Av. Corrientes 1414, Capital Federal", "AR")).toBe(true);
      expect(hasPostcode("Alberdi 436, 1 piso, CABA", "AR")).toBe(true);
    });

    it("returns false when missing street+number or CABA word", () => {
      expect(hasPostcode("CABA", "AR")).toBe(false);
      expect(hasPostcode("Agrelo 3399", "AR")).toBe(false);
      expect(hasPostcode("Agrelo 3399, Olivos", "AR")).toBe(false);
      expect(hasPostcode("Palermo, CABA", "AR")).toBe(false);
    });

    it("does not affect postcodeOf", () => {
      expect(postcodeOf("Agrelo 3399 - CABA", "AR")).toBe(null);
    });

    it("does not affect other countries", () => {
      expect(hasPostcode("Agrelo 3399 - CABA", "US")).toBe(false);
    });
  });

  describe("ES and PT street and number in the core city (D-258)", () => {
    it("ES: street+number with Barcelona word returns true", () => {
      expect(hasPostcode("C/ de Llança, 5, Barcelona, CT, Barcelona, CT, es", "ES")).toBe(true);
      expect(
        hasPostcode("Carrer de Francisco Giner, 32, Barcelona, CT, Barcelona, CT, es", "ES"),
      ).toBe(true);
    });
    it("ES: no house number returns false", () => {
      expect(hasPostcode("Ciutadella Park, Barcelona, Barcelona, es", "ES")).toBe(false);
    });
    it("ES: no city word returns false", () => {
      expect(hasPostcode("C/ Montmell, s/n, Torredembarra, Tarragona, Espanya", "ES")).toBe(false);
      expect(hasPostcode("Carrer Major 12, Badalona", "ES")).toBe(false);
    });
    it("ES: postcode present returns true (unchanged)", () => {
      expect(hasPostcode("Carrer de Pujades 100, 08005 Barcelona", "ES")).toBe(true);
    });
    it("PT: street+number with Lisboa/Lisbon returns true", () => {
      expect(hasPostcode("Rua da Rosa 261, Lisboa", "PT")).toBe(true);
    });
    it("PT: street without number returns false", () => {
      expect(hasPostcode("Rua da Rosa, Lisboa", "PT")).toBe(false);
    });
    it("US: unchanged (no city word)", () => {
      expect(hasPostcode("123 Main St, New York, NY", "US")).toBe(false);
    });
    it("MX: unchanged (no city word)", () => {
      expect(hasPostcode("Calle Morelos 5, Ciudad de México", "MX")).toBe(false);
    });
  });
});

describe("postcodeWord", () => {
  it('returns "postcode" for GB', () => {
    expect(postcodeWord("GB")).toBe("postcode");
  });

  it('returns "ZIP" for US and any other country', () => {
    expect(postcodeWord("US")).toBe("ZIP");
    expect(postcodeWord("CA")).toBe("ZIP");
    expect(postcodeWord("DE")).toBe("ZIP");
    expect(postcodeWord("FR")).toBe("ZIP");
  });

  it('returns "postcode" for PT and AR', () => {
    expect(postcodeWord("PT")).toBe("postcode");
    expect(postcodeWord("AR")).toBe("postcode");
  });

  it('returns "CEP" for BR', () => {
    expect(postcodeWord("BR")).toBe("CEP");
  });
});
