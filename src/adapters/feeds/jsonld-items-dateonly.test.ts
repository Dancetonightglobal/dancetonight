import { describe, expect, it } from "vitest";
import { dateOnlyEventLinks, eventPageLinks } from "@/src/adapters/feeds/jsonld-items";
import { MAX_ITEM_PAGES } from "@/src/adapters/feeds/event-pages";
import { extractJsonLd } from "@/src/adapters/feeds/jsonld";

const BASE_URL = "https://allevents.in/mumbai/parties";

describe("dateOnlyEventLinks", () => {
  it("returns urls for date-only Events when no ItemList present", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Dark Bollywood Affair",
          "startDate": "2026-10-31",
          "url": "https://allevents.in/mumbai/the-dark-bollywood-affair/4100030940125449"
        }
      </script>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": "Another Party",
          "startDate": "2026-11-01",
          "url": "https://www.allevents.in/mumbai/another/123"
        }
      </script>
    `;
    const { blocks } = extractJsonLd(html);
    const links = dateOnlyEventLinks(blocks, BASE_URL);
    expect(links).toEqual([
      "https://allevents.in/mumbai/the-dark-bollywood-affair/4100030940125449",
      "https://www.allevents.in/mumbai/another/123",
    ]);
  });

  it("ignores Events with timed startDate", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "startDate": "2026-10-31T21:00:00+05:30",
          "url": "https://allevents.in/mumbai/timed/1"
        }
      </script>
    `;
    const { blocks } = extractJsonLd(html);
    const links = dateOnlyEventLinks(blocks, BASE_URL);
    expect(links).toEqual([]);
  });

  it("ignores Events with url on another host", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "startDate": "2026-10-31",
          "url": "https://other.example.com/e/1"
        }
      </script>
    `;
    const { blocks } = extractJsonLd(html);
    const links = dateOnlyEventLinks(blocks, BASE_URL);
    expect(links).toEqual([]);
  });

  it("returns [] when an ItemList is present", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          "itemListElement": []
        }
      </script>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "startDate": "2026-10-31",
          "url": "https://allevents.in/mumbai/should-be-ignored/1"
        }
      </script>
    `;
    const { blocks } = extractJsonLd(html);
    const links = dateOnlyEventLinks(blocks, BASE_URL);
    expect(links).toEqual([]);
  });

  it("deduplicates duplicate urls", () => {
    const html = `
      <script type="application/ld+json">
        [
          {
            "@context": "https://schema.org",
            "@type": "Event",
            "startDate": "2026-10-31",
            "url": "https://allevents.in/mumbai/duplicate/1"
          },
          {
            "@context": "https://schema.org",
            "@type": "Event",
            "startDate": "2026-10-31",
            "url": "https://allevents.in/mumbai/duplicate/1"
          }
        ]
      </script>
    `;
    const { blocks } = extractJsonLd(html);
    const links = dateOnlyEventLinks(blocks, BASE_URL);
    expect(links).toEqual(["https://allevents.in/mumbai/duplicate/1"]);
  });

  it("ignores Events without url", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "startDate": "2026-10-31"
        }
      </script>
    `;
    const { blocks } = extractJsonLd(html);
    const links = dateOnlyEventLinks(blocks, BASE_URL);
    expect(links).toEqual([]);
  });
});

describe("eventPageLinks with date-only Events", () => {
  it("includes date-only Event urls", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "startDate": "2026-10-31",
          "url": "https://allevents.in/mumbai/party1/1"
        }
      </script>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "startDate": "2026-11-01",
          "url": "https://allevents.in/mumbai/party2/2"
        }
      </script>
    `;
    const links = eventPageLinks(html, BASE_URL);
    expect(links).toContain("https://allevents.in/mumbai/party1/1");
    expect(links).toContain("https://allevents.in/mumbai/party2/2");
  });

  it("does not include timed startDate Event urls", () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Event",
          "startDate": "2026-10-31T21:00:00+05:30",
          "url": "https://allevents.in/mumbai/timed/1"
        }
      </script>
    `;
    const links = eventPageLinks(html, BASE_URL);
    expect(links).not.toContain("https://allevents.in/mumbai/timed/1");
  });

  it("returns many links (cap applied later)", () => {
    // Create 30 distinct date-only Events
    const events = Array.from({ length: 30 }, (_, i) => ({
      "@context": "https://schema.org",
      "@type": "Event",
      startDate: `2026-10-${String(i + 1).padStart(2, "0")}`,
      url: `https://allevents.in/mumbai/event-${i}/id`,
    }));
    const html = `
      <script type="application/ld+json">
        ${JSON.stringify(events)}
      </script>
    `;
    const links = eventPageLinks(html, BASE_URL);
    expect(links).toHaveLength(30);
    // Verify MAX_ITEM_PAGES is 25 (the cap is applied later by readItemPages)
    expect(MAX_ITEM_PAGES).toBe(25);
  });
});
