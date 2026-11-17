// D-886 (daily check 2026-11-16, Raleigh): Duke's arts office, box office and film program put plays, concerts and
// screenings on the page; discovery skips them like a campus calendar (D-846). A dance department is still probed.
import { describe, expect, it } from "vitest";

import { hostSkip } from "@/src/pipeline/discovery/hosts";

const campus = "a university's campus-wide calendar";

describe("D-886 university arts, ticket and film hosts", () => {
  it.each([
    "arts.duke.edu",
    "tickets.duke.edu",
    "cinematicarts.duke.edu",
    "boxoffice.temple.edu",
    "film.ox.ac.uk",
  ])("skips %s", (host) => {
    expect(hostSkip(host)?.reason).toBe(campus);
  });

  it.each(["dance.duke.edu", "smarts.duke.edu", "kaufman.usc.edu", "duke.edu", "arts.example.com"])(
    "probes %s",
    (host) => {
      expect(hostSkip(host)).toBeNull();
    },
  );
});
