"use client";

// The city picker modal dialog, opened by tapping the city name in the headline.
// A modal <dialog> opened with showModal() makes the page behind inert and a tap outside
// closes the list without reaching the page (D-576). On phones the sheet comes from the top (D-584).

import { t } from "@/src/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CitySummary } from "@/src/data/repository";
import { useRef, useEffect } from "react";
import { PendingBar } from "./PendingBar";

export const CITY_PICKER_ID = "city-picker";

/**
 * Returns the href for a city. If the city is the opening city (default), returns "/".
 * Otherwise returns `/?lat=<lat>&lng=<lng>`.
 */
export function cityHref(city: CitySummary, openingSlug: string | null): string {
  if (city.slug === openingSlug) {
    return "/";
  }
  const params = new URLSearchParams();
  params.set("lat", city.center.lat.toFixed(5));
  params.set("lng", city.center.lng.toFixed(5));
  return `/?${params.toString()}`;
}

/**
 * Opens the city list. `from` says which button opened it: from the now strip the heading's button
 * is off screen, so on desktop the list is centred instead of anchored to it (D-577).
 */
export function openCityPicker(from: "header" | "strip"): void {
  const d = document.getElementById(CITY_PICKER_ID);
  if (!(d instanceof HTMLDialogElement) || d.open) return;
  d.dataset.from = from;

  // Phones: the sheet opens just below what opened it, so the headline (or the now strip) stays in
  // view (D-584). Desktop CSS ignores --sheet-top.
  let top = 0;
  if (from === "header") {
    const h1 = document.querySelector("#page-header h1");
    const bottom = h1?.getBoundingClientRect().bottom ?? 0;
    // Only when the headline is on screen and leaves room for the list.
    if (bottom > 0 && bottom < window.innerHeight * 0.5) top = Math.round(bottom + 8);
  }
  d.style.setProperty("--sheet-top", `${top}px`);

  d.showModal();
  d.focus();
}

/** Handlers that prefetch `href` when the visitor shows intent: pointer enters, pointer goes down, or focus. */
export function intentPrefetchProps(
  prefetch: (href: string) => void,
  href: string,
): {
  onPointerEnter: () => void;
  onPointerDown: () => void;
  onFocus: () => void;
} {
  const safePrefetch = () => {
    try {
      prefetch(href);
    } catch {
      // Swallow errors to avoid breaking the link
    }
  };
  return {
    onPointerEnter: safePrefetch,
    onPointerDown: safePrefetch,
    onFocus: safePrefetch,
  };
}

/**
 * The button that opens the city picker dialog.
 */
export function CityButton({ place }: { place: string }) {
  const handleClick = () => openCityPicker("header");

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-haspopup="dialog"
      className="city-anchor text-ink underline underline-offset-4"
      aria-label={t("home.header.city.button", { place })}
    >
      {place}
    </button>
  );
}

interface CityPickerProps {
  cities: CitySummary[];
  currentSlug: string | null;
  openingSlug: string | null;
}

/**
 * The modal dialog list of cities.
 */
export function CityPicker({ cities, currentSlug, openingSlug }: CityPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  // The sheet stays open, with the loading bar, until the new city's page arrives (D-576).
  useEffect(() => {
    dialogRef.current?.close();
  }, [currentSlug]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.close();
    }
  };

  return (
    <dialog
      id={CITY_PICKER_ID}
      ref={dialogRef}
      aria-labelledby="city-picker-title"
      className="city-picker bg-paper text-ink chip-edge p-0"
      onClick={handleBackdropClick}
      tabIndex={-1}
    >
      <div className="city-picker-body">
        <p id="city-picker-title" className="type-marker text-toner px-4 pt-3 pb-2">
          {t("home.header.city.choose")}
        </p>
        <ul>
          {cities.map((city, index) => {
            const isCurrent = city.slug === currentSlug;
            const hasListings = city.hasListings;
            const isLink = !isCurrent && hasListings;
            const rowClass = "min-h-11 flex items-center justify-between gap-4 px-4";
            const content = (
              <>
                <span className={isLink ? "type-label text-ink" : "type-label text-toner"}>
                  {city.name}
                </span>
                {isCurrent ? (
                  <span className="type-secondary text-toner">{t("home.header.city.current")}</span>
                ) : !hasListings ? (
                  <span className="type-secondary text-toner">
                    {t("home.header.city.comingSoon")}
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={city.slug}>
                {index > 0 && <div aria-hidden="true" className="bg-halftone h-px" />}
                {isLink ? (
                  // D-581: prefetch on intent, not on view (~16 renders per list open).
                  <Link
                    href={cityHref(city, openingSlug)}
                    prefetch={false}
                    {...intentPrefetchProps((h) => router.prefetch(h), cityHref(city, openingSlug))}
                    className={`${rowClass} type-label text-ink underline underline-offset-4`}
                  >
                    {city.name}
                    <PendingBar />
                  </Link>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
