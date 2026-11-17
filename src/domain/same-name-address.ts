// D-843: two venue rows with one whole name whose addresses give one postcode after the street line are one
// place up to SAME_NAME_ADDRESS_METRES, when their street lines also match (the caller checks that): NYC
// "Vybz Astoria", 2826 Steinway St, NY 11103 / NY, 11103-3332, geocoded 453 m apart (daily 2026-11-10).
// One name and street line with no postcode on either side keeps D-765's limit (Oslo Hackney, 400 m apart).

function wholeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The postcode written after the street line: a US ZIP (+4 dropped) or a UK postcode, else null. */
export function postcodeAfterStreet(address: string): string | null {
  const comma = address.indexOf(",");
  if (comma === -1) return null;
  const rest = address.slice(comma + 1);
  const uk = rest.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i);
  if (uk) return `${uk[1] ?? ""}${uk[2] ?? ""}`.toUpperCase();
  const zip = rest.match(/\b(\d{5})(?:-\d{4})?\b/);
  return zip?.[1] ?? null;
}

export function sameNameAndPostcode(
  aName: string,
  bName: string,
  aAddress: string | undefined,
  bAddress: string | undefined,
): boolean {
  const na = wholeName(aName);
  if (na === "" || na !== wholeName(bName)) return false;
  if (!aAddress || !bAddress) return false;
  const pa = postcodeAfterStreet(aAddress);
  return pa !== null && pa === postcodeAfterStreet(bAddress);
}
