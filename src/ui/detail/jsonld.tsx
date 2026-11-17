// schema.org Event for this one night. D-033: single-event leaf pages only, never a list page.
// The JSON is escaped so a venue or organiser name can never close the script tag.

import { isPlaced, type Listing } from "@/src/domain/listing";
import { eventJsonLd } from "@/src/ui/detail/format";

export function EventJsonLd({ listing, url }: { listing: Listing; url: string }) {
  // An Event's location is required for Google's event results, and a listing with no venue has
  // none to give; no Event is claimed rather than one with an invented place (D-082).
  if (!isPlaced(listing)) return null;
  const json = JSON.stringify(eventJsonLd(listing, url))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
