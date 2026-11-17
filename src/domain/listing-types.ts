// The single source of truth for listing types (SPEC section 3). The tonight rule
// (src/domain/tonight.ts), the taxonomy (config/styles.ts) and the database enum
// (src/db/schema/series.ts) all derive from this list, so it cannot drift.
import { z } from "zod";

export const LISTING_TYPE_KEYS = [
  "social",
  "class",
  "club_night",
  "practica",
  "live_music_with_dancing",
  "festival_session",
  "outdoor_public",
  "jam",
  "venue_open_night",
  "other",
] as const;

export const listingTypeKeySchema = z.enum(LISTING_TYPE_KEYS);
export type ListingType = z.infer<typeof listingTypeKeySchema>;
