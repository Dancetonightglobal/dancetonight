"use client";

// A client component because navigator.geolocation exists only in the browser, and the
// permission prompt must come from a real user gesture. Everything it learns goes straight into
// the URL, where the rest of the page's state already lives, so the server does the listing.

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";

import { t } from "@/src/i18n";

type Message = null | "locating" | "using" | "denied" | "unavailable";

const MESSAGES = {
  locating: "home.location.locating",
  using: "home.location.usingYours",
  denied: "home.location.denied",
  unavailable: "home.location.unavailable",
} as const;

const noSubscription = () => () => {};

/**
 * False in the server HTML, true once React owns the button. A tap before that reached a button
 * with no handler and was lost, so until then the button is disabled, which says so honestly.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/**
 * `dropDay`: the page opened tonight instead of the link's `day` (audit F16), so the located page
 * leaves that day out like every other link on it, rather than naming it again.
 */
export function UseMyLocation({ dropDay = false }: { dropDay?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<Message>(null);
  // The point this button put in the URL. "Showing places near you" is said only while the URL
  // still holds it: the header survives Back and in-page links, and used to keep saying so over
  // the default centre (review, 2026-09-28).
  const [pushed, setPushed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();
  const here = `${searchParams.get("lat")},${searchParams.get("lng")}`;
  const shown: Message = message === "using" && pushed !== here ? null : message;

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage("unavailable");
      return;
    }
    setMessage("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("lat", position.coords.latitude.toFixed(5));
        next.set("lng", position.coords.longitude.toFixed(5));
        next.delete("place");
        if (dropDay) next.delete("day");
        next.sort();
        // Something on screen says the location was used: the headline keeps the metro's name
        // and only the distances change (review, 2026-09-28).
        setMessage("using");
        setPushed(`${next.get("lat")},${next.get("lng")}`);
        startTransition(() => router.push(`/?${next.toString()}`));
      },
      (error) => {
        setMessage(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    // items-start: a long message below must not stretch the button to the row's width.
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={locate}
        // Not while locating: a permission prompt dismissed without an answer never calls back,
        // and the button must stay usable to ask again (review, 2026-09-28).
        disabled={!hydrated || pending}
        className="type-label text-ink disabled:text-toner min-h-11 underline underline-offset-4"
      >
        {t("home.location.useExact")}
      </button>
      <p aria-live="polite" className="type-secondary text-ink empty:hidden">
        {shown === null ? (pending ? t("common.loading") : "") : t(MESSAGES[shown])}
      </p>
    </div>
  );
}
