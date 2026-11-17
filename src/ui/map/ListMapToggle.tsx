"use client";

// The phone's list/map toggle (DESIGN.md section 6, the bar across the foot of the wireframe).
// It disappears at 1024px, where both are on screen at once and there is nothing to toggle.
//
// "use client" because once the page has hydrated a tap switches the view in place, without a
// round trip, so the map is not rebuilt and the list keeps its scroll position (D-068).
//
// Each half is a real link (`?view=map`, or the same page without `view`), so a tap that lands
// before hydration, or with no JavaScript at all, still gets there: the server opens the view the
// URL names. Selection is not carried by colour alone: the chosen half is bold with a 2px spot
// underline and says so through `aria-current`, so it reads the same in a greyscale photocopy.

import type { MouseEvent, ReactNode } from "react";

import { t } from "@/src/i18n";
import { useMapSelection } from "@/src/ui/map/selection";
import type { MapView } from "@/src/ui/map/types";

/** The bar's height, and the bottom inset every other measurement has to leave for it. */
export const TOGGLE_HEIGHT_PX = 52;

/** A plain click, as opposed to one asking for a new tab or window, which the link should get. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/**
 * A link to one of the two views. It navigates like any link until the page hydrates; after that
 * a plain click switches the view in place (the URL still changes, through history).
 */
export function ViewLink({
  view,
  href,
  className,
  current,
  children,
}: {
  view: MapView;
  href: string;
  className?: string;
  /** Marks the link as the view on screen. */
  current?: boolean;
  children: ReactNode;
}) {
  const { setView } = useMapSelection();
  return (
    <a
      href={href}
      aria-current={current === true ? "page" : undefined}
      className={className}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        setView(view);
      }}
    >
      {children}
    </a>
  );
}

function Half({
  value,
  label,
  href,
  current,
}: {
  value: MapView;
  label: string;
  href: string;
  current: MapView;
}) {
  const selected = current === value;
  return (
    <ViewLink
      view={value}
      href={href}
      current={selected}
      // 52px tall, drawn up over the bar's 1px hairline, so the target is the full 52px and the
      // bar is exactly the 52px the map pane leaves for it (bottom-13; the owner asked for a taller
      // bar, 2026-10-15).
      className="type-button text-ink -mt-px grid h-13 flex-1 place-items-center"
    >
      <span
        className={
          selected ? "font-semibold underline decoration-2 underline-offset-8" : "text-toner"
        }
      >
        {label}
      </span>
    </ViewLink>
  );
}

export function ListMapToggle({
  view,
  listHref,
  mapHref,
  className = "",
}: {
  view: MapView;
  /** This page without `view`, built on the server from the same params as every other link. */
  listHref: string;
  /** This page with `view=map`. */
  mapHref: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={t("home.view.label")}
      className={`bg-paper border-halftone flex h-[calc(3.25rem+env(safe-area-inset-bottom))] border-t pb-[env(safe-area-inset-bottom)] ${className}`}
    >
      <Half value="list" label={t("home.view.list")} href={listHref} current={view} />
      <Half value="map" label={t("home.view.map")} href={mapHref} current={view} />
    </div>
  );
}
