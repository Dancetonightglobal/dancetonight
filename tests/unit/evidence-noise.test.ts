import { describe, expect, it } from "vitest";
import { NON_DANCE_EVIDENCE_REGEX, withoutNonDanceMentions } from "@/src/domain/evidence-noise";

// D-845: on a mixed calendar a dance word in an organiser's affiliation or in a plot blurb's list of verbs is
// not evidence of a dance (LA daily 2026-11-10: USC "Sun to Shade" panel, threeclubs.com Buffy sing-along).

const hasDance = (s: string) => /\bdanc(?:e|es|ing)\b/i.test(s);

describe("withoutNonDanceMentions", () => {
  it("drops a dance word inside an institution's proper name", () => {
    const usc =
      "A conversation with Jennifer Lott (USC Kaufman School of Dance, USC Arts and Climate Collective) and others.";
    expect(hasDance(withoutNonDanceMentions(usc))).toBe(false);
    expect(hasDance(withoutNonDanceMentions("Presented by the Department of Dance"))).toBe(false);
    expect(hasDance(withoutNonDanceMentions("with the College of Music and Dance"))).toBe(false);
    expect(hasDance(withoutNonDanceMentions("Hubbard Street Dance Company performs"))).toBe(false);
    expect(hasDance(withoutNonDanceMentions("Alvin Ailey Dance Theater"))).toBe(false);
    expect(hasDance(withoutNonDanceMentions("the UCLA Dance Department"))).toBe(false);
  });

  it("drops a third-person 'dances' in a list of verbs", () => {
    const buffy = "See Buffy slay all day as she sings, dances, and suffers demonic entrances";
    expect(hasDance(withoutNonDanceMentions(buffy))).toBe(false);
    expect(hasDance(withoutNonDanceMentions("he acts and dances his way through"))).toBe(false);
    expect(hasDance(withoutNonDanceMentions("she dances, sings and laughs"))).toBe(false);
  });

  it("keeps real dance words", () => {
    for (const s of [
      "all-vinyl oldies dance party",
      "Live music, singing and dancing all night",
      "Come dance with us",
      "a school of dance hosts its monthly social: dance all night",
      "Salsa lesson then dancing",
    ]) {
      expect(hasDance(withoutNonDanceMentions(s))).toBe(true);
    }
  });

  it("lower-case 'school of dance' is not a proper name and stays", () => {
    expect(hasDance(withoutNonDanceMentions("the best school of dance in town"))).toBe(true);
  });

  it("leaves other text unchanged", () => {
    expect(withoutNonDanceMentions("Designing to Live Well in a Hotter Los Angeles")).toBe(
      "Designing to Live Well in a Hotter Los Angeles",
    );
  });
});

describe("NON_DANCE_EVIDENCE_REGEX", () => {
  it("names seated or non-dance events", () => {
    for (const s of [
      "a parody of musical theater",
      "a parody of musical theatre",
      "the Musical Episode, live",
      "Sing-A-Long night",
      "sing-along",
      "sing along with the cast",
      "singalong",
      "a panel on heat and design",
      "panel discussion",
      "our panelists",
      "Climate hackathon",
    ]) {
      expect(NON_DANCE_EVIDENCE_REGEX.test(s)).toBe(true);
    }
  });

  it("does not fire on dance nights", () => {
    for (const s of [
      "all-vinyl oldies dance party",
      "Salsa social with a lesson",
      "panelled ballroom",
      "Swing dancing to a live band",
    ]) {
      expect(NON_DANCE_EVIDENCE_REGEX.test(s)).toBe(false);
    }
  });
});
