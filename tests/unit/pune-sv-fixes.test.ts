import { describe, expect, it } from "vitest";
import { eventPagePlace } from "@/src/adapters/feeds/jsonld";
import { matchStyles } from "@/config/styles";

// D-784: findings from Pune's first read (42436472311).
describe("Salsa Vida address parts with their own commas", () => {
  it("joins them with one comma", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "Pune Salsa Social",
      startDate: "2026-11-13T21:00",
      location: {
        "@type": "Place",
        name: "24K Kraft Brewzz",
        address: {
          "@type": "PostalAddress",
          streetAddress: "24K Kraft Brewzz, , Viman Nagar",
          addressLocality: "Lohegaon,",
          addressRegion: "Pune 411014,",
          addressCountry: "India",
        },
      },
    })}</script>`;
    const place = eventPagePlace(html);
    expect(place?.address).not.toContain(",,");
    expect(place?.address).toContain("Lohegaon, Pune 411014, India");
  });
});

describe("rumba as a party name", () => {
  it("does not make La Rumba or Mama Rumba ballroom", () => {
    expect(matchStyles("La Rumba").styles).not.toContain("rumba");
    expect(matchStyles("Mama Rumba Salsa Night").styles).not.toContain("rumba");
    expect(matchStyles("Mama Rumba Salsa Night").styles).toContain("salsa");
  });
  it("still reads the dance", () => {
    expect(matchStyles("Ballroom Rumba Class").styles).toContain("rumba");
    expect(matchStyles("Rumba and Cha Cha Social").styles).toContain("rumba");
  });
});
