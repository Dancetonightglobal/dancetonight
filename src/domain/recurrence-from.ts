// Helper for stripping leading "from"/"desde" from normalized recurrence text.
// Used in parseRecurrenceText to handle phrases like "From Thursday to Sunday".

export function stripLeadingFrom(normalized: string): string | null {
  // normalized is already lowercased and trimmed by normalizeText
  const match = normalized.match(/^(from|desde)\s+(.+)$/);
  if (!match) return null;
  const rest = (match[2] ?? "").trim();
  return rest.length > 0 ? rest : null;
}
