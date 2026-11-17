import { describe, expect, it } from "vitest";

import { wixDatedEventLinks } from "@/src/adapters/feeds/event-pages";
import { eventPageLinks } from "@/src/adapters/feeds/jsonld-items";

const WIX_HTML = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://static.parastorage.com/x.js"></script>
</head>
<body>
  <a href="https://www.rocknbowl.com/events/latin-night-10-31-26">Latin Night</a>
  <a href="https://www.rocknbowl.com/events/geno-delafose-french-rockin-boogie-11-12-26-1">Geno</a>
  <a href="https://www.rocknbowl.com/events/latin-night-with-dj-nayo-2026-11-03-19-00">Latin with DJ</a>
  <a href="https://www.rocknbowl.com/events/bag-of-donuts-11-28-26&amp;quote=Check%20out%20this%20event.">Bag of Donuts</a>
  <!-- repeated links -->
  <a href="https://www.rocknbowl.com/events/latin-night-10-31-26">Latin Night again</a>
  <!-- non-matching paths -->
  <a href="https://www.rocknbowl.com/events/">Events root</a>
  <a href="https://www.rocknbowl.com/events/some-show">No date</a>
  <a href="https://www.rocknbowl.com/events/a/b-10-31-26">Two segments</a>
  <!-- other host -->
  <a href="https://other.com/events/x-10-31-26">Other host</a>
</body>
</html>
`;

const NON_WIX_HTML = `
<!DOCTYPE html>
<html>
<body>
  <a href="https://www.rocknbowl.com/events/latin-night-10-31-26">Latin Night</a>
</body>
</html>
`;

const BASE_URL = "https://www.rocknbowl.com/new-orleans";

describe("wixDatedEventLinks", () => {
  it("finds dated event links on Wix sites", () => {
    const links = wixDatedEventLinks(WIX_HTML, BASE_URL);
    expect(links).toEqual([
      "https://www.rocknbowl.com/events/latin-night-10-31-26",
      "https://www.rocknbowl.com/events/geno-delafose-french-rockin-boogie-11-12-26-1",
      "https://www.rocknbowl.com/events/latin-night-with-dj-nayo-2026-11-03-19-00",
      "https://www.rocknbowl.com/events/bag-of-donuts-11-28-26",
    ]);
  });

  it("returns empty for non-Wix sites", () => {
    const links = wixDatedEventLinks(NON_WIX_HTML, BASE_URL);
    expect(links).toEqual([]);
  });

  it("deduplicates and preserves first-seen order", () => {
    const html = `
      <script src="https://wixstatic.com/y.js"></script>
      <a href="https://www.rocknbowl.com/events/first-10-31-26">First</a>
      <a href="https://www.rocknbowl.com/events/second-11-01-26">Second</a>
      <a href="https://www.rocknbowl.com/events/first-10-31-26">First again</a>
    `;
    const links = wixDatedEventLinks(html, BASE_URL);
    expect(links).toEqual([
      "https://www.rocknbowl.com/events/first-10-31-26",
      "https://www.rocknbowl.com/events/second-11-01-26",
    ]);
  });
});

describe("eventPageLinks with wixDatedEventLinks", () => {
  it("includes dated event links from Wix pages", () => {
    const links = eventPageLinks(WIX_HTML, BASE_URL);
    expect(links).toContain("https://www.rocknbowl.com/events/latin-night-10-31-26");
    expect(links).toContain(
      "https://www.rocknbowl.com/events/geno-delafose-french-rockin-boogie-11-12-26-1",
    );
    expect(links).toContain(
      "https://www.rocknbowl.com/events/latin-night-with-dj-nayo-2026-11-03-19-00",
    );
    expect(links).toContain("https://www.rocknbowl.com/events/bag-of-donuts-11-28-26");
  });
});
