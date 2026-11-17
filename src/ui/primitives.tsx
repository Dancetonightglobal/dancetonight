// The pieces every screen shares (D-036; look "C" since D-147, docs/DESIGN.md section 0). Written
// before the screens so the home page and the detail page cannot render the same idea two ways.
//
// Rules from docs/DESIGN.md enforced here rather than left to each caller:
//   1. A family colour never appears without its label: the colour is the words' own colour.
//   2. The status line is never toner. It is ink, or spot with a dot when the night is on now.
//   3. Quiet: hairlines in halftone, no filled blocks; pills only for filter chips.

import type { ReactNode } from "react";

import { familyLabel, type FamilyKey } from "@/config/styles";
import { t } from "@/src/i18n";
import type { LiveStatus } from "@/src/domain/tonight";
import { stockClass } from "@/src/ui/stocks";

/**
 * A family's name in its colour (D-147). The label is not optional. As a filter chip (a count or
 * a selected state) it is a pill with a hairline edge; selected, the edge is ink and a check mark
 * follows the name (DESIGN section 11).
 */
export function FamilyChip({
  family,
  count,
  selected = false,
}: {
  family: FamilyKey;
  count?: number;
  selected?: boolean;
}) {
  const pill = count !== undefined || selected;
  return (
    <span
      className={`type-label inline-flex items-center gap-1.5 ${
        pill ? `rounded-pill px-3 py-1.5 ${selected ? "border-ink border-2" : "chip-edge"}` : ""
      } ${stockClass(family)}`}
    >
      {familyLabel(family)}
      {count === undefined ? null : ` ${count}`}
      {selected ? <span aria-hidden="true">&#10003;</span> : null}
    </span>
  );
}

/** The time stamped in the rail, in tabular figures so the column lines up. */
export function StampedTime({ time, small = false }: { time: string; small?: boolean }) {
  return <span className={small ? "type-stamp-sm" : "type-stamp"}>{time}</span>;
}

/**
 * The live status line. "On now" is spot text after a small spot dot; everything else is ink, and
 * semibold once the night is under an hour away.
 */
export function StatusLine({ status, urgent = false }: { status: LiveStatus; urgent?: boolean }) {
  if (status.kind === "on_now") {
    return (
      <p className="type-status text-spot inline-flex items-center gap-2">
        <span aria-hidden="true" className="bg-spot inline-block size-2 rounded-full" />
        {status.text}
      </p>
    );
  }
  // Weight 700 once the night is under an hour away (DESIGN section 4). The caller knows the
  // start time, so it passes the fact in; matching an English prefix here would break the moment
  // the copy changed, and D-038 puts the copy in src/i18n rather than in a condition.
  const heavy = urgent || status.kind === "ending";
  return <p className={`type-status text-ink ${heavy ? "font-semibold" : ""}`}>{status.text}</p>;
}

/** An hour on the bill, in small capitals with a hairline (D-147: only hours with listings). */
export function HourMarker({ label }: { label: string }) {
  return (
    <h2 className="grid-cols-rail grid items-center gap-3 px-4 pt-1.5 pb-1">
      {/* The hour is the heading's name: "Starting at 8pm" over an hour where nothing starts
          said something untrue (review, 2026-09-28). */}
      <span className="type-marker text-toner">{label}</span>
      <span aria-hidden="true" className="bg-halftone h-px" />
    </h2>
  );
}

/** Now: a small spot label and a 1px spot rule across the full width (D-147). */
export function NowRule({ time }: { time: string }) {
  return (
    <div className="py-2" role="separator" aria-label={t("a11y.nowMarker", { time })}>
      {/*
        The tab sizes to its label rather than to the 5ch rail: DESIGN section 6 draws it as
        `>NOW 7:42<====`, wider than the rail and eating into the rule. Clamped to 5ch it showed a
        broken clock ("Now 4:1") on the one element the design calls the loudest thing on the page.
      */}
      <div className="grid grid-cols-[auto_1fr] items-center gap-3 px-4">
        <span className="text-spot type-stamp-xs whitespace-nowrap">
          {t("home.now.marker", { time })}
        </span>
        <span aria-hidden="true" className="bg-spot h-px" />
      </div>
    </div>
  );
}

/**
 * A section head: small capitals in toner with a hairline running off to the right. The detail page spaces
 * its heads 32px apart (the default); the bill passes the hour marker's own rhythm instead, so
 * the "Time not listed" head does not add a gap on top of the last hour (review, 2026-09-28).
 */
export function SectionHead({
  children,
  className = "mt-8",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 className={`${className} grid grid-cols-[auto_1fr] items-center gap-3`}>
      <span className="type-marker text-toner">{children}</span>
      <span aria-hidden="true" className="bg-halftone h-px" />
    </h2>
  );
}

/** A card, a marker and the next card are separated by a hairline. No boxes anywhere. */
export function Hairline() {
  return <div aria-hidden="true" className="bg-halftone h-px" />;
}

/**
 * A link that leaves the app. Every one of them opens in a new tab, and a new tab is a thing a
 * screen reader has to be told about before it happens (WCAG 2.2 3.2.5), so the announcement is
 * part of the component rather than something nine call sites remember to add. `label` is the
 * words a dancer hears; `children` is what they see, which is usually the same string but can be
 * a row of spans.
 */
export function ExternalLink({
  href,
  label,
  className,
  children,
}: {
  href: string;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={t("a11y.externalLink", { label })}
    >
      {children ?? label}
    </a>
  );
}
