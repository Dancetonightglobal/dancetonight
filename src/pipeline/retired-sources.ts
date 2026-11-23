// D-889: which stored sources a retired starting address switches off. A retirement marked `wholeSite` retires every
// page of that host in the metro ("www." or not, either scheme): discovery stores whichever listing page it found, so
// a reviewer who sees only event links (vteatro.com/obra/...) can still retire the site. It is opt-in: a retired home
// page often sits beside a seeded events page of the same site (nylindy.com, the100club.co.uk). Any other retirement
// matches its exact address only (D-047).

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const bareHost = (u: URL): string => u.hostname.toLowerCase().replace(/^www\./, "");

export interface RetiredAddress {
  url: string;
  wholeSite?: boolean;
}

/** Whether a stored source's address is retired by one retired starting address. */
export function retiredMatches(sourceUrl: string, retired: RetiredAddress): boolean {
  if (sourceUrl === retired.url) return true;
  if (!retired.wholeSite) return false;
  const s = parse(sourceUrl);
  const r = parse(retired.url);
  if (!s || !r || !/^https?:$/.test(s.protocol)) return false;
  return bareHost(s) === bareHost(r);
}
