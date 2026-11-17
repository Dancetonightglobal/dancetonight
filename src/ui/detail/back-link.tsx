"use client";

// "use client" because the way back to the dancer's own list is history, and only the browser
// has it. The server renders a plain link to the listing's night ("Back to Sat, Oct 3",
// /?day=2026-10-03), which works before hydration, with no JavaScript, and from a shared link.
// When the history entry behind this one is our home page, the tap steps back instead, so the
// dancer lands on the night, the filters and the scroll position they left (D-069). What is
// behind is recorded on this entry by the layout's inline script (nav-memory-script.tsx).

import type { MouseEvent } from "react";

import { previousPage } from "@/src/ui/detail/nav-memory-script";

/** True when the history entry behind this one is our home page, so back returns to it. */
export function cameFromHome(): boolean {
  const previous = previousPage();
  if (previous === null) return false;
  try {
    return new URL(previous, window.location.origin).pathname === "/";
  } catch {
    return false;
  }
}

export function BackLink({ href, label }: { href: string; label: string }) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click (new tab, new window) is the dancer's own choice: leave it to the link.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (!cameFromHome()) return;
    event.preventDefault();
    window.history.back();
  }

  return (
    // A plain <a>, as every card is: the home page's first-paint script runs on a document load.
    <a
      href={href}
      onClick={onClick}
      className="type-body text-ink inline-flex min-h-11 items-center no-underline before:me-1 before:content-['‹']"
    >
      {label}
    </a>
  );
}
