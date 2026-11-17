import { describe, expect, it } from "vitest";

import { cleanPageText } from "@/src/pipeline/clean";

// D-884: thevenicewest.com wraps its Webflow CMS event list in a Finsweet filter form
// (<form class="filter-form" method="get"> holding fs-cmsfilter-element="list" / w-dyn-list).
// Dropping every form dropped the cards, so their times never reached the card-time pass (D-276).

const URL = "https://venue.example/";

describe("cleanPageText: a form holding a CMS list (D-884)", () => {
  it("keeps the cards of a Webflow list inside a filter form, not the form's controls", () => {
    const html = [
      "<body><h1>Shows</h1>",
      '<form id="email-form" class="filter-form" method="get">',
      '<input type="text" name="q" placeholder="Search shows"/>',
      "<select><option>All genres</option></select>",
      "<button>Filter</button>",
      '<div fs-cmsfilter-element="list" class="w-dyn-list"><div class="w-dyn-items">',
      '<div class="w-dyn-item"><h3>Lissie w/ Harber Wynn</h3><p>Sunday Nov 15, 2026 starts 8:00 pm</p></div>',
      "</div></div>",
      "</form></body>",
    ].join("");
    const text = cleanPageText(html, URL);
    expect(text).toContain("Lissie w/ Harber Wynn");
    expect(text).toContain("starts 8:00 pm");
    expect(text).not.toContain("All genres");
    expect(text).not.toContain("Filter");
  });

  it("keeps a list marked only by w-dyn-list", () => {
    const html =
      '<form><div class="collection-list-wrapper w-dyn-list"><p>Salsa Social 9pm</p></div></form>';
    expect(cleanPageText(html, URL)).toContain("Salsa Social 9pm");
  });

  it("still drops an ordinary form with its content", () => {
    const html =
      "<p>Events below</p><form action='/subscribe'><label>Join our newsletter</label><input name='e'/></form><p>Tango Tuesday</p>";
    const text = cleanPageText(html, URL);
    expect(text).not.toContain("Join our newsletter");
    expect(text).toContain("Tango Tuesday");
  });

  it("drops a form whose class only resembles the marker", () => {
    const html = '<form><div class="w-dyn-list-empty-note">Sign up for alerts</div></form><p>x</p>';
    expect(cleanPageText(html, URL)).not.toContain("Sign up for alerts");
  });
});
