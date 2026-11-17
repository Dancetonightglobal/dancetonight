import { ownSite } from "@/src/domain/dedupe";
import { normalizeForMatch } from "@/config/styles";

/**
 * D-830: the sites that are a ticket seller for several venues, not one organiser's own: a site whose
 * venue pages (`SeedSource.venuePage`) name two or more places, by `venueAddress` or, without one, by
 * label (mandalatickets.com: Rakata, Santito, La Vaquita...). Several nights of one club under their own
 * labels at one address (Papa Dubai's parties, the Fringe Club and its workshops) are still one site.
 * D-808 takes such a site's venue off; the organiser link must not read it as one organiser's site
 * either, or two clubs on one night merge.
 */
export function sharedTicketSites(
  seeds: readonly { url: string; venuePage?: boolean; label?: string; venueAddress?: string }[],
): Set<string> {
  const places = new Map<string, Set<string>>();
  for (const seed of seeds) {
    if (!seed.venuePage) continue;
    const site = ownSite(seed.url);
    if (!site) continue;
    const place = normalizeForMatch(seed.venueAddress?.trim() || seed.label || seed.url);
    places.set(site, (places.get(site) ?? new Set()).add(place));
  }
  return new Set([...places].filter(([, set]) => set.size > 1).map(([site]) => site));
}
