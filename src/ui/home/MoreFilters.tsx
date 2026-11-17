// The more-filters sheet: a halftone surface bounded by a toner hairline (never by its own
// tone), carrying the rest of the filters ListingFilters names. It is a plain GET form, so
// applying it is a navigation: the URL holds the state, the back button undoes it and the view
// is shareable. Opening and closing the sheet are links for the same reason.

import { t } from "@/src/i18n";

import { formatMoney, formatRadius } from "./format";
import {
  PRICE_CHOICES,
  RADIUS_CHOICES,
  carriedParams,
  hrefWith,
  type HomeQuery,
  type RawParams,
} from "./params";

/** The params this form owns. Everything else rides along as a hidden input. */
const OWNED = [
  "r",
  "price",
  "free",
  "lvl",
  "lesson",
  "np",
  "age",
  "live",
  "now",
  "conf",
  "filters",
];

function Switch({ name, on, label }: { name: string; on: boolean; label: string }) {
  return (
    <label className="type-body text-ink min-h-11 flex items-center gap-3">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={on}
        className="accent-ink size-5"
      />
      {label}
    </label>
  );
}

function Radio({
  name,
  value,
  checked,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
}) {
  return (
    <label className="type-body text-ink min-h-11 flex items-center gap-3">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        className="accent-ink size-5"
      />
      {label}
    </label>
  );
}

export function MoreFilters({
  query,
  params,
  locale,
  currency,
  defaultRadiusKm,
}: {
  query: HomeQuery;
  params: RawParams;
  locale: string;
  currency: string;
  defaultRadiusKm: number;
}) {
  const f = query.filters;
  const priceValue =
    f.free === true ? "free" : f.maxPrice === undefined ? "any" : String(f.maxPrice);
  // The metro's own radius is always one of the choices, so the sheet can always get back to it.
  const radii = [...new Set([...RADIUS_CHOICES, defaultRadiusKm])].sort((a, b) => a - b);

  return (
    <section
      id="more-filters"
      aria-label={t("home.filters.title")}
      className="border-halftone mt-3 border-y px-4 py-4 lg:rounded-control lg:border"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="type-marker text-ink">{t("home.filters.title")}</h2>
        <a
          href={hrefWith(params, { filters: null })}
          className="type-label text-ink min-h-11 flex items-center underline underline-offset-4"
        >
          {t("home.filters.close")}
        </a>
      </div>

      <form action="/" method="get" className="mt-2">
        {carriedParams(params, OWNED).map(([name, value], index) => (
          <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
        ))}

        <fieldset className="mt-2">
          <legend className="type-label text-toner">{t("home.filters.radius")}</legend>
          <div className="flex flex-wrap gap-x-6">
            {radii.map((km) => (
              <Radio
                key={km}
                name="r"
                value={String(km)}
                checked={query.radiusKm === km}
                label={t("home.filters.radiusWithin", { distance: formatRadius(km, locale) })}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-2">
          <legend className="type-label text-toner">{t("home.filters.price")}</legend>
          <div className="flex flex-wrap gap-x-6">
            <Radio
              name="price"
              value="any"
              checked={priceValue === "any"}
              label={t("home.filters.anyPrice")}
            />
            <Radio
              name="price"
              value="free"
              checked={priceValue === "free"}
              label={t("home.filters.free")}
            />
            {PRICE_CHOICES.map((amount) => (
              <Radio
                key={amount}
                name="price"
                value={String(amount)}
                checked={priceValue === String(amount)}
                label={t("home.filters.under", { price: formatMoney(amount, currency, locale) })}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-2">
          <legend className="type-label text-toner">{t("home.filters.age")}</legend>
          <div className="flex flex-wrap gap-x-6">
            {/* A way back to no age filter, as Price has "Any price" (review, 2026-09-28). */}
            <Radio
              name="age"
              value="any"
              checked={f.age === undefined}
              label={t("home.filters.anyAge")}
            />
            <Radio
              name="age"
              value="all"
              checked={f.age === "all"}
              label={t("home.filters.ageAll")}
            />
            <Radio name="age" value="18" checked={f.age === 18} label={t("home.filters.age18")} />
            <Radio name="age" value="21" checked={f.age === 21} label={t("home.filters.age21")} />
          </div>
        </fieldset>

        <div className="mt-2 flex flex-wrap gap-x-6">
          <Switch
            name="lvl"
            on={f.beginnerFriendly === true}
            label={t("home.filters.beginnerFriendly")}
          />
          <Switch
            name="lesson"
            on={f.lessonIncluded === true}
            label={t("home.filters.lessonIncluded")}
          />
          <Switch
            name="np"
            on={f.noPartnerNeeded === true}
            label={t("home.filters.noPartnerNeeded")}
          />
          <Switch name="live" on={f.liveMusic === true} label={t("home.filters.liveMusic")} />
          {/* Only tonight has a now; on another night the switch could only empty the list. */}
          {query.isTonight ? (
            <Switch name="now" on={f.onNow === true} label={t("home.filters.onNow")} />
          ) : null}
          <Switch
            name="conf"
            on={f.confirmedOnly === true}
            label={t("home.filters.confirmedOnly")}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            className="bg-ink text-paper type-button rounded-control min-h-11 px-4"
          >
            {/* The form cannot count what the ticked boxes would give before it is sent, so the
                button promises no number (review, 2026-09-28). */}
            {t("home.filters.applyPlain")}
          </button>
          <a
            href={hrefWith(params, {
              r: null,
              price: null,
              free: null,
              lvl: null,
              lesson: null,
              np: null,
              age: null,
              live: null,
              now: null,
              conf: null,
            })}
            className="type-label text-ink min-h-11 flex items-center underline underline-offset-4"
          >
            {t("home.filters.clear")}
          </a>
        </div>
      </form>
    </section>
  );
}
