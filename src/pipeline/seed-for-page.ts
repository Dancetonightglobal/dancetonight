import type { SeedSource } from "@/config/sources/nyc";

/**
 * The dance-night titles for a source (D-264): its own seed's, or, when its URL has no seed, those of the seed at the
 * same address without the query string and fragment (a calendar's later pages, Somewhere Nowhere 2026-11-05).
 * Only these two lists carry over: every other seed flag stays for the starting address alone.
 */
export function seedNightTitles(
  seeds: readonly SeedSource[],
  url: string,
): { danceNights: readonly string[]; notDanceNights: readonly string[] | undefined } {
  // First, try exact match
  const exactSeed = seeds.find((seed) => seed.url === url);
  if (exactSeed) {
    return {
      danceNights: exactSeed.danceNights ?? [],
      notDanceNights: exactSeed.notDanceNights,
    };
  }

  // Parse the URL to find a seed without query string
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    // Invalid URL
    return { danceNights: [], notDanceNights: undefined };
  }

  // First, try to find a seed with exact pathname match (including trailing slash)
  // and no query string
  let candidateSeed = seeds.find((seed) => {
    let seedUrl: URL;
    try {
      seedUrl = new URL(seed.url);
    } catch {
      return false;
    }

    if (seedUrl.origin !== parsedUrl.origin) {
      return false;
    }

    // Exact pathname match (including trailing slash)
    if (seedUrl.pathname !== parsedUrl.pathname) {
      return false;
    }

    // Seed must have no query string
    if (seedUrl.search !== "") {
      return false;
    }

    return true;
  });

  // If not found, try with normalized pathnames (ignoring trailing slash)
  if (!candidateSeed) {
    candidateSeed = seeds.find((seed) => {
      let seedUrl: URL;
      try {
        seedUrl = new URL(seed.url);
      } catch {
        return false;
      }

      if (seedUrl.origin !== parsedUrl.origin) {
        return false;
      }

      // Normalize pathnames by removing trailing slash
      let seedPath = seedUrl.pathname;
      let targetPath = parsedUrl.pathname;
      if (seedPath.endsWith("/")) {
        seedPath = seedPath.slice(0, -1);
      }
      if (targetPath.endsWith("/")) {
        targetPath = targetPath.slice(0, -1);
      }
      if (seedPath !== targetPath) {
        return false;
      }

      // Seed must have no query string
      if (seedUrl.search !== "") {
        return false;
      }

      return true;
    });
  }

  if (candidateSeed) {
    return {
      danceNights: candidateSeed.danceNights ?? [],
      notDanceNights: candidateSeed.notDanceNights,
    };
  }

  // No match found
  return { danceNights: [], notDanceNights: undefined };
}
