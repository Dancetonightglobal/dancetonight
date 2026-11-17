"use client";

// The now rule is computed on the server against the real clock. Only the browser can notice a
// minute passing, so this asks for a fresh server render on each minute boundary — the rule, the
// countdowns and the on-now stamps all move together, by re-rendering, with no transition
// (DESIGN section 11, "Motion"). It renders nothing. A hidden tab does not refresh, and a tab that
// comes back after a minute boundary refreshes once.

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { startMinuteTicks } from "./minute-ticks";

export function MinuteTick() {
  const router = useRouter();

  useEffect(() => {
    if (typeof document === "undefined") return;
    return startMinuteTicks(() => router.refresh(), document);
  }, [router]);

  return null;
}
