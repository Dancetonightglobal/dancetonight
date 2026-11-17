"use client";

// A toggle with state for showing map credits in a compact "i" button.

import { useState } from "react";

import { t } from "@/src/i18n";

export function MapCredits({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`absolute bottom-2 end-2 z-10 flex flex-col items-end gap-1 ${className}`}>
      {open && (
        <p
          id="map-credits"
          className="type-secondary text-ink bg-paper chip-edge rounded-control max-w-64 px-3 py-2"
        >
          {t("footer.attribution")}
        </p>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="map-credits"
        aria-label={open ? t("map.closeCredits") : t("map.credits")}
        onClick={() => setOpen((v) => !v)}
        className="grid min-h-11 min-w-11 place-items-center"
      >
        <span
          aria-hidden="true"
          className="bg-paper text-ink chip-edge type-label grid h-6 w-6 place-items-center rounded-full"
        >
          i
        </span>
      </button>
    </div>
  );
}
