// Google place IDs never to store for a venue of a given name (D-077). Kept by hand.
//
// The lookup in `src/pipeline/place-ids.ts` stores an id only when two free IDs-only questions
// agree (D-071, D-077). That can still be wrong: Google may file a venue under a neighbour, and
// both questions then name the neighbour. An id listed here is never stored for that venue name,
// and a stored one is cleared on the next run, whatever Google answers (the check question is
// still asked once, so the report says whether it alone would have caught the id). It is the
// fallback for a case someone has audited by hand, never the first fix.
//
// How to add one: open `https://www.google.com/maps/place/?q=place_id:<id>` and read the place's
// own name (the page's h1). Add a row only when that name is another place, and say in `audited`
// who looked, when, what the page said, and which ingest run stored it. The venue name is matched
// ignoring case, accents and punctuation. Nothing here is ever sent to Google.

export interface PlaceIdExclusion {
  /** The venue's name as our `venues` row writes it. */
  venueName: string;
  /** The place ID that opens another place. */
  placeId: string;
  /** How the id was checked: who, when, what the Maps page showed, where the id came from. */
  audited: string;
}

export const PLACE_ID_EXCLUSIONS: readonly PlaceIdExclusion[] = [
  {
    venueName: "The Rooftop at Pier 17",
    placeId: "ChIJEUK6-jxawokR25HbqniSoiY",
    audited:
      "2026-09-28, the run 26 place-ID audit: the Maps link for this id opened the h1 'Pier 16'. " +
      "Ingest run 26 stored it (name and address, recorded fixture d9895f827c), and run 27's name " +
      "check in the same 200 m box gave it again (recorded fixture d4a0acb56f), so it was kept. " +
      "The Rooftop is at Pier 17, 89 South St (Overture 2026-09-23.0: 40.705498, -74.001656).",
  },
];
