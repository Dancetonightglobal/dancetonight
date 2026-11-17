// Seven nights, tonight and the next six (D-075), each with its count. Choosing one changes the
// list, relabels the header and drops the now rule, because there is no now on a night that has
// not begun. A night the home page opens beyond these (tonight + 7 to + 12, from a shared link or
// the event page's way back) marks no item here: nothing is aria-current, the strip is not
// scrolled (intoViewScript finds no chosen item), and the headline and the tab name the date.
//
// A day's link keeps the filters that are on, and its count is that day's list under them
// ("On now" aside, which only tonight, the first day, can have), so the number never promises
// what the tap does not give (review, 2026-09-28). A next/link with scroll={false}, like the
// filter row: the picker stays where the dancer's thumb is.

import Link from "next/link";

import type { DayCount } from "@/src/data/repository";
import { t } from "@/src/i18n";
import type { NightDate } from "@/src/domain/tonight";

import { intoViewScript } from "./into-view";
import { hrefWith, type RawParams } from "./params";
import { PendingBar } from "./PendingBar";

const DAY_ROW_ID = "day-picker";

export function DayPicker({
  days,
  selected,
  params,
}: {
  days: readonly DayCount[];
  selected: NightDate;
  params: RawParams;
}) {
  return (
    <nav aria-label={t("home.day.label")} className="mt-4 px-4 border-halftone border-b">
      <ul id={DAY_ROW_ID} role="list" className="-mx-4 flex gap-1 overflow-x-auto px-4 scroll-px-4">
        {days.map((day, i) => {
          const current = day.nightDate === selected;
          return (
            <li key={day.nightDate}>
              <Link
                href={hrefWith(params, {
                  day: day.nightDate,
                  filters: null,
                  ...(i === 0 ? {} : { now: null }),
                })}
                scroll={false}
                prefetch={false}
                rel="nofollow"
                aria-current={current ? "page" : undefined}
                // "Wed, Sep 30 7" read as a date; the count is said with its unit.
                aria-label={t("home.day.option", { day: day.label, count: day.count })}
                className={`type-label min-h-11 flex items-center whitespace-nowrap px-3 ${
                  current
                    ? "text-ink border-ink border-b-2 font-semibold"
                    : "text-toner border-b-2 border-transparent"
                }`}
              >
                <span>{day.label}</span>
                <span className="text-toner ms-1.5 font-normal">{day.count}</span>
                <PendingBar />
              </Link>
            </li>
          );
        })}
      </ul>
      {/* The chosen night stays in sight after the page is drawn again (review, 2026-09-28). */}
      <script dangerouslySetInnerHTML={{ __html: intoViewScript(DAY_ROW_ID) }} />
    </nav>
  );
}
