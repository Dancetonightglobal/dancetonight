/**
 * Removes dance mentions that are not evidence of a dance event:
 * 1. Institution proper names containing "Dance"
 * 2. Third-person "dances" in a list of verbs
 */
export function withoutNonDanceMentions(text: string): string {
  // First, handle institution proper names (case-sensitive)
  // Pattern for: (School|College|Conservatory|Department|Faculty|Institute|Academy) of Dance
  // Optionally with one capitalized word and "and"/"&" before Dance
  const institutionPattern =
    /\b(School|College|Conservatory|Department|Faculty|Institute|Academy) of (?:[A-Z][a-z]*\s+)?(?:and\s+|&\s+)?Dance\b/g;

  // Pattern for: Dance (Company|Companies|Department|Faculty|Theater|Theatre|Program|Programme)
  const danceEntityPattern =
    /\bDance (Company|Companies|Department|Faculty|Theater|Theatre|Program|Programme)\b/g;

  // Apply institution patterns
  let result = text.replace(institutionPattern, " ");
  result = result.replace(danceEntityPattern, " ");

  // Second, handle "dances" in verb lists (case-insensitive)
  // List of other verbs
  const otherVerbs = [
    "sings",
    "acts",
    "laughs",
    "cries",
    "slays",
    "fights",
    "jokes",
    "plays",
    "kisses",
    "runs",
  ];

  // Create pattern for "dances" preceded by another verb
  const precededPattern = new RegExp(
    `\\b(${otherVerbs.join("|")})\\s*(?:,\\s*|\\s+and\\s+|\\s*&\\s*|,\\s*and\\s+)\\s*dances\\b`,
    "gi",
  );

  // Create pattern for "dances" followed by another verb
  const followedPattern = new RegExp(
    `\\bdances\\s*(?:,\\s*|\\s+and\\s+|\\s*&\\s*|,\\s*and\\s+)\\s*(${otherVerbs.join("|")})\\b`,
    "gi",
  );

  // Apply both patterns
  result = result.replace(precededPattern, (match) => {
    return match.replace(/\bdances\b/i, " ");
  });

  result = result.replace(followedPattern, (match) => {
    return match.replace(/\bdances\b/i, " ");
  });

  // If nothing was changed, return the original text
  if (result === text) {
    return text;
  }

  return result;
}

/**
 * Regular expression matching non-dance evidence terms
 * Case-insensitive, word-bounded
 */
export const NON_DANCE_EVIDENCE_REGEX =
  /\b(?:musical theater|musical theatre|musical episode|sing-a-long|sing-along|sing along|singalong|parody|panel(?!l)(?!s\b)|panel discussion|panelist|panelists|hackathon)\b/i;
