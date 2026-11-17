import { describe, expect, it } from "vitest";

import { addressForGeocoder } from "@/src/pipeline/geocode";
import { looksLikeStreetAddress } from "@/src/pipeline/normalize";

describe("addressForGeocoder", () => {
  it("removes parenthesised parts", () => {
    expect(addressForGeocoder("121 West 45 (between Broadway and 6th Ave)")).toBe("121 West 45");
  });

  it("drops everything before a house number preceded by separator", () => {
    expect(addressForGeocoder("Backroom – 506 Fifth Avenue, Brooklyn")).toBe(
      "506 Fifth Avenue, Brooklyn",
    );
    expect(
      addressForGeocoder(
        "Puerto Plata – Queens, 7516 Rockaway Blvd, Queens, NY, 11421, United States",
      ),
    ).toBe("7516 Rockaway Blvd, Queens, NY, 11421");
    expect(addressForGeocoder("481 8th Ave NY, in the basement")).toBe("481 8th Ave NY");
  });

  it("removes trailing country suffixes", () => {
    expect(addressForGeocoder("3608 33rd Street, Queens, New York 11106, United States")).toBe(
      "3608 33rd Street, Queens, NY 11106",
    );
    expect(addressForGeocoder("123 Main St, USA")).toBe("123 Main St");
    expect(addressForGeocoder("456 Oak Ave, US")).toBe("456 Oak Ave");
  });

  it("drops lowercase parts without digits or capitals", () => {
    expect(addressForGeocoder("481 8th Ave NY, in the basement")).toBe("481 8th Ave NY");
    // Additional test: part with lowercase but contains digit should be kept
    expect(addressForGeocoder("123 Main St, lower 5th")).toBe("123 Main St, lower 5th");
  });

  it("leaves normal addresses unchanged", () => {
    expect(addressForGeocoder("239 W 14th St")).toBe("239 W 14th St");
    expect(addressForGeocoder("37 W 26th St, New York")).toBe("37 W 26th St, New York");
  });

  it("collapses whitespace and commas", () => {
    expect(addressForGeocoder("123   Main   St,  ,  Brooklyn")).toBe("123 Main St, Brooklyn");
  });

  it("keeps hyphenated house numbers (Queens style)", () => {
    expect(addressForGeocoder("52-19 Flushing Ave, Queens, NY 11378, USA")).toBe(
      "52-19 Flushing Ave, Queens, NY 11378",
    );
    expect(addressForGeocoder("Knockdown Center - 52-19 Flushing Ave, Maspeth, NY 11378")).toBe(
      "52-19 Flushing Ave, Maspeth, NY 11378",
    );
    expect(addressForGeocoder("59-01 Fresh Pond Rd, Queens, NY 11378")).toBe(
      "59-01 Fresh Pond Rd, Queens, NY 11378",
    );
    expect(addressForGeocoder("11-01 43rd Ave, Long Island City, NY 11101")).toBe(
      "11-01 43rd Ave, Long Island City, NY 11101",
    );
  });

  it("drops consecutive identical address parts", () => {
    expect(
      addressForGeocoder(
        "31 Chambers St, 31 Chambers St, New York City, New York 10007, United States",
      ),
    ).toBe("31 Chambers St, New York City, NY 10007");
  });
});

