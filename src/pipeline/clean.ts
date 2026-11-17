// Page text for extraction (PLAN 8.2): what a model reads, not what a browser shows. Pure and
// deterministic, so the same page always yields the same text and the same content hash, which
// is what the extraction cache keys on (PLAN 6.7).
//
// - Dropped entirely: scripts, styles, templates, SVG, iframes, forms, the document head, and
//   page chrome (`nav`, `footer`, `aside`, cookie banners, photo-gallery slide counters). Event
//   pages put the events in the body; chrome only spends tokens. So is the `<!DOCTYPE html>`
//   declaration, which no tag pattern matched and which began every page's text until 2026-09-29
//   (D-074: every stored content hash changed with it, under the prompt version bump that re-reads
//   every page anyway).
// - Kept as structure: block elements become line breaks, list items become "- " lines, table
//   cells are separated by " | ", headings get a blank line before them.
// - Links keep their target when it is an http(s) URL and not the anchor text itself, written as
//   "text [url]" (square brackets, since anything in angle brackets would be stripped as a tag), because a ticket or event link is a fact extraction needs. Relative links are
//   resolved against the page; anything else (mailto:, javascript:) is dropped.
// - The result is cut at `maxChars` on a line boundary, with a note saying so, so the model knows
//   the page continues rather than inferring the list ended.
//
// This is text from a stranger's page. It is never trusted: the extraction prompt wraps it as
// data (src/ai/providers wrapUntrusted), and nothing here interprets it.

import { EXTRACT_PAGE_TEXT_TOKENS } from "@/src/ai";
import { decodeEntities, httpUrl } from "@/src/adapters/shared";

/** About four characters per token for English prose; the budget is EXTRACT_PAGE_TEXT_TOKENS. */
export const PAGE_TEXT_MAX_CHARS = EXTRACT_PAGE_TEXT_TOKENS * 4;

export const TRUNCATION_NOTE = "[page text cut here: the page continues]";

const DROP_WITH_CONTENT = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "iframe",
  "form",
  "head",
  "nav",
  "footer",
  "aside",
  "select",
  "button",
];

const BLOCK =
  /^(p|div|section|article|main|header|br|hr|tr|table|ul|ol|dl|dt|dd|blockquote|pre|address|figure|figcaption|time|h[1-6])$/;

export function cleanPageText(
  html: string,
  pageUrl: string,
  maxChars = PAGE_TEXT_MAX_CHARS,
): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<!doctype\b[^>]*>/gi, " ");
  // A filter form wrapped around a Webflow CMS list holds the page's events: keep what it holds
  // (its own inputs, selects and buttons still go), drop every other form (thevenicewest.com, D-884).
  text = text.replace(/<form\b[^>]*>([\s\S]*?)<\/form\s*>/gi, (form: string, inner: string) =>
    /(?<![\w-])w-dyn-list(?![\w-])|fs-cmsfilter-element="list"/i.test(inner) ? inner : form,
  );
  for (const tag of DROP_WITH_CONTENT) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
  }
  // Cookie and consent banners carry the same words on every page of every site.
  text = text.replace(
    /<(div|section)\b[^>]*(?:id|class)="[^"]*(?:cookie|consent|gdpr)[^"]*"[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );

  // A photo gallery's or slider's counter ("1/9", Wix's data-testid="gallery-counter") is chrome, not a date: alone on
  // its line it read as the date heading "1/9" and dated a club's every night wrong (Otto Zutz, read 41284857494).
  text = text.replace(
    /<(div|span|p)\b[^>]*(?:id|class|data-testid)="[^"]*(?:gallery|slider|slide|carousel|swiper)[-_]?(?:counter|count|pagination|fraction)[^"]*"[^>]*>\s*\d{1,3}\s*(?:\/|of)\s*\d{1,3}\s*<\/\1\s*>/gi,
    " ",
  );

  // Modern Events Calendar's month view heads each day "Events for 11月" + "17th", which states no date, so the page
  // was cut by size alone and one part held 22 nights; its reply failed and MAHARAJA lost 11-13..11-22 (D-1245,
  // read 43320146991). The cell's data-mec-cell="20261117" gives the date, written as a date heading instead.
  text = text.replace(
    /(<div\b[^>]*\bdata-mec-cell="(\d{4})(\d{2})(\d{2})"[^>]*>)\s*<h6\b[^>]*mec-table-side-title[^>]*>[\s\S]*?<\/h6\s*>\s*<h3\b[^>]*mec-table-side-day[^>]*>[\s\S]*?<\/h3\s*>/gi,
    (whole: string, open: string, y: string, m: string, d: string) => {
      const day = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      if (day.getUTCMonth() !== Number(m) - 1 || day.getUTCDate() !== Number(d)) return whole;
      const heading = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(day);
      return `${open}<h3>${heading}</h3>`;
    },
  );

  text = text.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi,
    (_whole, attrs: string, inner: string) => {
      const label = inlineText(inner);
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
      const target = href
        ? httpUrl(decodeEntities(href[1] ?? href[2] ?? href[3] ?? ""), pageUrl)
        : null;
      if (!target) return ` ${label} `;
      if (!label) return ` [${target}] `;
      return label === target ? ` ${label} ` : ` ${label} [${target}] `;
    },
  );

  // Dom Lis (domlis.es) puts each number of a time in its own span: <span>18</span>:<span>00</span>.
  // Without this step the inline tags become spaces and the time reads as "18 : 00", which the
  // time parser does not recognise. Only pages with this pattern change their text (and hash).
  const INLINE_TAG = "(?:span|b|strong|em|i|small|sup|font|mark)";
  // Remove inline tags between a digit and a colon (18</span>:)
  text = text.replace(
    new RegExp(
      `(?<=\\d)(?:</?${INLINE_TAG}\\b[^>]*>)+(?=:(?:</?${INLINE_TAG}\\b[^>]*>)*\\d)`,
      "gi",
    ),
    "",
  );
  // Remove inline tags between a colon and a digit (:<span>00)
  text = text.replace(new RegExp(`(?<=\\d:)(?:</?${INLINE_TAG}\\b[^>]*>)+(?=\\d)`, "gi"), "");

  text = text
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\n")
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (_tag, name: string) =>
      BLOCK.test(name.toLowerCase()) ? "\n" : " ",
    );

  const lines = decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .map((line) => line.replace(/(\s*\|\s*)+$/, "").replace(/^(\|\s*)+/, ""));

  const out: string[] = [];
  let blank = false;
  for (const line of lines) {
    if (!line || line === "-") {
      blank = out.length > 0;
      continue;
    }
    if (blank) out.push("");
    blank = false;
    out.push(line);
  }
  return cut(out, maxChars);
}

function inlineText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cut(lines: string[], maxChars: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars - TRUNCATION_NOTE.length - 1) {
      kept.push(TRUNCATION_NOTE);
      return kept.join("\n");
    }
    kept.push(line);
    used += line.length + 1;
  }
  return kept.join("\n");
}
