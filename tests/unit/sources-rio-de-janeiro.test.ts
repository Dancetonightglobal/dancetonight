// Rio de Janeiro's starting list keeps its own promises (D-420): one row per address, only
// http(s), no Resident Advisor pages (D-034), and no Facebook, Instagram or Shotgun
// (Sympla only through its public list pages, D-421).
import { describe, expect, it } from "vitest";

import { RIO_DE_JANEIRO_RETIRED, RIO_DE_JANEIRO_SOURCES } from "@/config/sources/rio-de-janeiro";
import { STYLES } from "@/config/styles";

const listed = RIO_DE_JANEIRO_SOURCES.map((seed) => seed.url);
const retired = RIO_DE_JANEIRO_RETIRED.map((gone) => gone.url);

describe("Rio de Janeiro's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of RIO_DE_JANEIRO_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("stays off Resident Advisor (ra.co, residentadvisor.net) and its mirrors, Facebook, Instagram and Shotgun", () => {
    for (const seed of RIO_DE_JANEIRO_SOURCES) {
      const urlHost = new URL(seed.url).hostname;
      expect(urlHost).not.toMatch(/(\.|^)ra\.co$/);
      expect(urlHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
      expect(urlHost).not.toMatch(/(\.|^)facebook\.com$/);
      expect(urlHost).not.toMatch(/(\.|^)instagram\.com$/);
      expect(urlHost).not.toMatch(/(\.|^)technoairlines\.com$/);
      expect(urlHost).not.toMatch(/(\.|^)shotgun\.live$/);
      if (seed.feedUrl) {
        const feedHost = new URL(seed.feedUrl).hostname;
        expect(feedHost).not.toMatch(/(\.|^)ra\.co$/);
        expect(feedHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
        expect(feedHost).not.toMatch(/(\.|^)facebook\.com$/);
        expect(feedHost).not.toMatch(/(\.|^)instagram\.com$/);
        expect(feedHost).not.toMatch(/(\.|^)technoairlines\.com$/);
        expect(feedHost).not.toMatch(/(\.|^)shotgun\.live$/);
      }
    }
  });

  it("reads Sympla only through its city, today and week lists, with the Sympla reader, as a mixed ticketing calendar (D-421)", () => {
    const sympla = RIO_DE_JANEIRO_SOURCES.filter((seed) =>
      /(\.|^)sympla\.com\.br$/.test(new URL(seed.url).hostname),
    );
    expect(sympla.map((seed) => seed.url)).toEqual([
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=4",
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=9",
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=14",
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=19",
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/esta-semana",
      "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/proxima-semana",
    ]);
    for (const seed of sympla) {
      expect(seed.kind).toBe("jsonld");
      expect(seed.platform).toBe("sympla");
      expect(seed.mixedCalendar).toBe(true);
      expect(seed.trustTier).toBe("ticketing");
    }
  });

  it("retires the per-page Sympla sources folded into the two lists (D-259)", () => {
    const retiredSympla = RIO_DE_JANEIRO_RETIRED.filter((gone) =>
      /(\.|^)sympla\.com\.br$/.test(new URL(gone.url).hostname),
    );
    expect(retiredSympla).toHaveLength(6);
    for (const gone of retiredSympla) {
      expect(gone.reason).toContain("D-259");
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of RIO_DE_JANEIRO_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Salsa Vida Rio de Janeiro as a directory", () => {
    const salsaVida = RIO_DE_JANEIRO_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/brazil/rio-de-janeiro/",
    );
    expect(salsaVida).toBeDefined();
    expect(salsaVida?.trustTier).toBe("directory");
  });

  it("reads Carioca da Gema as a first-party venue page with address", () => {
    const carioca = RIO_DE_JANEIRO_SOURCES.find(
      (s) => s.url === "https://www.barcariocadagema.com.br/shows",
    );
    expect(carioca).toBeDefined();
    expect(carioca?.trustTier).toBe("first_party");
    expect(carioca?.platform).toBe("wix_events");
    expect(carioca?.venuePage).toBe(true);
    expect(carioca?.onlyHere).toBe(true);
    expect(carioca?.venueAddress).toContain("20230-150");
  });

  it("screens the checked Sympla classes and concert on every Sympla list page (D-519 E1)", () => {
    const sympla = RIO_DE_JANEIRO_SOURCES.filter((seed) => seed.platform === "sympla");
    expect(sympla.length).toBeGreaterThan(0);
    for (const seed of sympla) {
      expect(seed.notDanceNights).toContain("Balé sem Rótulos (Novembro)");
      expect(seed.notDanceNights).toContain("Orquestra popular Manoel Congo: Concerto de 10 Anos");
    }
  });

  it("gives Samba do Trabalhador its stated Monday hours and no other roda house hours (D-519 C5)", () => {
    const trabalhador = RIO_DE_JANEIRO_SOURCES.find((seed) =>
      seed.url.endsWith("/roda/samba-do-trabalhador"),
    );
    expect(trabalhador?.houseHours).toMatchObject({ start: "16:30", end: "21:45", days: [1] });
    const bipBip = RIO_DE_JANEIRO_SOURCES.find((seed) => seed.url.endsWith("/roda/bip-bip"));
    expect(bipBip?.houseHours).toBeUndefined();
  });

  it("reads Rosa Valgode's three 5Rhythms class pages (D-523)", () => {
    const fiveRhythms = RIO_DE_JANEIRO_SOURCES.filter((seed) =>
      seed.url.startsWith("https://www.5rhythms.com/classes/"),
    );
    expect(fiveRhythms).toHaveLength(3);
    for (const seed of fiveRhythms) {
      expect(seed.styles).toEqual(["five_rhythms"]);
    }
  });
});
