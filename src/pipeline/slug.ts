import anyAscii from "any-ascii";
import { normalizeForMatch } from "@/config/styles";

// A run of letters/combining marks with no Latin-script letter in it.
const NON_LATIN_RUN = /(?:(?!\p{Script=Latin})[\p{L}\p{M}])+/gu;

/** D-568: non-Latin letters are spelled in ASCII; everything else is unchanged. */
export function transliterateNonLatin(title: string): string {
  return title.replace(NON_LATIN_RUN, (run) => ` ${anyAscii(run)} `);
}

export function slugFor(title: string, nightDate: string, id: string): string {
  const words = normalizeForMatch(transliterateNonLatin(title))
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join("-");
  return `${words || "listing"}-${nightDate}-${id.slice(0, 6)}`;
}
