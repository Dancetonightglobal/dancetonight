import type { ProvenanceMethod } from "@/src/adapters/types";
import { screenTitleWeekday, type NotAnEvent } from "@/src/domain/listing-screen";

/**
 * A title naming its weekly day ("Tango Mondays", "Sambroso Cuban Sundays") on another night is misdated, on a site
 * that prints its clocks wrong (theronda.us, D-589) or in a model read of a page (ruedalibre.co.uk, D-878: the read
 * sometimes wrote the Sunday night on weekdays). Feeds and APIs carry their own dates and are not screened.
 */
export function wrongWeekdayScreen(
  title: string,
  nightDate: string,
  read: { startTimesShifted?: boolean; method: ProvenanceMethod },
): NotAnEvent | null {
  if (!read.startTimesShifted && read.method !== "llm") return null;
  return screenTitleWeekday(title, nightDate);
}
