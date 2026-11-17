"use client";

// A thin bar across the top of the screen while the link it sits in is loading. useLinkStatus
// only works inside a <Link>, so each link that can be slow carries one.

import { useLinkStatus } from "next/link";

import { t } from "@/src/i18n";

export function PendingBar() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span role="status" className="nav-pending" data-nav-pending="">
      <span className="sr-only">{t("home.loading")}</span>
    </span>
  );
}
