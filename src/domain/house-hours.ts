import type { HarvestedListing } from "@/src/adapters/types";

export interface HouseHours {
  /** "HH:MM", 24-hour; before 06:00 is after midnight of the listed night. */
  start: string;
  /** "HH:MM", 24-hour; left out when the venue states no closing time ("10 pm - Close"). */
  end?: string;
  /** Weekdays, 0 = Sunday ... 6 = Saturday, of the listing's local_date, or of every day its weekly rule names. */
  days: readonly number[];
  checked: string;
}

export function withHouseHours(
  listing: HarvestedListing,
  hours: HouseHours | undefined,
): { listing: HarvestedListing; applied: boolean } {
  if (!hours) {
    return { listing, applied: false };
  }

  // Check if any time is already stated
  if (
    listing.listing.doors_time != null ||
    listing.listing.lesson_time != null ||
    listing.listing.dancing_time != null
  ) {
    return { listing, applied: false };
  }

  const { local_date } = listing.listing;
  const { recurrence } = listing;

  // Path 1: local_date is set (existing dated-listing behaviour)
  if (local_date) {
    // Parse the date to get weekday
    const match = local_date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return { listing, applied: false };
    }
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const weekday = date.getUTCDay(); // 0 = Sunday, 6 = Saturday

    if (!hours.days.includes(weekday)) {
      return { listing, applied: false };
    }

    // Apply house hours
    const updatedListing: HarvestedListing = {
      ...listing,
      listing: {
        ...listing.listing,
        dancing_time: hours.start,
        end_time: listing.listing.end_time ?? hours.end ?? null,
      },
    };

    return { listing: updatedListing, applied: true };
  }

  // Path 2: local_date null/empty and recurrence non-null (weekly rule)
  if (!local_date && recurrence) {
    const weekdays = weekdaysFromRecurrence(recurrence);
    if (weekdays === null) {
      return { listing, applied: false };
    }
    // Apply only when EVERY weekday of the rule is in hours.days
    if (!weekdays.every((day) => hours.days.includes(day))) {
      return { listing, applied: false };
    }

    // Apply house hours, recurrence unchanged
    const updatedListing: HarvestedListing = {
      ...listing,
      listing: {
        ...listing.listing,
        dancing_time: hours.start,
        end_time: listing.listing.end_time ?? hours.end ?? null,
      },
    };

    return { listing: updatedListing, applied: true };
  }

  // local_date null and recurrence null: unchanged
  return { listing, applied: false };
}

function weekdaysFromRecurrence(
  recurrence: NonNullable<HarvestedListing["recurrence"]>,
): number[] | null {
  const rrule = recurrence.rrule.toUpperCase();
  // Extract BYDAY part
  const bydayMatch = rrule.match(/BYDAY=([^;]+)/);
  if (bydayMatch) {
    const dayCodes = (bydayMatch[1] ?? "").split(",");
    const days: number[] = [];
    for (const code of dayCodes) {
      // Strip numeric prefix like "1FR", "-1SA"
      const stripped = code.replace(/^[+-]?\d+/, "");
      const day = dayCodeToNumber(stripped);
      if (day === null) {
        return null; // unknown code -> treat as not matching
      }
      days.push(day);
    }
    return days;
  }

  // No BYDAY: use weekday of dtstartLocal's date
  const dtstart = recurrence.dtstartLocal;
  const dateMatch = dtstart.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dateMatch) {
    return null;
  }
  const date = new Date(
    Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])),
  );
  const weekday = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return [weekday];
}

function dayCodeToNumber(code: string): number | null {
  switch (code) {
    case "SU":
      return 0;
    case "MO":
      return 1;
    case "TU":
      return 2;
    case "WE":
      return 3;
    case "TH":
      return 4;
    case "FR":
      return 5;
    case "SA":
      return 6;
    default:
      return null;
  }
}