describe("addressForGeocoder: a European postcode is not a house number (D-254)", () => {
  it("keeps the street before a postcode and town", () => {
    expect(addressForGeocoder("Avenida da Índia 52, 1300-299 Lisboa")).toBe(
      "Avenida da Índia 52, 1300-299 Lisboa",
    );
    expect(addressForGeocoder("Praça Do Comércio, 1100-148 Lisbon, Lisbon, Portugal")).toBe(
      "Praça Do Comércio, 1100-148 Lisbon, Lisbon, Portugal",
    );
    expect(addressForGeocoder("R. Rodrigues de Faria 103, 1300 Lisboa, Portugal")).toBe(
      "R. Rodrigues de Faria 103, 1300 Lisboa, Portugal",
    );
    expect(addressForGeocoder("Carrer de Pujades, 63, 08005 Barcelona")).toBe(
      "Carrer de Pujades, 63, 08005 Barcelona",
    );
  });

  it("still drops a venue name before a US house number", () => {
    expect(addressForGeocoder("Blue Nile, 532 Frenchmen St, New Orleans, LA 70116")).toBe(
      "532 Frenchmen St, New Orleans, LA 70116",
    );
    expect(addressForGeocoder("The Venue, 10100 Main St, Austin, TX 78701")).toBe(
      "10100 Main St, Austin, TX 78701",
    );
  });
});

describe("addressForGeocoder step 7: state abbreviation before ZIP", () => {
  it("replaces New York with NY when followed by ZIP", () => {
    expect(addressForGeocoder("11-01 43rd Avenue, Queens, New York 11101")).toBe(
      "11-01 43rd Avenue, Queens, NY 11101",
    );
    expect(addressForGeocoder("10 Theater Alley, New York City, New York 10038")).toBe(
      "10 Theater Alley, New York City, NY 10038",
    );
  });
  it("replaces New Jersey with NJ when followed by ZIP", () => {
    expect(addressForGeocoder("986 River Rd, Edgewater, New Jersey 07020")).toBe(
      "986 River Rd, Edgewater, NJ 07020",
    );
  });
  it("leaves spelled-out state unchanged when no ZIP follows", () => {
    expect(addressForGeocoder("37 W 26th St, New York")).toBe("37 W 26th St, New York");
  });
  it("does not break addresses that already have NY", () => {
    expect(addressForGeocoder("New Yorker Hotel, 481 8th Ave, New York, NY 10001")).toBe(
      "New Yorker Hotel, 481 8th Ave, New York, NY 10001",
    );
  });
});

describe("addressForGeocoder step 8: house-number range reduction", () => {
  it("reduces range to first number for non-Queens ZIP", () => {
    expect(addressForGeocoder("55-57 N 9th St Brooklyn, NY 11249")).toBe(
      "55 N 9th St Brooklyn, NY 11249",
    );
  });
  it("keeps range for Queens ZIP", () => {
    expect(addressForGeocoder("21-34 44th Rd, Long Island City, NY 11101")).toBe(
      "21-34 44th Rd, Long Island City, NY 11101",
    );
    expect(addressForGeocoder("52-19 Flushing Ave, Queens, NY 11378")).toBe(
      "52-19 Flushing Ave, Queens, NY 11378",
    );
  });
  it("leaves range unchanged when no ZIP present", () => {
    expect(addressForGeocoder("55-57 N 9th St, Brooklyn")).toBe("55-57 N 9th St, Brooklyn");
  });
});

describe("looksLikeStreetAddress", () => {
  it("returns true for strings that start with house number and contain comma", () => {
    expect(looksLikeStreetAddress("118 Ridge Avenue, Park Ridge, NJ 07656")).toBe(true);
    expect(looksLikeStreetAddress("986 River Rd STE 2, Edgewater, NJ 07020")).toBe(true);
    expect(looksLikeStreetAddress("3608 33rd Street, Queens, New York 11106")).toBe(true);
  });

  it("returns false for venue names without comma", () => {
    expect(looksLikeStreetAddress("Paramus Firehouse")).toBe(false);
    expect(looksLikeStreetAddress("Main Space")).toBe(false);
    expect(looksLikeStreetAddress("Oct 15")).toBe(false);
    expect(looksLikeStreetAddress("1 Oak")).toBe(false); // no comma
  });

  it("returns false for strings without house number pattern", () => {
    expect(looksLikeStreetAddress("Main Street, Park Ridge")).toBe(false); // no digits at start
    expect(looksLikeStreetAddress("Avenue of the Americas, New York")).toBe(false);
  });
});
