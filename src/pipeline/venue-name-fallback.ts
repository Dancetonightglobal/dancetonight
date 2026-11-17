/**
 * Extract candidate venue names from a venue name that may contain placeholders
 * and from a title that may contain a venue after a separator.
 *
 * Returns candidate venue names, in order, de-duplicated, each trimmed, empty strings dropped.
 *
 * 1. From `venueName` (if non-empty): remove a placeholder PREFIX or SUFFIX,
 *    case-insensitive, accents ignored, followed/preceded by a separator.
 *    Placeholders: `tba`, `tbc`, `tbd`, `to be announced`, `secret location`,
 *    `location tba`, `location tbc`, `location not listed`, `address tba`,
 *    `address on ticket`.
 *    Separators: ` - `, ` – `, ` — `, `: `, ` | `, ` / `, ` @ `, ` ~ `, ` at `.
 *    Also strip a trailing parenthesised placeholder.
 *    If nothing is stripped, add nothing from this step.
 *
 * 2. From `title`: the text after the LAST ` ~ at `, ` @ `, ` at the `, or ` at `
 *    (case-insensitive; try those separators in that order and use the first one found),
 *    cut at the first ` | `, ` - `, ` – `, ` (` or `, ` after it.
 *    Ignore a result shorter than 3 characters.
 *
 * Never returns the input venueName itself unchanged.
 */
export function venueNameCandidates(venueName: string | null, title: string): string[] {
  const candidates = new Set<string>();

  // Step 1: venueName placeholder stripping
  if (venueName && venueName.trim()) {
    const stripped = stripVenuePlaceholder(venueName);
    if (stripped !== null) {
      candidates.add(stripped);
    }
  }

  // Step 2: extract from title
  const titleTrimmed = title.trim();
  // Try separators in order: " ~ at ", " @ ", " at the ", " at "
  const separators = [" ~ at ", " @ ", " at the ", " at "];
  for (const sep of separators) {
    const idx = titleTrimmed.toLowerCase().lastIndexOf(sep.toLowerCase());
    if (idx !== -1) {
      const after = titleTrimmed.slice(idx + sep.length);
      // Cut at first occurrence of any of: " | ", " - ", " – ", " (", ", "
      const cutRegex = / \| | - | – | \(|, /;
      const cutMatch = cutRegex.exec(after);
      const extracted = cutMatch ? after.slice(0, cutMatch.index) : after;
      const trimmedExtracted = extracted.trim();
      if (trimmedExtracted.length >= 3) {
        candidates.add(trimmedExtracted);
      }
      // Use the first separator found
      break;
    }
  }

  return Array.from(candidates);
}

/**
 * Remove a placeholder prefix, suffix, or parenthesised placeholder from a venue name.
 * Returns the cleaned name if a placeholder was found and removed, otherwise null.
 */
export function stripVenuePlaceholder(venueName: string): string | null {
  const trimmed = venueName.trim();
  if (!trimmed) return null;

  const P =
    "(?:tba|tbc|tbd|to be announced|secret location|location tba|location tbc|location not listed|address tba|address on ticket)";
  const SEP = "(?:\\s+[-–—|/@~]\\s+|:\\s+|\\s+at\\s+)";

  // Prefix pattern: placeholder followed by separator
  const prefixRegex = new RegExp(`^${P}${SEP}(.+)$`, "iu");
  // Suffix pattern: separator followed by placeholder
  const suffixRegex = new RegExp(`^(.+?)${SEP}${P}$`, "iu");
  // Parenthesised pattern: placeholder in parentheses at the end
  const parenRegex = new RegExp(`^(.+?)\\s*\\(${P}\\)$`, "iu");

  let match: RegExpMatchArray | null = null;
  let result: string | null = null;

  if ((match = trimmed.match(prefixRegex))) {
    result = match[1]!.trim();
  } else if ((match = trimmed.match(suffixRegex))) {
    result = match[1]!.trim();
  } else if ((match = trimmed.match(parenRegex))) {
    result = match[1]!.trim();
  }

  return result && result !== trimmed ? result : null;
}
