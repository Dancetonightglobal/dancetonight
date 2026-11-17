// D-754: split a lesson that ends before the dancing into two events
// Example: nycwcs "WCS Level 2 with Sophie" lists doors 7pm, dancing 9pm, ends 8pm
// Creates a lesson 7-8pm and a dancing from 9pm
import type { HarvestedListing } from "@/src/adapters/types";

export function splitLessonBeforeDancing(harvested: HarvestedListing): HarvestedListing[] {
  const { listing, externalId } = harvested;
  const { lesson_time, doors_time, dancing_time, end_time, listing_type } = listing;

  // Determine first time: lesson_time over doors_time
  const first = lesson_time ?? doors_time;

  // All three times must be present
  if (!first || !dancing_time || !end_time) {
    return [harvested];
  }

  // Helper to convert "HH:MM" to minutes since midnight
  const toMinutes = (time: string): number => {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);
    return hours * 60 + minutes;
  };

  // Adjust times before 06:00 by adding 24 hours
  const adjustIfEarly = (time: string): number => {
    const mins = toMinutes(time);
    return mins < 6 * 60 ? mins + 24 * 60 : mins;
  };

  const firstAdjusted = adjustIfEarly(first);
  const dancingAdjusted = adjustIfEarly(dancing_time);
  const endAdjusted = adjustIfEarly(end_time);

  // Check conditions: first < end <= dancing
  if (!(firstAdjusted < endAdjusted && endAdjusted <= dancingAdjusted)) {
    return [harvested];
  }

  // Create lesson listing
  const lessonListing = {
    ...listing,
    listing_type: "class" as const,
    lesson_time: first,
    doors_time: null,
    dancing_time: null,
    end_time: end_time,
  };

  // Create dancing listing
  const dancingListingType = listing_type === "class" ? "social" : listing_type;
  const dancingListing = {
    ...listing,
    listing_type: dancingListingType,
    dancing_time: dancing_time,
    doors_time: null,
    lesson_time: null,
    end_time: null,
  };

  // Create external IDs
  const lessonExternalId = externalId ? `${externalId}:lesson` : null;
  const dancingExternalId = externalId ? `${externalId}:dancing` : null;

  // Return two new HarvestedListing objects
  return [
    {
      ...harvested,
      listing: lessonListing,
      externalId: lessonExternalId,
    },
    {
      ...harvested,
      listing: dancingListing,
      externalId: dancingExternalId,
    },
  ];
}
