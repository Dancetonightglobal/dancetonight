"use client";

// The visitor's print-run control. Split from theme.tsx so the pre-hydration script stays a
// server module: everything below runs in the browser and nothing above it needs to.

import { useSyncExternalStore } from "react";

import { t } from "@/src/i18n";
import { THEME_STORAGE_KEY, paintThemeColor, type ThemeChoice } from "@/src/ui/theme";

/**
 * What the document is set to right now, read from the attribute `themeInitScript` stamps. The
 * attribute is the single source of truth rather than a copy held in state, so a theme changed
 * anywhere -- another picker, a future menu -- moves this control with it.
 */
function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readChoice(): ThemeChoice {
  const stamped = document.documentElement.getAttribute("data-theme");
  return stamped === "dark" || stamped === "light" ? stamped : "system";
}

/**
 * Stamp the choice and remember it. Storage can throw (a private window, blocked site data) and
 * that must not stop the page from changing colour, so the attribute is set first and the write
 * is allowed to fail on its own.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  paintThemeColor(choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* The page is already the colour they asked for; only the memory of it is lost. */
  }
}

const OPTIONS: readonly ThemeChoice[] = ["system", "light", "dark"];

/**
 * Three radio buttons in a row, not a two-state switch: "match my device" has to stay reachable
 * after a visitor has chosen, or the first tap is one-way. Selection is never carried by colour
 * alone (DESIGN.md section 11), so the checked option is bold with an ink underline and a real
 * `checked` radio underneath, which is what a screen reader reads.
 */
export function ThemePicker({ className = "" }: { className?: string }) {
  // Rendered on the server as well, where there is no document: "system" is the honest default
  // until the browser says otherwise, and the third argument is what SSR and hydration read.
  const choice = useSyncExternalStore(subscribeToTheme, readChoice, () => "system" as ThemeChoice);

  return (
    <fieldset className={className}>
      <legend className="type-label text-toner">{t("home.theme.label")}</legend>
      <div className="mt-1 flex flex-wrap gap-x-4">
        {OPTIONS.map((option) => {
          const current = choice === option;
          return (
            <label
              key={option}
              /*
                The radio is visually hidden, so the focus ring has to be drawn on the label:
                an outline on a 1px clipped input is an outline nobody can see (WCAG 2.2 2.4.7).
              */
              className={`type-strip text-ink min-h-11 flex cursor-pointer items-center border-b-2 has-[:focus-visible]:outline-spot has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 ${
                current ? "border-ink font-semibold" : "border-transparent text-toner"
              }`}
            >
              <input
                type="radio"
                name="dancetonight-theme"
                value={option}
                checked={current}
                onChange={() => applyTheme(option)}
                className="sr-only"
              />
              {t(`home.theme.${option}`)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
