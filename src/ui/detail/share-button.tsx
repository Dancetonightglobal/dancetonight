"use client";

// "use client" because sharing is a browser capability: the share sheet where there is one, the
// clipboard everywhere else. The link itself is rendered by the server, so the page still works
// with no JavaScript at all; this only adds the shortcut.

import { useEffect, useState } from "react";

import { t } from "@/src/i18n";

/** How long "Link copied" stays before the button says "Share" again. */
export const COPIED_RESET_MS = 3_000;

export function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // The dancer closed the share sheet: that is an answer, not a failure, so nothing is
        // copied behind their back (D-069). Any other refusal falls through to the clipboard.
        // Checked by name: a DOMException is not an Error subclass in every engine.
        if ((error as { name?: unknown } | null)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard permission: the address bar still carries the link.
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="type-body text-toner min-h-11 inline-flex items-center"
    >
      {copied ? t("detail.actions.linkCopied") : t("detail.actions.share")}
    </button>
  );
}
