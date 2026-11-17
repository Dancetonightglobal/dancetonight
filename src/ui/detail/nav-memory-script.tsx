// Which page sits behind this one in the tab's history, for the detail page's back link (D-069).
// When the entry behind is our home page, the back link steps back through history, which returns
// the dancer to their own night, filters and scroll; no link the server builds can do that.
//
// The record lives on the history entry itself (history.state), never per tab: it has to travel
// with the entry through back, forward, reload and the back/forward cache, and it must never
// describe an entry that is not directly behind this one. A per-tab record did both wrong (review,
// 2026-09-28): a page reached back from its own href thought the home page was behind it and the
// tap did nothing, and a page reached from another site after our home page stepped back to that
// other site.
//
// So an inline script in the root layout's <head> writes it once, before hydration, and only on a
// document load that created this entry by following a link: the navigation type is "navigate",
// the tab has an entry behind (history.length of 2 or more, and a new entry always sits last),
// and the referrer is this site, which on a link-followed load is the page in that entry (none
// of our pages replaces its own entry with another page, the one way the two could differ). A
// reload, a back or forward load and a back/forward-cache restore write nothing and keep what the
// entry already holds. Next's router keeps other keys of history.state when it hydrates.
//
// When in doubt nothing is written, and the back link follows its href: the listing's night on
// the home page, which is right from anywhere. Cards are plain links (src/ui/home/Card.tsx), so
// every arrival from the home page is a document load with the home page as its referrer.
//
// Not a "use client" module on purpose: the layout (a server component) reads the script string,
// and a constant imported from a client module would arrive as a reference, not a value.

/** The key on history.state that holds the path and query of the entry behind this one. */
export const PREVIOUS_PAGE_KEY = "dancetonightPrevious";

/**
 * The path and query of the page in the history entry behind this one, when this entry was
 * created by following a link from a page of ours; null when unknown.
 */
export function previousPage(): string | null {
  try {
    const state: unknown = window.history.state;
    if (typeof state !== "object" || state === null) return null;
    const previous = (state as Record<string, unknown>)[PREVIOUS_PAGE_KEY];
    return typeof previous === "string" ? previous : null;
  } catch {
    return null;
  }
}

/**
 * The inline script that records the entry behind this one. Kept tiny and dependency-free like
 * the theme script; tests/unit/ui-detail.test.ts runs it over a model of a tab's history.
 */
export const navMemoryScript = `(function(){try{var K=${JSON.stringify(
  PREVIOUS_PAGE_KEY,
)},n=performance.getEntriesByType("navigation")[0];if(!n||n.type!=="navigate"||history.length<2||!document.referrer)return;var r=new URL(document.referrer);if(r.origin!==location.origin)return;var s=history.state,o={};if(s&&typeof s==="object")for(var k in s)o[k]=s[k];o[K]=r.pathname+r.search;history.replaceState(o,"")}catch(e){}})()`;

export function NavMemoryScript() {
  return <script dangerouslySetInnerHTML={{ __html: navMemoryScript }} />;
}
