"use client";

// A card's part in the map (DESIGN.md section 5, D-068): the selected card is laid on the halftone
// sheet; hovering or focusing a card lights its pin; and a pin picked on the map scrolls its card
// into view. The card no longer prints a number because pins print the start time (owner, 2026-10-17).
// Hover means the mouse moving over the card, so a card scrolled under a still pointer does not
// take the selection. A pick's smooth scroll stops when focus moves elsewhere (D-171).
//
// "use client" because it reads the map selection, which is state on the page, and answers the
// pointer and the keyboard.
//
// The card itself is a server component and is not redrawn for any of this.

import { useEffect, useRef, type ReactNode } from "react";

import { useMapSelection } from "@/src/ui/map/selection";

/** Stop any smooth scroll that is bringing this card into view. */
function stopScrolling(card: HTMLElement) {
  // Stop the scroll on the document and every scrollable ancestor.
  const scrollable = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    const overflow = style.overflowY;
    return overflow === "auto" || overflow === "scroll";
  };
  const ancestors: HTMLElement[] = [];
  for (let parent: HTMLElement | null = card.parentElement; parent; parent = parent.parentElement) {
    if (scrollable(parent)) ancestors.push(parent);
  }
  const doc = document.scrollingElement;
  if (doc) {
    doc.scrollTo({ top: doc.scrollTop, left: doc.scrollLeft, behavior: "instant" });
  }
  ancestors.forEach((el) => {
    el.scrollTo({ top: el.scrollTop, left: el.scrollLeft, behavior: "instant" });
  });
}

export function MapCard({
  id,
  children,
}: {
  /** The listing id, which is also the pin's. */
  id: string;
  /** Kept for callers; the card no longer prints a number (owner, 2026-10-17). */
  railed: boolean;
  /** The card, as the list draws it. */
  children?: ReactNode;
}) {
  const { selectedId, selectedFrom, select, numberOf, listOnScreen } = useMapSelection();
  const number = numberOf(id);
  const selected = selectedId === id;
  const ref = useRef<HTMLDivElement | null>(null);
  const scrolledRef = useRef(false);

  // Once per pick on the map, and only while the list can be seen: on a phone the list is under
  // the map, so the card comes into view when the dancer switches back to it.
  useEffect(() => {
    if (!selected) {
      scrolledRef.current = false;
      return;
    }
    if (selectedFrom !== "map" || !listOnScreen || scrolledRef.current) return;
    scrolledRef.current = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
      return;
    }
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });

    let timeoutId: number | null = null;
    const stopListening = () => {
      document.removeEventListener("focusin", handleFocusIn, true);
      window.removeEventListener("scrollend", handleScrollEnd, true);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const cardEl = ref.current;
      if (!cardEl) return;
      // Ignore focus inside this card or inside the map (the newly drawn selected pin).
      if (cardEl.contains(target)) return;
      if (target instanceof Element && target.closest(".maplibregl-map") !== null) return;
      // Focus moved elsewhere so stop the scroll.
      stopScrolling(cardEl);
      stopListening();
    };

    const handleScrollEnd = () => {
      // A scrollend from an earlier scroll can arrive first, so only the one that leaves the card
      // in view ends the guard.
      const r = ref.current?.getBoundingClientRect();
      if (!r) {
        stopListening();
        return;
      }
      const arrived = r.top >= -1 && r.top < window.innerHeight;
      if (arrived) {
        stopListening();
      }
      // If not arrived, ignore this scrollend and keep listening.
    };

    const onTimeout = () => stopListening();

    // Always set a timeout as a fallback.
    timeoutId = window.setTimeout(onTimeout, 1500);
    // Add scrollend listener if supported (harmless if not). Do not use { once: true } because a
    // stray scrollend from an earlier scroll must not consume the listener.
    window.addEventListener("scrollend", handleScrollEnd, { capture: true });
    document.addEventListener("focusin", handleFocusIn, { capture: true });

    return stopListening;
  }, [selected, selectedFrom, listOnScreen]);

  return (
    <div
      ref={ref}
      data-card-id={id}
      data-pin-number={number ?? undefined}
      aria-current={selected ? "true" : undefined}
      className={selected ? "bg-halftone" : undefined}
      onPointerMove={(event) => {
        if (
          event.pointerType === "mouse" &&
          (event.movementX !== 0 || event.movementY !== 0) &&
          selectedId !== id
        ) {
          select(id, "card");
        }
      }}
      onFocus={() => select(id, "card")}
    >
      {children}
    </div>
  );
}
