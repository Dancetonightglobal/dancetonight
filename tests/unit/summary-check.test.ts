// The summary post-check and the facts a summary is written from (PLAN 8.3, D-109).

import { describe, expect, it } from "vitest";

import { checkSummary } from "@/src/domain/summary-check";
import { summaryFacts, summaryHash, type SummaryRow } from "@/src/pipeline/summarize";

const NY = "America/New_York";
const row: SummaryRow = {
  title: "Midtown Swings",
  listingType: "social",
  styles: ["lindy_hop"],
  nightDate: "2026-10-06",
  tz: NY,
  doorsAt: null,
  lessonAt: new Date("2026-10-07T01:00:00Z"),
  dancingAt: new Date("2026-10-07T01:00:00Z"),
  endsAt: new Date("2026-10-07T04:00:00Z"),
  prices: [
    { label: "General", amount: 25, currency: "USD" },
    { label: "Danznik Members", amount: 20, currency: "USD" },
  ],
  isFree: false,
  level: null,
  partnerRequired: false,
  ageMin: null,
  dressCode: null,
  floor: null,
  indoorOutdoor: null,
  music: { djs: ["DJ Ryan Swift"], bands: [], genreMix: null, liveMusic: false },
  crowdSizeHint: null,
  venueName: "Danznik Studios",
  neighborhood: "Midtown",
  organizerName: null,
};
const facts = summaryFacts(row);
const text = JSON.stringify(facts);

describe("summaryFacts", () => {
  it("gives the night's words a summary can repeat, and no date", () => {
    expect(facts).toMatchObject({
      title: "Midtown Swings",
      kind: "social",
      weekday: "Tuesday",
      lesson: "9pm",
      dancing: "9pm",
      ends: "12am",
      venue: "Danznik Studios",
      prices: ["General: $25", "Danznik Members: $20"],
      partner: "no partner needed",
      djs: ["DJ Ryan Swift"],
    });
    expect(text).not.toContain("2026");
  });
  it("is the same for next week's night, so one summary serves both", () => {
    expect(summaryHash(summaryFacts({ ...row, nightDate: "2026-10-13" }))).toBe(summaryHash(facts));
  });
});

describe("checkSummary", () => {
  const good =
    "Midtown Swings is a Tuesday lindy hop social at Danznik Studios in Midtown. DJ Ryan Swift plays from 9pm to 12am. General entry is $25, and Danznik Members pay $20.";
  it("keeps a summary whose numbers and names are all in the facts", () => {
    expect(checkSummary(good, text)).toEqual({ ok: true, reason: null });
  });
  it("refuses a number the facts do not have", () => {
    expect(checkSummary(good.replace("$25", "$30"), text).reason).toBe('number "30"');
    // "1" is not taken from "12".
    expect(checkSummary(good.replace("12am", "1am"), text).reason).toBe('number "1"');
  });
  it("refuses a name the facts do not have, at a sentence's start too", () => {
    expect(checkSummary(good.replace("Danznik Studios", "Swing Cafe"), text).reason).toBe(
      'name "Cafe"',
    );
    expect(checkSummary(good.replace("DJ Ryan Swift plays", "Frankie plays"), text).reason).toBe(
      'name "Frankie"',
    );
  });
  it("lets a sentence open with an ordinary word", () => {
    expect(checkSummary(`${good.split(". ")[0]}. Expect DJ Ryan Swift from 9pm.`, text).ok).toBe(
      true,
    );
  });
  it("lets a sentence open with organised, hosted, presented or run (HK K-97)", () => {
    const first = good.split(". ")[0];
    for (const opener of ["Organized", "Organised", "Hosted", "Presented", "Run"]) {
      expect(checkSummary(`${first}. ${opener} by DJ Ryan Swift from 9pm.`, text).ok).toBe(true);
    }
    // Still a name when it is not the sentence's first word.
    expect(checkSummary(`${first}. DJ Ryan Swift Hosted from 9pm.`, text).reason).toBe(
      'name "Hosted"',
    );
  });
  it("wants 2 or 3 sentences", () => {
    expect(checkSummary("Midtown Swings is a social at Danznik Studios.", text).reason).toBe(
      "1 sentence(s)",
    );
    expect(checkSummary(`${good} Midtown Swings is on Tuesday.`, text).reason).toBe(
      "4 sentence(s)",
    );
  });
});

// D-819 (Pune read 3, 2026-11-10): "Ov3rdrive" was checked as the name "Ov", which the facts do not have.
describe("names with digits", () => {
  const facts = "Bass Tapri feat. Dreokt, Ov3rdrive, Ankan & more. Club night. Antisocial Pune.";
  it("checks a name with a digit as one word", () => {
    expect(
      checkSummary(
        "Bass Tapri is a club night at Antisocial Pune. Dreokt, Ov3rdrive and Ankan play.",
        facts,
      ),
    ).toEqual({ ok: true, reason: null });
  });
  it("still refuses a name with a digit the facts do not have", () => {
    expect(
      checkSummary(
        "Bass Tapri is a club night at Antisocial Pune. Dreokt and Ov3rload play.",
        facts,
      ).reason,
    ).toBe('name "Ov3rload"');
  });
});
