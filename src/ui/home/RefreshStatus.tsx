"use client";

// The on-demand read's status line (D-899). Only the browser should start a city's read: the page
// is served from the edge cache, and a crawler reading the HTML must start nothing. So this asks
// /api/refresh when the city opens, which starts the read if the listings are stale, then asks
// again each minute while the read runs, and offers the new listings when it is done.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { t } from "@/src/i18n";
import { formatAgo } from "./format";

type Answer = { state: "updating" | "fresh" | "capped" | "off"; lastUpdated: string | null };

/** How often to ask while a read runs, and for how long at most (a full read takes 5 to 40 minutes). */
const POLL_MS = 60_000;
const POLL_FOR_MS = 60 * 60_000;

async function ask(city: string): Promise<Answer | null> {
  try {
    const response = await fetch(`/api/refresh?city=${encodeURIComponent(city)}`, {
      method: "POST",
    });
    if (!response.ok) return null;
    return (await response.json()) as Answer;
  } catch {
    return null;
  }
}

export function RefreshStatus({ city, locale }: { city: string; locale: string }) {
  const router = useRouter();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    let wasUpdating = false;
    const tick = async () => {
      const next = await ask(city);
      if (stopped || next === null) return;
      setAnswer(next);
      if (next.state === "updating") {
        wasUpdating = true;
        if (Date.now() - started < POLL_FOR_MS) timer = setTimeout(tick, POLL_MS);
      } else if (wasUpdating) {
        setReady(true);
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [city]);

  if (answer === null || answer.state === "off") return null;

  if (ready) {
    return (
      <p className="type-secondary text-ink mt-1" aria-live="polite">
        {t("home.header.refresh.ready")}{" "}
        <button
          type="button"
          className="text-ink underline underline-offset-4"
          onClick={() => {
            setReady(false);
            router.refresh();
          }}
        >
          {t("home.header.refresh.reload")}
        </button>
      </p>
    );
  }

  const ago =
    answer.lastUpdated === null
      ? null
      : formatAgo(new Date(answer.lastUpdated), new Date(), locale);
  const text =
    answer.state === "updating"
      ? ago === null
        ? t("home.header.refresh.updatingFirst")
        : t("home.header.refresh.updating", { ago })
      : ago === null
        ? null
        : t("home.header.refresh.updated", { ago });
  if (text === null) return null;
  return (
    <p className="type-secondary text-toner mt-1" aria-live="polite">
      {text}
    </p>
  );
}
