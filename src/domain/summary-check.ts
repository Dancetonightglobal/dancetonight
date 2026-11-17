// The post-check on a model's summary (PLAN 8.3, D-109): every number and every proper noun it
// writes appears in the facts it was written from, and it is 2 or 3 sentences. Pure; no I/O.

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Words a sentence may open with that name nothing: they need not appear in the facts. */
const OPENERS = new Set(
  (
    "a an the this it its expect there here doors dancing dance entry admission tickets music " +
    "lesson lessons class classes all live join come bring after before from on at in " +
    "every each tonight no free organized organised hosted presented run"
  ).split(" "),
);

/** A number as written: "15", "9:30", "12.50". */
const NUMBER = /\d+(?:[.,:]\d+)*/g;

/** Capitalised words that are ordinary in any summary of a dance night. */
const COMMON = new Set(["i", "dj", "djs", "am", "pm"]);

export interface SummaryVerdict {
  ok: boolean;
  /** What failed: a number or a name the facts do not have, or the sentence count. */
  reason: string | null;
}

/** Whether `summary` writes only numbers and names that `factsText` has. */
export function checkSummary(summary: string, factsText: string): SummaryVerdict {
  const text = summary.trim();
  const sentences = text.split(/(?<=[.!?])\s+(?=\S)/).filter((s) => s.trim().length > 0);
  if (sentences.length < 2 || sentences.length > 3) {
    return { ok: false, reason: `${sentences.length} sentence(s)` };
  }
  const facts = fold(factsText);
  const factWords = new Set(facts.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const numbers = new Set([...facts.matchAll(NUMBER)].map((m) => m[0]));
  for (const m of text.matchAll(NUMBER)) {
    if (!numbers.has(m[0])) return { ok: false, reason: `number "${m[0]}"` };
  }
  for (const sentence of sentences) {
    // A name may carry digits ("Ov3rdrive"), as the facts' words do (D-819).
    const words = [...sentence.matchAll(/[\p{L}][\p{L}\p{N}'’-]*/gu)];
    for (const [i, m] of words.entries()) {
      const word = m[0];
      if (!/^\p{Lu}/u.test(word)) continue;
      const key = fold(word).replace(/['’]s$/, "");
      if (COMMON.has(key)) continue;
      if (i === 0 && OPENERS.has(key)) continue;
      const parts = key.split(/[-'’]/).filter(Boolean);
      if (parts.every((p) => factWords.has(p))) continue;
      return { ok: false, reason: `name "${word}"` };
    }
  }
  return { ok: true, reason: null };
}
