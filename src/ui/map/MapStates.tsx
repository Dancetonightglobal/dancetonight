// The two things drawn in the map's place (DESIGN.md sections 5 and 7, D-068): the halftone sheet
// that holds its space while it loads, and the notice when it could not be drawn, which offers to
// load it again. One drawing each, whether the map's code is what failed (MapPanel) or its style
// (MapCanvas), so the dancer sees the same thing either way.
//
// No "use client" of its own: only MapPanel and MapCanvas, both client components, import it.

import { t } from "@/src/i18n";

/**
 * A halftone sheet saying what it is waiting for. `framed` bounds it with its own hairline, as a
 * sheet on the page is; the detail page's map draws its own frame around it (DetailMap).
 */
export function MapLoading({ framed }: { framed: boolean }) {
  return (
    <div
      role="status"
      className={`bg-halftone grid h-full w-full place-items-center ${framed ? "chip-edge rounded-control min-h-44 overflow-hidden" : ""}`}
    >
      <p className="type-secondary text-ink px-4 text-center">{t("map.loading")}</p>
    </div>
  );
}

/** "The map didn't load. The list still has every place." and a way to try again. */
export function MapFailed({
  onRetry,
  className = "",
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={`bg-halftone grid place-content-center justify-items-center gap-3 px-4 text-center ${className}`}
    >
      <p className="type-body text-ink">{t("map.failed")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="type-button bg-ink text-paper rounded-control min-h-11 px-4"
      >
        {t("map.retry")}
      </button>
    </div>
  );
}
