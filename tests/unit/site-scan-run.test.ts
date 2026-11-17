import { describe, expect, test } from "vitest";
import { titleWordShare } from "@/src/jobs/site-scan";

describe("titleWordShare", () => {
  test("all words present -> 1", () => {
    const title = "Salsa Night Party";
    const html = "<html><body>Welcome to salsa night party!</body></html>";
    expect(titleWordShare(title, html)).toBe(1);
  });

  test("Salsa Arriba vs page containing salsa only -> 0.5", () => {
    const title = "Salsa Arriba";
    const html = "<p>salsa dancing</p>";
    expect(titleWordShare(title, html)).toBe(0.5);
  });

  test("accents (Último Embrasa vs <p>ultimo EMBRASA</p>) -> 1", () => {
    const title = "Último Embrasa";
    const html = "<p>ultimo EMBRASA</p>";
    expect(titleWordShare(title, html)).toBe(1);
  });

  test("words inside <script> do not count", () => {
    const title = "Secret Dance";
    const html = "<script>const dance = 'secret';</script><p>other text</p>";
    expect(titleWordShare(title, html)).toBe(0);
  });

  test("title of only short words (DJ @ 9) -> 1", () => {
    const title = "DJ @ 9";
    const html = "<p>anything</p>";
    expect(titleWordShare(title, html)).toBe(1);
  });

  test("whole words only (Salsa vs Salsabil) -> 0", () => {
    const title = "Salsa";
    const html = "<p>salsabil event</p>";
    expect(titleWordShare(title, html)).toBe(0);
  });

  test("normalizes accents and case", () => {
    const title = "Café Mambo";
    const html = "<p>CAFE mambo</p>";
    expect(titleWordShare(title, html)).toBe(1);
  });

  test("handles empty title", () => {
    const title = "";
    const html = "<p>test</p>";
    expect(titleWordShare(title, html)).toBe(1);
  });

  test("handles title with only non-word characters", () => {
    const title = "@#$%";
    const html = "<p>test</p>";
    expect(titleWordShare(title, html)).toBe(1);
  });

  test("Мумбаи Party vs <p>мумбаи party</p> -> 1", () => {
    const title = "Мумбаи Party";
    const html = "<p>мумбаи party</p>";
    expect(titleWordShare(title, html)).toBe(1);
  });
});
