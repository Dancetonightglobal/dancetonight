import { describe, expect, it } from "vitest";
import { itemListLinks } from "@/src/adapters/feeds/event-pages";

const PAGE = "https://feverup.com/en/barcelona/nightlife-clubs";
const list = (urls: string[]) => [
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: urls.map((url, i) => ({ position: i + 1, type: "ListItem", url })),
  },
];

describe("itemListLinks for Fever", () => {
  it("keeps Fever event pages", () => {
    const result = itemListLinks(
      list(["https://feverup.com/m/714987/en", "https://feverup.com/m/532594"]),
      PAGE,
    );
    expect(result).toEqual(["https://feverup.com/m/714987/en", "https://feverup.com/m/532594"]);
  });

  it("ignores BreadcrumbList", () => {
    const blocks = [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            item: { "@id": PAGE, name: "Nightlife" },
          },
        ],
      },
    ];
    const result = itemListLinks(blocks, PAGE);
    expect(result).toEqual([]);
  });

  it("rejects /m/123/en on non-Fever host", () => {
    const result = itemListLinks(
      list(["https://example.com/m/123/en"]),
      "https://example.com/list",
    );
    expect(result).toEqual([]);
  });

  it("rejects Fever non-event path", () => {
    const result = itemListLinks(list(["https://feverup.com/en/barcelona/venue/sala-apolo"]), PAGE);
    expect(result).toEqual([]);
  });

  it("still works with existing event paths", () => {
    const result = itemListLinks(
      list(["https://example.com/events/salsa-night"]),
      "https://example.com/list",
    );
    expect(result).toEqual(["https://example.com/events/salsa-night"]);
  });
});
