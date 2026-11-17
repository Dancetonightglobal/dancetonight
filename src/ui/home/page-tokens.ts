// The two page background hexes, for the one place a CSS variable cannot reach: the
// `theme-color` meta tag, which the browser reads before any stylesheet to paint its own chrome.
//
// These MIRROR `--color-paper` in app/globals.css (light and dark). They are duplicated here
// rather than hard-coded at the call site so there is exactly one copy outside the stylesheet.
// The right home for them is an export from src/ui/theme.tsx beside THEME_STORAGE_KEY, which is
// not in this agent's file list; see the report notes.

/** --color-paper, light theme (docs/DESIGN.md section 2). */
export const PAPER_LIGHT = "#FBFAF7";

/** --color-paper, dark theme (docs/DESIGN.md section 2). */
export const PAPER_DARK = "#151412";
