// Theme selection (D-036, and DESIGN.md section 12: "Theme follows prefers-color-scheme with a
// manual toggle stored in localStorage as data-theme on html"). The page follows the device
// unless the visitor has chosen, and the choice is stamped on <html> before first paint so a
// dark-mode visitor never sees a white flash.

import { PAPER_DARK, PAPER_LIGHT } from "@/src/ui/home/page-tokens";

export const THEME_STORAGE_KEY = "dancetonight-theme";

/** The device's own preference is a choice too, and the one a visitor starts from. */
export type ThemeChoice = "system" | "light" | "dark";

/**
 * The browser's own bar is painted from the theme-color metas, which follow the device's scheme
 * (app/layout.tsx). A chosen theme puts one more meta, with no media query, first in the head,
 * which the browser takes over the other two, so Dark on a light iPhone does not leave a paper
 * bar above a navy page (review, 2026-09-28); "system" removes it. React's own metas are never
 * touched: changing them made hydration insert a third one. The same body runs in the init
 * script below, as a string, before first paint.
 */
const PAINT_THEME_COLOR = `function(c){var h=document.head,m=h.querySelector("meta[data-theme-color]");if(c!=="dark"&&c!=="light"){if(m)m.remove();return}if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");m.setAttribute("data-theme-color","");h.insertBefore(m,h.firstChild)}m.setAttribute("content",c==="dark"?${JSON.stringify(PAPER_DARK)}:${JSON.stringify(PAPER_LIGHT)})}`;

export function paintThemeColor(choice: ThemeChoice): void {
  const head = document.head;
  let meta = head.querySelector<HTMLMetaElement>("meta[data-theme-color]");
  if (choice === "system") {
    meta?.remove();
    return;
  }
  if (meta === null) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("data-theme-color", "");
    head.insertBefore(meta, head.firstChild);
  }
  meta.setAttribute("content", choice === "dark" ? PAPER_DARK : PAPER_LIGHT);
}

/**
 * Runs before hydration. Kept deliberately tiny and dependency-free: it reads one string and sets
 * one attribute (and the bar's colour), and a failure (a private window, blocked site data) leaves
 * the device preference in charge, which is the correct fallback rather than an error.
 */
export const themeInitScript = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t);(${PAINT_THEME_COLOR})(t)}}catch(e){}`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
}
