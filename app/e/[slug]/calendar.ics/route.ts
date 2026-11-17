// "Add to calendar" (DESIGN.md section 7, D-069): the night's VEVENT, served as text/calendar at
// /e/{slug}/calendar.ics. The button is a plain link to this route, because iOS Safari hands a
// text/calendar navigation to Calendar's add-event sheet, where a blob download lands in Files.
// Desktop browsers, which cannot show text/calendar, save it under the filename below. A merged
// listing's file redirects to the survivor's, in proxy.ts (D-092).

import { connection } from "next/server";

import { appNow } from "@/src/config/clock";
import { getRepository } from "@/src/data";
import { t } from "@/src/i18n";
import { icsFilename, icsFor } from "@/src/ui/detail/format";
import { pageUrl } from "@/src/ui/detail/page-url";

export async function GET(_request: Request, context: RouteContext<"/e/[slug]/calendar.ics">) {
  // The file carries DTSTAMP and the listing's current state, so it is built per request.
  await connection();
  const { slug } = await context.params;
  const now = appNow();
  const listing = await getRepository().getBySlug(slug, now);
  if (listing === null) {
    return new Response(t("errors.listingNotFound"), {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // Our slugs are already safe; the filter keeps a stray quote or line break out of the header.
  const filename = icsFilename(listing).replace(/[^\w.-]/g, "-");
  return new Response(icsFor(listing, await pageUrl(slug), now), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
