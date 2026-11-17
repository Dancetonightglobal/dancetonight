/**
 * Removes NUL and other C0 control characters from text, keeping only tab, newline and carriage return.
 * Characters removed: U+0000 to U+0008, U+000B, U+000C, U+000E to U+001F, and U+007F.
 */
export function stripControlChars(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Recursively cleans strings in a JSON-like value, removing control characters.
 * Only plain objects (prototype Object.prototype or null) and arrays are walked.
 * Date objects, numbers, booleans, null and undefined pass through untouched.
 * Returns a new value; never mutates the input.
 */
export function cleanStrings<T>(value: T): T {
  if (typeof value === "string") {
    return stripControlChars(value) as T;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cleanStrings(item)) as T;
  }
  if (typeof value === "object") {
    // Only plain objects: prototype is Object.prototype or null
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return value;
    }
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = cleanStrings(val);
    }
    return result as T;
  }
  // Numbers, booleans, etc.
  return value;
}
