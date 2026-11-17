// The search control. A plain GET form, so it works with no JavaScript, lands in the URL and
// leaves an entry in the back stack like every other piece of home state.
// With JavaScript, the box searches as you type (debounced), Enter and the no-JS form still work,
// and the button becomes "Clear" when there is text.
//
// A search that names a metro we list moves there (resolvePlace). Any other search filters the
// night's listings by event name, venue, neighbourhood, dance style, DJ or band. Submitting an
// empty box clears the search.

import { carriedParams, type RawParams } from "./params";
import { LiveSearchBox } from "./LiveSearchBox";

/** Params the form owns, so they are not also carried as hidden inputs. */
const OWNED = ["place", "filters"];

// basis-full below 640px so the location row wraps instead of overhanging a 320px viewport.
export function SearchPlace({ params }: { params: RawParams }) {
  const typed = typeof params["place"] === "string" ? params["place"] : undefined;
  return (
    <form
      action="/"
      method="get"
      role="search"
      className="flex w-full min-w-0 basis-full items-stretch gap-2 sm:w-auto sm:flex-1 sm:basis-auto"
    >
      {carriedParams(params, OWNED).map(([name, value], index) => (
        <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
      ))}
      <LiveSearchBox typed={typed} />
    </form>
  );
}
