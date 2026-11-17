"use client";

// A client component because it depends on where the page is scrolled, which only the browser
// knows: the strip appears once the page header has scrolled away and the now rule is out of view,
// either above or below the viewport. 32px of paper with a 2px spot bottom edge (DESIGN section 5).
// The strip also carries the city button, because the page opens at now and the heading's button
// is off screen (D-577).

import { useEffect, useState } from "react";

import { t } from "@/src/i18n";
import { openCityPicker } from "./CityPicker";

export function StickyNowStrip({
  time,
  targetId,
  headerId,
  place,
}: {
  time: string;
  targetId: string;
  headerId: string;
  place?: string | null;
}) {
  const [where, setWhere] = useState<"above" | "below" | null>(null);
  const [headerInView, setHeaderInView] = useState(true);

  useEffect(() => {
    const target = document.getElementById(targetId);
    const header = document.getElementById(headerId);
    if (!target || typeof IntersectionObserver === "undefined") return;

    const targetObserver = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setWhere(null);
        } else if (entry.boundingClientRect.top < 0) {
          setWhere("above");
        } else {
          setWhere("below");
        }
      },
      { threshold: 0 },
    );

    const headerObserver = new IntersectionObserver(
      ([entry]) => {
        setHeaderInView(entry?.isIntersecting ?? false);
      },
      { threshold: 0 },
    );

    targetObserver.observe(target);
    // The home page always draws its header; without one the strip stays hidden.
    if (header) headerObserver.observe(header);

    return () => {
      targetObserver.disconnect();
      headerObserver.disconnect();
    };
  }, [targetId, headerId]);

  if (where === null || headerInView) return null;

  return (
    // From 1024px the list is the 440px column beside the map, and the strip belongs to the list:
    // it used to run across the map pane too (review, 2026-09-28).
    <div className="bg-paper border-spot fixed inset-x-0 top-[env(safe-area-inset-top)] z-10 h-8 border-b-2 lg:right-auto lg:w-split">
      <div className="mx-auto flex h-full max-w-list items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="type-strip text-spot shrink-0">{t("home.now.sticky", { time })}</span>
          {place ? (
            <button
              type="button"
              onClick={() => openCityPicker("strip")}
              aria-haspopup="dialog"
              aria-label={t("home.header.city.button", { place })}
              className="type-strip text-ink relative flex h-full min-w-0 items-center after:absolute after:inset-x-0 after:top-0 after:-bottom-3.5"
            >
              <span className="truncate py-1 underline underline-offset-4">{place}</span>
            </button>
          ) : null}
        </div>
        {/* The strip is 32px (DESIGN section 5) and a target is 44px: the link fills the strip's
            30px inside its 2px edge, and its hit area runs 14px below, over the top of the list
            (review, 2026-09-28). */}
        <a
          href={`#${targetId}`}
          className="type-strip text-ink relative -mr-2 flex h-full shrink-0 items-center px-2 underline underline-offset-4 after:absolute after:inset-x-0 after:top-0 after:-bottom-3.5"
        >
          {t(where === "above" ? "home.now.backToNow" : "home.now.jumpToNow")}
        </a>
      </div>
    </div>
  );
}
