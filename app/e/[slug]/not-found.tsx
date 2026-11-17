// A listing we do not have, if anything in this segment calls notFound(). The page itself does
// not: in a request-time render Next answers notFound() with an empty shell that only JavaScript
// fills in, so it renders this same message itself (page.tsx, review 2026-09-28).

import { t } from "@/src/i18n";
import { MissingPage } from "@/src/ui/detail/missing-page";

export default function ListingNotFound() {
  return <MissingPage message={t("errors.listingNotFound")} />;
}
