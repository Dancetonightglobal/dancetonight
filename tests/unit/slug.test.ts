import { describe, expect, it } from "vitest";
import { normalizeForMatch } from "@/config/styles";
import { slugFor, transliterateNonLatin } from "@/src/pipeline/slug";

function oldSlugFor(title: string, nightDate: string, id: string): string {
  const words = normalizeForMatch(title)
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join("-");
  return `${words || "listing"}-${nightDate}-${id.slice(0, 6)}`;
}

const NIGHT_DATE = "2026-11-05";
const ID = "ab12cd34-0000-0000-0000-000000000000";
const ID_SUFFIX = "ab12cd";

describe("slugFor", () => {
  describe("Latin titles equal oldSlugFor exactly", () => {
    const cases = [
      "Salsa Night at Café Olé",
      "🔥 Bachata Fridays 🔥",
      "Tango €10 & Milonga!",
      "Straße Fest",
      "Forró na Rua São José",
      "Ğece Kızılay",
      "ŁÓDŹ Swing",
      "Kizomba – Social (Late)",
      "Salsa 101: Beginners",
      "!!!",
      "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
    ];

    cases.forEach((title) => {
      it(`handles "${title.slice(0, 20)}..."`, () => {
        const newSlug = slugFor(title, NIGHT_DATE, ID);
        const oldSlug = oldSlugFor(title, NIGHT_DATE, ID);
        expect(newSlug).toBe(oldSlug);
      });
    });
  });

  it("Devanagari: slugFor('साल्सा नाइट', ...) does not start with listing-", () => {
    const slug = slugFor("साल्सा नाइट", NIGHT_DATE, ID);
    expect(slug).not.toMatch(/^listing-/);
    expect(slug).toMatch(/^[a-z0-9-]+-2026-11-05-ab12cd$/);
  });

  it("Mixed: slugFor('Bollywood नाइट', ...) starts with bollywood- and has 2 words before date", () => {
    const slug = slugFor("Bollywood नाइट", NIGHT_DATE, ID);
    expect(slug).toMatch(/^bollywood-[a-z0-9]+-2026-11-05-ab12cd$/);
    // Two words before the date: "bollywood" and the transliterated "naait".
    expect(slug.split("-").slice(0, -4)).toHaveLength(2);
  });

  describe("Various non-Latin scripts", () => {
    const scripts = [
      { title: "北京萨尔萨之夜", desc: "Chinese" },
      { title: "ซัลซ่า", desc: "Thai" },
      { title: "Сальса вечер", desc: "Cyrillic" },
      { title: "Σάλσα", desc: "Greek" },
      { title: "سالسا", desc: "Arabic" },
    ];

    scripts.forEach(({ title, desc }) => {
      it(`${desc}: "${title}"`, () => {
        const slug = slugFor(title, NIGHT_DATE, ID);
        expect(slug).not.toMatch(/^listing-/);
        expect(slug).toMatch(/^[a-z0-9-]+-2026-11-05-ab12cd$/);
      });
    });
  });

  it("Emoji-only '🔥🔥' still gives listing-...", () => {
    const slug = slugFor("🔥🔥", NIGHT_DATE, ID);
    expect(slug).toBe(`listing-${NIGHT_DATE}-${ID_SUFFIX}`);
  });

  it("transliterateNonLatin('Salsa 🔥 €') returns unchanged", () => {
    const result = transliterateNonLatin("Salsa 🔥 €");
    expect(result).toBe("Salsa 🔥 €");
  });
});
