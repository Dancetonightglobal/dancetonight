import type { NotAnEvent } from "@/src/domain/listing-screen";
import { matchStyles } from "@/config/styles";

function has(normalized: string, needles: string[]): boolean {
  return needles.some((needle) => normalized.includes(needle));
}

export function screenTitlePa(title: string): NotAnEvent | null {
  // 1. Check if title has Gurmukhi letters
  if (!/\p{Script=Gurmukhi}/u.test(title)) {
    return null;
  }

  // 2. Normalize to NFC and lowercase
  const normalized = title.normalize("NFC").toLowerCase();

  // 3. "Joins" words - if any of these are present, keep the title (return null)
  const joinNeedles = [
    "ਭੰਗੜਾ",
    "ਗਿੱਧਾ",
    "ਨਾਚ",
    "ਡਾਂਸ",
    "ਡੀਜੇ",
    "ਪਾਰਟੀ",
    "ਬਾਲੀਵੁੱਡ",
    "ਗਰਬਾ",
    "ਡਾਂਡੀਆ",
    "dj",
    "party",
    "dance",
    "bhangra",
  ].map((needle) => needle.normalize("NFC").toLowerCase());

  if (has(normalized, joinNeedles)) {
    return null;
  }

  // Also keep if matchStyles returns any style or family
  const matched = matchStyles(normalized);
  if (matched.styles.length > 0 || matched.families.length > 0) {
    return null;
  }

  // 4. Closure check
  const tokens = normalized
    .replace(/[!|\-:()[\]]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const closureWords = [
    "ਰੱਦ",
    "ਮੁਲਤਵੀ",
    "ਬੰਦ",
    "ਅੱਜ",
    "ਪ੍ਰੋਗਰਾਮ",
    "ਸਮਾਗਮ",
    "ਹੈ",
    "ਕੀਤਾ",
    "ਗਿਆ",
  ].map((w) => w.normalize("NFC").toLowerCase());

  const hasClosureWord = tokens.some((token) =>
    ["ਰੱਦ", "ਮੁਲਤਵੀ", "ਬੰਦ"].map((w) => w.normalize("NFC").toLowerCase()).includes(token),
  );
  const allTokensAreClosure = tokens.every((token) => closureWords.includes(token));

  if (hasClosureWord && allTokensAreClosure) {
    return {
      kind: "closure",
      reason: "a Punjabi cancellation notice (D-1141)",
    };
  }

  // 5. Not dance checks (first match wins)
  const comedyNeedles = ["ਕਾਮੇਡੀ", "ਸਟੈਂਡ-ਅੱਪ", "ਸਟੈਂਡਅੱਪ"].map((w) =>
    w.normalize("NFC").toLowerCase(),
  );
  if (has(normalized, comedyNeedles)) {
    return {
      kind: "not_dance_scope",
      reason: "a Punjabi comedy show, not a dance (D-1141)",
    };
  }

  const poetryReligiousNeedles = [
    "ਕਵੀ ਦਰਬਾਰ",
    "ਕਵਿਤਾ",
    "ਮੁਸ਼ਾਇਰਾ",
    "ਕੀਰਤਨ",
    "ਗੁਰਬਾਣੀ",
    "ਪਾਠ",
    "ਕਥਾ",
    "ਸਤਿਸੰਗ",
  ].map((w) => w.normalize("NFC").toLowerCase());
  if (has(normalized, poetryReligiousNeedles)) {
    return {
      kind: "not_dance_scope",
      reason: "a Punjabi poetry or religious gathering, not a dance (D-1141)",
    };
  }

  const talksPlaysNeedles = ["ਨਾਟਕ", "ਫ਼ਿਲਮ", "ਫਿਲਮ", "ਸੈਮੀਨਾਰ", "ਭਾਸ਼ਣ", "ਕਿਤਾਬ"].map((w) =>
    w.normalize("NFC").toLowerCase(),
  );
  if (has(normalized, talksPlaysNeedles)) {
    return {
      kind: "not_dance_scope",
      reason: "a Punjabi play, film, talk or book event, not a dance (D-1141)",
    };
  }

  const workshopsFairsNeedles = ["ਵਰਕਸ਼ਾਪ", "ਮੇਲਾ", "ਪ੍ਰਦਰਸ਼ਨੀ"].map((w) =>
    w.normalize("NFC").toLowerCase(),
  );
  if (has(normalized, workshopsFairsNeedles)) {
    return {
      kind: "not_dance_scope",
      reason: "a Punjabi workshop, fair or exhibition, not a dance (D-1141)",
    };
  }

  // 6. Otherwise null
  return null;
}
