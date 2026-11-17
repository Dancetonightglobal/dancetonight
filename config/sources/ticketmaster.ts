/**
 * Ticketmaster titles per metro (by metro slug) that pass every screen but are not dance nights (a rock
 * concert typed as a club night), each checked by the metro lead on the live site (D-519 E1/E2). The
 * Ticketmaster search is metro-wide, so there is no seed to carry a `notDanceNights` list.
 */
export const TM_NOT_DANCE_NIGHTS: Readonly<Record<string, readonly string[]>> = {
  // Franklin Music Hall rock concert, 2026-11-05 (run 41205630921).
  philadelphia: [
    "Alter Bridge w/ Big Wreck",
    // TM venue wrong (Philadelphia Sinfonia, 11/06, run 41217433517); the NOTO row is kept.
    "Valentino Khan - Ages 21+",
  ],
  // A Hatsune Miku concert/expo on 2026-11-19 (Berlin daily check 2026-11-13, coverage-152 section K).
  berlin: ["DIGITAL STARS @MIKU EXPO EUROPE in Berlin"],
};
