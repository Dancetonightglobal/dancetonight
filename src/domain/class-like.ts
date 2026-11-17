/**
 * Whether a listing is a class, workshop, practice or similar (owner, 2026-10-18).
 * A class-like listing should not be merged with another listing under the same-times rule.
 */
import { normalizeForMatch } from "@/config/styles";

const CLASS_WORDS = new Set(
  [
    "class",
    "classes",
    "lesson",
    "lessons",
    "workshop",
    "workshops",
    "practice",
    "practices",
    "practica",
    "practicas",
    "bootcamp",
    "bootcamps",
    "course",
    "courses",
    "choreo",
    "choreography",
    "drill",
    "drills",
    "technique",
    "beginner",
    "beginners",
    "intermediate",
    "advanced",
    "fundamentals",
  ].map((w) => normalizeForMatch(w)),
);

const LEVEL_NUMBERS = new Set([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "one",
  "two",
  "three",
  "four",
  "i",
  "ii",
  "iii",
  "iv",
]);

export function isClassLike(row: { title: string; listingType: string | null }): boolean {
  if (row.listingType === "class" || row.listingType === "practica") {
    return true;
  }
  const tokens = normalizeForMatch(row.title).split(" ");
  for (const token of tokens) {
    if (CLASS_WORDS.has(token)) {
      return true;
    }
  }
  // Check for "level" followed by a number
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "level") {
      const next = tokens[i + 1] ?? "";
      // normalizeForMatch drops the "+" of "Level 2+", leaving "2".
      if (LEVEL_NUMBERS.has(next) || /^\d+$/.test(next)) {
        return true;
      }
    }
  }
  return false;
}
