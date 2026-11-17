import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-883 (daily check 2026-11-13, Paris Mia Mao): a show page titled "23:59 : Protokseed, ..." beside the agenda's
// "Protokseed, ..." made a second card. A leading clock time and its separator are not part of the title.
describe("tidyTitle drops a leading clock time (D-883)", () => {
  it.each([
    [
      "23:59 : Protokseed, Ling Ling B2b Enko, Acidpach & More",
      "Protokseed, Ling Ling B2b Enko, Acidpach & More",
    ],
    ["22h00 - Soirée Salsa", "Soirée Salsa"],
    ["9:30 | Morning Swing", "Morning Swing"],
  ])("%s -> %s", (input, out) => {
    expect(tidyTitle(input, null)).toBe(out);
  });

  it.each([
    "24:7 Club Night",
    "23:59",
    "23:59 : 2026",
    "Club 23:59 : Late Session",
    "7:30pm Salsa Social",
    "12:00 Noon Tango",
  ])("keeps %s", (input) => {
    expect(tidyTitle(input, null)).toBe(input);
  });
});
