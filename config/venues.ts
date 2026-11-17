// Which Overture places seed the `venues` table (D-028), and what each category says about a
// dance floor. Categories are Overture's `taxonomy.primary` values, checked against the
// 2026-09-23.0 release for the New York box (879,064 places; counts in D-044).
//
// `yes` is a place whose business is dancing (a dance club). `unknown` is a place that often
// hosts dancing but whose floor the category alone cannot promise (a studio, an event space):
// those venues are seeded so listings can be placed on them and their websites can be probed,
// never so they appear on the site by themselves.

export type VenueKind =
  | "night_club"
  | "dance_hall"
  | "studio"
  | "bar"
  | "restaurant"
  | "community_center"
  | "outdoor"
  | "other";

export const OVERTURE_SEED_CATEGORIES: Readonly<
  Record<string, { kind: VenueKind; danceFloor: "yes" | "unknown" }>
> = {
  dance_club: { kind: "night_club", danceFloor: "yes" },
  salsa_club: { kind: "night_club", danceFloor: "yes" },
  nightlife_venue: { kind: "night_club", danceFloor: "unknown" },
  country_dance_hall: { kind: "dance_hall", danceFloor: "yes" },
  dance_studio: { kind: "studio", danceFloor: "unknown" },
  music_venue: { kind: "other", danceFloor: "unknown" },
  jazz_and_blues_venue: { kind: "other", danceFloor: "unknown" },
  event_venue: { kind: "other", danceFloor: "unknown" },
  lounge: { kind: "bar", danceFloor: "unknown" },
  // Bars (D-524, coverage - 80/81, 2026-10-31): DJ bars are much of the scene in Mumbai, Hong Kong and Philadelphia, and
  // Overture files them as bars, not clubs (Mumbai: 786 bar-family places, none seeded). Discovery reads their sites.
  bar: { kind: "bar", danceFloor: "unknown" },
  pub: { kind: "bar", danceFloor: "unknown" },
  cocktail_bar: { kind: "bar", danceFloor: "unknown" },
  hotel_bar: { kind: "bar", danceFloor: "unknown" },
  gay_bar: { kind: "bar", danceFloor: "unknown" },
  social_club: { kind: "community_center", danceFloor: "unknown" },
  community_center: { kind: "community_center", danceFloor: "unknown" },
  cultural_center: { kind: "community_center", danceFloor: "unknown" },
};

/** Overture's own confidence below which a place is not seeded. */
export const OVERTURE_MIN_CONFIDENCE = 0.5;
