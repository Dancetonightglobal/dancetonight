// Tests for the new cities' ticket platforms and listing hubs (D-495)
import { describe, expect, it } from "vitest";
import { ownSite, isHubSite } from "@/src/domain/dedupe";

describe("new cities' platforms and hubs", () => {
  describe("PLATFORM_SITES", () => {
    it("returns null for new platform sites", () => {
      expect(ownSite("https://www.passline.com/eventos/x")).toBeNull();
      expect(ownSite("https://feverup.com/m/714987")).toBeNull();
      expect(ownSite("https://venti.live/e/1")).toBeNull();
      expect(ownSite("https://www.boletia.com/e/x")).toBeNull();
      expect(ownSite("https://sabaki.dance/e/1")).toBeNull();
      expect(ownSite("https://www.viralagenda.com/pt/p/x")).toBeNull();
      expect(ownSite("https://xceed.me/en/barcelona/event/x")).toBeNull();
      expect(ownSite("https://www.skiddle.com/whats-on/x")).toBeNull();
      expect(ownSite("https://alpogo.com/evento/x")).toBeNull();
      expect(ownSite("https://img.clubt.com.ar/customer/x")).toBeNull();
    });
  });

  describe("HUB_SITES", () => {
    it("recognizes new hub sites", () => {
      expect(isHubSite("cracovia32.com")).toBe(true);
      expect(isHubSite("ourphilly.org")).toBe(true);
      expect(isHubSite("ritmolibre.ar")).toBe(true);
      expect(isHubSite("salsavida.com")).toBe(true);
      expect(isHubSite("where-to-dance-salsa.com")).toBe(true);
      expect(isHubSite("wwoz.org")).toBe(true);
      expect(isHubSite("danceus.org")).toBe(true);
      for (const site of [
        "brandon.org.ar",
        "cckonex.org",
        "clubgricel.com.ar",
        "elbeso.com.ar",
        "lavirutatangoclub.com",
        "nicetoclub.com",
      ]) {
        expect(isHubSite(site)).toBe(true);
      }
    });
  });

  it("treats ma.to as a platform and tangomango.org as a hub (Miami, D-519 F2)", () => {
    expect(ownSite("https://ma.to/venue/zeyzeymiami")).toBeNull();
    expect(isHubSite("tangomango.org")).toBe(true);
  });

  it("treats mapadosamba.com.br as a hub (Rio, D-519 F2)", () => {
    expect(isHubSite("mapadosamba.com.br")).toBe(true);
  });

  it("treats viajandoybailando.com as a hub (San Juan, D-519 F2)", () => {
    expect(isHubSite("viajandoybailando.com")).toBe(true);
  });

  it("does not affect ordinary venue sites", () => {
    expect(ownSite("https://www.lustinrio.pt/x")).toBe("lustinrio.pt");
  });
});
