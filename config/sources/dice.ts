// DICE city browse pages (D-139, D-148, D-197): one source per page, shared by every metro.
import type { SeedSource } from "@/config/sources/nyc";

/**
 * DICE genre pages, each its own page of that genre's ~22 soonest nights, so together they reach
 * weeks ahead where the DJ and Party pages see only tonight on a weekend (owner, 2026-10-17;
 * D-148). Dance-floor genres only; a night on several pages merges as one (D-146).
 */
export const DICE_GENRES: readonly [path: string, label: string][] = [
  // DJ genres
  ["dj/house", "House"],
  ["dj/deephouse", "Deep house"],
  ["dj/tech-house", "Tech house"],
  ["dj/techno", "Techno"],
  ["dj/hard_techno", "Hard techno"],
  ["dj/disco", "Disco"],
  ["dj/italodisco", "Italo disco"],
  ["dj/funk", "Funk"],
  ["dj/soul", "Soul"],
  ["dj/latin", "Latin"],
  ["dj/latin_tropical", "Latin tropical"],
  ["dj/reggaeton", "Reggaeton"],
  ["dj/afrobeats", "Afrobeats"],
  ["dj/afro_caribbean", "Afro-Caribbean"],
  ["dj/afrohouse", "Afro house"],
  ["dj/amapiano", "Amapiano"],
  ["dj/dancehall", "Dancehall"],
  ["dj/soca", "Soca"],
  ["dj/hiphop", "Hip hop"],
  ["dj/rnb", "R&B"],
  ["dj/garage", "Garage"],
  ["dj/ukg", "UK garage"],
  ["dj/jersey_club", "Jersey club"],
  ["dj/dnb", "Drum and bass"],
  ["dj/edm", "EDM"],
  ["dj/trance", "Trance"],
  ["dj/melodic_house", "Melodic house"],
  ["dj/lgbtq+", "LGBTQ+ (DJ)"],
  ["dj/dance", "Dance (DJ)"],
  // Party genres
  ["party/salsa", "Salsa party"],
  ["party/latin", "Latin party"],
  ["party/reggaeton", "Reggaeton party"],
  ["party/afrobeats", "Afrobeats party"],
  ["party/amapiano", "Amapiano party"],
  ["party/baile_funk", "Baile funk"],
  ["party/dancehall", "Dancehall party"],
  ["party/disco", "Disco party"],
  ["party/house", "House party"],
  ["party/hiphop", "Hip hop party"],
  ["party/pop", "Pop party"],
  ["party/emo_party", "Emo party"],
  ["party/kpop", "K-pop party"],
  ["party/lgbtq+", "LGBTQ+ party"],
  ["party/roller_skating", "Roller skating"],
  ["party/dance", "Dance party"],
];

/**
 * A DICE browse page: every night on it is a DJ or party night, so the DJ-night style, no screen.
 */
export function diceSources(
  browse: string,
  city: string,
  genres: readonly (readonly [string, string])[] = DICE_GENRES,
): SeedSource[] {
  const sources: SeedSource[] = [
    {
      url: `${browse}/dj`,
      kind: "ticketing_api",
      trustTier: "ticketing",
      platform: "dice",
      styles: ["dj_night"],
      label: `DICE ${city}: DJ`,
    },
    {
      url: `${browse}/party`,
      kind: "ticketing_api",
      trustTier: "ticketing",
      platform: "dice",
      styles: ["dj_night"],
      label: `DICE ${city}: Party`,
    },
  ];
  for (const [path, label] of genres) {
    sources.push({
      url: `${browse}/${path}`,
      kind: "ticketing_api",
      trustTier: "ticketing",
      platform: "dice",
      styles: ["dj_night"],
      label: `DICE ${city}: ${label}`,
    });
  }
  return sources;
}
