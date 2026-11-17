import { describe, expect, it } from "vitest";
import {
  AMBIGUOUS_SYNONYMS,
  FALSE_FRIENDS,
  FAMILIES,
  FAMILY_KEYS,
  LANGS,
  LISTING_TYPES,
  LISTING_TYPE_KEYS,
  type Lang,
  type PhraseEntry,
  type Synonyms,
  STYLES,
  STYLE_KEYS,
  WEAK_SYNONYMS,
  PHRASED_STYLE_KEYS,
  familyKeySchema,
  familyLabel,
  familyOf,
  familyStyleKey,
  isFamilyKey,
  isStyleKey,
  labelFor,
  listingTypeLabel,
  listingTypeSchema,
  matchStyles,
  normalizeForMatch,
  searchQueriesFor,
  styleKeySchema,
  stylesOf,
} from "@/config/styles";
import { EXTRACT_SYSTEM } from "@/src/ai/prompts";
import { t } from "@/src/i18n";

const allPhrases = (s: { synonyms: Synonyms }) => LANGS.flatMap((l) => s.synonyms[l] ?? []);
const synonymsIn = (s: { synonyms: Synonyms }, lang: Lang) => s.synonyms[lang] ?? [];
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** True when `inner` occurs in `outer` as a run of whole tokens (or a substring for CJK). */
function containsPhrase(outer: string, inner: string): boolean {
  if (outer === inner) return false;
  if (CJK.test(outer) || CJK.test(inner)) return outer.includes(inner);
  return ` ${outer} `.includes(` ${inner} `);
}

describe("taxonomy shape", () => {
  it("has the thirteen DESIGN.md families in display order with their stock hex values", () => {
    expect(FAMILY_KEYS).toEqual([
      "salsa",
      "kizomba",
      "swing",
      "tango",
      "ballroom",
      "country",
      "folk",
      "ecstatic",
      "club",
      "hiphop",
      "kpop",
      "silent",
      "other",
    ]);
    const hex = Object.fromEntries(FAMILIES.map((f) => [f.key, f.hex]));
    expect(hex.salsa).toBe("#F7A98A");
    expect(hex.other).toBe("#F2EDE3");
    for (const f of FAMILIES) expect(f.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(familyLabel("kizomba")).toBe("Kizomba, zouk and Afro-Latin");
    expect(familyLabel("hiphop")).toBe("Hip-hop, street and breaking");
  });

  it("gives every family at least two styles and every style a known family", () => {
    for (const f of FAMILIES) expect(stylesOf(f.key).length, f.key).toBeGreaterThanOrEqual(2);
    for (const s of STYLES) expect(FAMILY_KEYS).toContain(s.family);
    expect(stylesOf("tango")).toEqual(["milonga", "practica", "tango_vals", "canyengue", "tango"]);
    expect(familyOf("milonga")).toBe("tango");
    expect(familyOf("forro")).toBe("kizomba");
    expect(familyOf("rock_n_roll")).toBe("other");
  });

  it("gives every family a style of its own key, which is how a family-only title is kept (D-070)", () => {
    for (const f of FAMILY_KEYS) {
      expect(familyStyleKey(f)).toBe(f);
      expect(familyOf(familyStyleKey(f))).toBe(f);
    }
    // The family-level styles added for this have no phrases, so matching is unchanged, and the
    // extraction prompt does not offer them: the model still names the specific style.
    expect(matchStyles("Tango Y Te")).toEqual({ styles: [], families: ["tango"] });
    expect(PHRASED_STYLE_KEYS).toContain("salsa");
    expect(PHRASED_STYLE_KEYS).toContain("milonga");
    const offered = /styles are taken only from this list[^:]*: ([^\n]+)\.$/m
      .exec(EXTRACT_SYSTEM)?.[1]
      ?.split(", ");
    expect(offered).toEqual([...PHRASED_STYLE_KEYS]);
    for (const key of ["tango", "swing", "club", "other"]) {
      expect(PHRASED_STYLE_KEYS).not.toContain(key);
      expect(offered).not.toContain(key);
    }
  });

  it("gives every style and family at least one English synonym and a sentence-case label", () => {
    for (const s of STYLES) {
      // A family-level style (D-070) is reached through its family's phrases, not its own.
      if (s.key === s.family && !["salsa", "kizomba"].includes(s.key)) {
        expect(s.synonyms.en, s.key).toEqual([]);
        expect(s.label, s.key).toMatch(/^[A-Z]/);
        continue;
      }
      expect(s.synonyms.en.length, s.key).toBeGreaterThan(0);
      expect(s.label, s.key).toMatch(/^[A-Z0-9]/);
      expect(s.label, s.key).not.toMatch(/ [A-Z][a-z]+ [A-Z][a-z]+$/);
    }
    for (const f of FAMILIES) {
      expect(f.synonyms.en.length, f.key).toBeGreaterThan(0);
      expect(f.queries.en.length, f.key).toBeGreaterThan(0);
    }
  });

  it("covers the required languages somewhere in the synonyms", () => {
    for (const lang of ["en", "es", "fr", "de", "pt", "it", "nl", "ja", "ko"] as const) {
      const count = [...STYLES, ...FAMILIES].filter((s) => synonymsIn(s, lang).length > 0).length;
      expect(count, lang).toBeGreaterThan(5);
    }
  });

  it("has no duplicate keys", () => {
    expect(new Set(STYLE_KEYS).size).toBe(STYLE_KEYS.length);
    expect(new Set(FAMILY_KEYS).size).toBe(FAMILY_KEYS.length);
    expect(new Set(LISTING_TYPES.map((t) => t.key)).size).toBe(LISTING_TYPES.length);
    for (const key of [...STYLE_KEYS, ...FAMILY_KEYS]) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("has no duplicate synonym across styles or families except through the ambiguity map", () => {
    const seen = new Map<string, string>();
    const owners = [
      ...STYLES.map((s) => ({ key: `style:${s.key}`, s })),
      ...FAMILIES.map((f) => ({ key: `family:${f.key}`, s: f })),
    ];
    for (const { key, s } of owners) {
      const own = new Set<string>();
      for (const phrase of allPhrases(s)) {
        const n = normalizeForMatch(phrase);
        expect(own.has(n), `${key} lists "${phrase}" twice`).toBe(false);
        own.add(n);
        const other = seen.get(n);
        expect(other, `"${phrase}" is in both ${other} and ${key}`).toBeUndefined();
        seen.set(n, key);
      }
    }
    const ambiguous = new Set(AMBIGUOUS_SYNONYMS.map((e) => normalizeForMatch(e.phrase)));
    const weak = new Set(WEAK_SYNONYMS.map((e) => normalizeForMatch(e.phrase)));
    const friends = new Set(FALSE_FRIENDS.map((p) => normalizeForMatch(p)));
    expect(ambiguous.size).toBe(AMBIGUOUS_SYNONYMS.length);
    expect(weak.size).toBe(WEAK_SYNONYMS.length);
    expect(friends.size).toBe(FALSE_FRIENDS.length);
    for (const n of ambiguous) {
      expect(seen.has(n), `ambiguous "${n}" is also a plain synonym`).toBe(false);
      expect(weak.has(n) || friends.has(n), `ambiguous "${n}" is also weak or a false friend`).toBe(
        false,
      );
    }
    for (const n of weak)
      expect(seen.has(n) || friends.has(n), `weak "${n}" is also a synonym or false friend`).toBe(
        false,
      );
    for (const n of friends)
      expect(seen.has(n), `false friend "${n}" is also a synonym`).toBe(false);
  });

  it("never lets a family phrase swallow a style phrase it could co-occur with (rule 3)", () => {
    // Longest match wins, so a family phrase that contains a style phrase as a run of whole
    // tokens would discard the style: "salsa and bachata" once erased both salsa and bachata.
    // English is always on, so English style phrases are checked against every language.
    // Entries here are family phrases that contain a style word only in a generic sense.
    const afroLatin =
      "afro-latin is the kizomba family's own scene word; the Latin or afro club phrase inside it is not the event";
    const allowed: Record<string, string> = {
      "kizomba:afro latin night": afroLatin,
      "kizomba:afro latin party": afroLatin,
      "kizomba:soirée afro latine": afroLatin,
      "kizomba:soirée afro latino": afroLatin,
      "kizomba:noite afro latina": afroLatin,
      "kizomba:dança afro latina": afroLatin,
      "kizomba:serata afro latina": afroLatin,
      "tango:tango milonguero":
        "a tango in the milonguero style is the dance, not a milonga event; the family match is right",
      "silent:サイレントディスコ": "silent disco is not a disco night; the silent family must win",
      "silent:사일런트 디스코": "silent disco is not a disco night; the silent family must win",
      "silent:사일런트디스코": "silent disco is not a disco night; the silent family must win",
    };
    const stylePhrases = [
      ...STYLES.flatMap((style) =>
        LANGS.flatMap((lang) =>
          synonymsIn(style, lang).map((phrase) => ({
            owner: style.key,
            lang,
            needle: normalizeForMatch(phrase),
          })),
        ),
      ),
      ...(AMBIGUOUS_SYNONYMS as readonly PhraseEntry[])
        .filter((e) => (e.styles ?? []).length > 0)
        .map((e) => ({
          owner: (e.styles ?? []).join("+"),
          lang: e.lang,
          needle: normalizeForMatch(e.phrase),
        })),
    ];
    const flagged: string[] = [];
    for (const family of FAMILIES) {
      for (const lang of LANGS) {
        for (const phrase of synonymsIn(family, lang)) {
          const outer = normalizeForMatch(phrase);
          for (const s of stylePhrases) {
            if (s.lang !== lang && s.lang !== "en") continue;
            if (!containsPhrase(outer, s.needle)) continue;
            const id = `${family.key}:${phrase}`;
            if (allowed[id]) continue;
            flagged.push(
              `family ${family.key} "${phrase}" would erase style ${s.owner} "${s.needle}"`,
            );
          }
        }
      }
    }
    expect(flagged).toEqual([]);
  });

  it("points every ambiguity and weak entry at real keys, and ambiguity entries at more than one target", () => {
    const ambiguous: readonly PhraseEntry[] = AMBIGUOUS_SYNONYMS;
    const weak: readonly PhraseEntry[] = WEAK_SYNONYMS;
    for (const e of ambiguous) {
      const targets = [...(e.styles ?? []), ...(e.families ?? [])];
      expect(targets.length, e.phrase).toBeGreaterThan(1);
      for (const s of e.styles ?? []) expect(isStyleKey(s)).toBe(true);
      for (const f of e.families ?? []) expect(isFamilyKey(f)).toBe(true);
    }
    for (const e of weak) {
      expect([...(e.styles ?? []), ...(e.families ?? [])].length, e.phrase).toBeGreaterThan(0);
      for (const s of e.styles ?? []) expect(isStyleKey(s)).toBe(true);
      for (const f of e.families ?? []) expect(isFamilyKey(f)).toBe(true);
    }
  });

  it("lists the ten SPEC listing types, in the domain's order, with sentence-case labels", () => {
    expect(LISTING_TYPES.map((t) => t.key)).toEqual([...LISTING_TYPE_KEYS]);
    expect(LISTING_TYPES.map((t) => t.key)).toEqual([
      "social",
      "class",
      "club_night",
      "practica",
      "live_music_with_dancing",
      "festival_session",
      "outdoor_public",
      "jam",
      "venue_open_night",
      "other",
    ]);
    expect(labelFor("club_night")).toBe(t("card.types.clubNight"));
    expect(labelFor("venue_open_night")).toBe(t("card.types.venueOpenNight"));
    for (const type of LISTING_TYPES) expect(labelFor(type.key)).toMatch(/^[A-Z]/);
  });
});

describe("zod schemas", () => {
  it("accept known keys and reject unknown ones", () => {
    expect(styleKeySchema.parse("milonga")).toBe("milonga");
    expect(familyKeySchema.parse("kpop")).toBe("kpop");
    expect(listingTypeSchema.parse("jam")).toBe("jam");
    expect(styleKeySchema.safeParse("Milonga").success).toBe(false);
    // "tango" is a family-level style since D-070; a made-up key is still refused.
    expect(styleKeySchema.safeParse("tango").success).toBe(true);
    expect(styleKeySchema.safeParse("tango_nuevo").success).toBe(false);
    expect(familyKeySchema.safeParse("milonga").success).toBe(false);
    expect(listingTypeSchema.safeParse("workshop").success).toBe(false);
    expect(isStyleKey("salsa")).toBe(true);
    expect(isFamilyKey("salsa")).toBe(true);
    expect(isStyleKey(42)).toBe(false);
  });
});

describe("labels", () => {
  it("labelFor resolves styles first, then families, then listing types", () => {
    expect(labelFor("salsa")).toBe("Salsa");
    expect(familyLabel("salsa")).toBe("Salsa and Latin");
    expect(labelFor("swing")).toBe("Swing");
    expect(labelFor("rock_n_roll")).toBe("Rock 'n' roll and rock 4 temps");
    expect(labelFor("venue_open_night")).toBe(t("card.types.venueOpenNight"));
    expect(labelFor("outdoor_public")).toBe(t("card.types.outdoorPublic"));
    // "practica" is also a tango style key, so labelFor gives the style; the listing type
    // label is reached through listingTypeLabel.
    expect(labelFor("practica")).toBe("Práctica");
    expect(listingTypeLabel("practica")).toBe(t("card.types.practica"));
    expect(labelFor("club_night")).toBe(t("card.types.clubNight"));
  });
});

describe("normalizeForMatch", () => {
  it("strips accents, case and punctuation and collapses spaces", () => {
    expect(normalizeForMatch("Práctica")).toBe("practica");
    expect(normalizeForMatch("practica")).toBe(normalizeForMatch("práctica"));
    expect(normalizeForMatch("  K-pop  Random-Play  ")).toBe("k pop random play");
    expect(normalizeForMatch("Rock'n'Roll")).toBe("rock n roll");
    expect(normalizeForMatch("Soirée Dansante")).toBe("soiree dansante");
    expect(normalizeForMatch("Straße")).toBe("strasse");
    expect(normalizeForMatch("Forró")).toBe("forro");
  });
});

describe("matchStyles", () => {
  it("reads New Orleans Cajun and bounce titles, never bare cajun or bounce (D-340)", () => {
    expect(matchStyles("Cajun two-step lesson at Mulate's").styles).toEqual(["zydeco"]);
    expect(matchStyles("Cajun jitterbug workshop").styles).toEqual(["zydeco"]);
    expect(matchStyles("Zydeco brunch with Corey Ledet").styles).toEqual(["zydeco"]);
    expect(matchStyles("Fais-do-do").styles).toEqual(["zydeco"]);
    expect(matchStyles("NOLA bounce night with DJ Jubilee").styles).toEqual(["bounce"]);
    expect(matchStyles("Sissy bounce party").families).toEqual(["club"]);
    expect(matchStyles("Cajun crawfish boil").styles).toEqual([]);
    expect(matchStyles("Bounce house party for kids").styles).toEqual([]);
    expect(matchStyles("Bounce back yoga").styles).toEqual([]);
  });

  it("finds tango from a milonga title", () => {
    expect(matchStyles("Milonga La Nacional")).toEqual({
      styles: ["milonga"],
      families: ["tango"],
    });
  });

  it("expands SBK to salsa, bachata and kizomba", () => {
    const m = matchStyles("SBK social");
    expect(m.styles).toEqual(["salsa", "bachata", "kizomba"]);
    expect(m.families).toEqual(["salsa", "kizomba"]);
  });

  it("maps soirée rock 4 temps to other/rock 'n' roll", () => {
    const m = matchStyles("soirée rock 4 temps");
    expect(m.styles).toEqual(["rock_n_roll"]);
    expect(m.families).toEqual(["other"]);
  });

  it("finds swing from a lindy hop lesson", () => {
    const m = matchStyles("Lindy hop lesson then social");
    expect(m.styles).toEqual(["lindy_hop"]);
    expect(m.families).toEqual(["swing"]);
  });

  it("finds K-pop random play dance", () => {
    const m = matchStyles("K-pop Random Play Dance");
    expect(m.styles).toEqual(["kpop_random_play"]);
    expect(m.families).toEqual(["kpop"]);
  });

  it("maps a zumba party to other", () => {
    const m = matchStyles("Zumba party");
    expect(m.styles).toEqual(["zumba"]);
    expect(m.families).toEqual(["other"]);
  });

  it("matches nothing for a house party or a salsa tasting", () => {
    expect(matchStyles("house party")).toEqual({ styles: [], families: [] });
    expect(matchStyles("salsa verde tasting")).toEqual({ styles: [], families: [] });
    expect(matchStyles("Chips and salsa at the bar")).toEqual({ styles: [], families: [] });
    expect(matchStyles("Breaking news: road closed")).toEqual({ styles: [], families: [] });
    expect(matchStyles("")).toEqual({ styles: [], families: [] });
    expect(matchStyles("   !!! ")).toEqual({ styles: [], families: [] });
  });

  it("is accent-insensitive in both directions", () => {
    const withAccent = matchStyles("práctica de tango");
    const without = matchStyles("practica de tango");
    expect(withAccent).toEqual(without);
    expect(withAccent.styles).toEqual(["practica"]);
    expect(matchStyles("Práctica")).toEqual(matchStyles("PRACTICA"));
    expect(matchStyles("Forro night").styles).toEqual(["forro"]);
    expect(matchStyles("Soiree salsa").styles).toEqual(["salsa"]);
  });

  it("matches on word boundaries only", () => {
    expect(matchStyles("kizombada").styles).toEqual(["kizomba"]);
    expect(matchStyles("kiz").styles).toEqual(["kizomba"]);
    expect(matchStyles("kizzy's birthday").styles).toEqual([]);
    expect(matchStyles("Salsalito").styles).toEqual([]);
    expect(matchStyles("wcs").styles).toEqual(["west_coast_swing"]);
    expect(matchStyles("wcsx").styles).toEqual([]);
  });

  it("lets the longest match win", () => {
    expect(matchStyles("silent disco on the roof").families).toEqual(["silent"]);
    expect(matchStyles("modern jive night").styles).toEqual(["ceroc"]);
    expect(matchStyles("jive night").styles).toEqual(["jive"]);
    expect(matchStyles("jive").styles).toEqual(["jive", "ballroom_jive"]);
    expect(matchStyles("ballroom scene kiki ball").styles).toEqual(["voguing"]);
    expect(matchStyles("house dance session").styles).toEqual(["house_dance"]);
    expect(matchStyles("deep house all night").styles).toEqual(["house"]);
    expect(matchStyles("Scottish country dancing").styles).toEqual(["scottish_country"]);
    expect(matchStyles("Scottish country dancing").families).toEqual(["folk"]);
  });

  it("keeps a bare word that is mostly something else from matching", () => {
    expect(matchStyles("open house").styles).toEqual([]);
    expect(matchStyles("rock concert").styles).toEqual([]);
    expect(matchStyles("mood swing").styles).toEqual([]);
    expect(matchStyles("blues band live").styles).toEqual([]);
    expect(matchStyles("Grand Ballroom, 2nd floor").families).toEqual([]);
    expect(matchStyles("country music live").families).toEqual([]);
    expect(matchStyles("swing dance night").families).toEqual(["swing"]);
    expect(matchStyles("blues dance").styles).toEqual(["blues"]);
  });

  it("only uses weak generic words when nothing stronger matched", () => {
    expect(matchStyles("Salsa social with DJ set by DJ Pepe")).toEqual({
      styles: ["salsa"],
      families: ["salsa"],
    });
    expect(matchStyles("DJ night at the Loft").styles).toEqual(["dj_night"]);
    expect(matchStyles("DJ night at the Loft").families).toEqual(["club"]);
    expect(matchStyles("Tanzabend").families).toEqual(["other"]);
    expect(matchStyles("Salsa Tanzabend").families).toEqual(["salsa"]);
    expect(matchStyles("Social dancing every Friday").families).toEqual(["other"]);
    expect(matchStyles("Social dancing every Friday").styles).toEqual([]);
  });

  it("handles ambiguity entries that point at a family and a style", () => {
    const m = matchStyles("Latin night with DJ Chino");
    expect(m.styles).toEqual(["latin_club"]);
    expect(m.families).toEqual(["club", "salsa"]);
    // D-793: the plural ("Pune Latin Nights") gets the same chip.
    expect(matchStyles("Pune Latin Nights").styles).toEqual(["latin_club"]);
    expect(matchStyles("Latin Parties every Friday").styles).toEqual(["latin_club"]);
    expect(matchStyles("afrobeats").styles).toEqual(["afrobeats_social", "afrobeats_club"]);
    expect(matchStyles("afrobeats party").styles).toEqual(["afrobeats_club"]);
  });

  it("returns several styles in order of appearance, without repeats", () => {
    const m = matchStyles("Bachata and salsa night, salsa lesson at 8, bachata after");
    expect(m.styles).toEqual(["bachata", "salsa"]);
    expect(m.families).toEqual(["salsa"]);
    const mixed = matchStyles("Lindy hop then blues dance then techno");
    expect(mixed.styles).toEqual(["lindy_hop", "blues", "techno"]);
    expect(mixed.families).toEqual(["swing", "club"]);
  });

  it("matches local-language event words", () => {
    expect(matchStyles("Soirée salsa au Bal Rock").styles).toEqual(["salsa", "rock_n_roll"]);
    expect(matchStyles("Baile social de bachata").styles).toEqual(["bachata"]);
    expect(matchStyles("Bal folk à la Bellevilloise").styles).toEqual(["bal_folk"]);
    expect(matchStyles("Forró pé de serra").styles).toEqual(["forro"]);
    expect(matchStyles("Noche de tango: milonga y práctica").styles).toEqual([
      "milonga",
      "practica",
    ]);
    expect(matchStyles("Stijldansavond").families).toEqual(["ballroom"]);
    expect(matchStyles("Volkstanzabend").families).toEqual(["folk"]);
  });

  it("matches Japanese and Korean without word spaces", () => {
    expect(matchStyles("今夜はミロンガです").styles).toEqual(["milonga"]);
    expect(matchStyles("케이팝 랜덤플레이댄스 in 홍대").styles).toEqual(["kpop_random_play"]);
    expect(matchStyles("살사 파티").styles).toEqual(["salsa"]);
  });

  it("keeps the style words inside a family-level compound (no family compound erases them)", () => {
    expect(matchStyles("Salsa & Bachata Night").styles).toEqual(["salsa", "bachata"]);
    expect(matchStyles("Salsa & Bachata Night").families).toEqual(["salsa"]);
    expect(matchStyles("Salsa and Bachata Social at Copacabana").styles).toEqual([
      "salsa",
      "bachata",
    ]);
    expect(matchStyles("Kizomba & Zouk Social").styles).toEqual(["kizomba", "brazilian_zouk"]);
    expect(matchStyles("Salsa and Bachata Kizomba night").styles).toEqual([
      "salsa",
      "bachata",
      "kizomba",
    ]);
    expect(matchStyles("Salsa and Bachata Kizomba night").families).toEqual(["salsa", "kizomba"]);
  });

  it("keeps urban kiz when it is followed by social or night", () => {
    expect(matchStyles("Urban Kiz Social").styles).toEqual(["urban_kiz"]);
    expect(matchStyles("Urban Kiz Night").styles).toEqual(["urban_kiz"]);
    expect(matchStyles("Kizomba & Urban Kiz Social, Brooklyn").styles).toEqual([
      "kizomba",
      "urban_kiz",
    ]);
    expect(matchStyles("Kiz social").styles).toEqual(["kizomba"]);
    expect(matchStyles("Street dance battle").styles).toEqual(["battle"]);
    expect(matchStyles("Street dance battle").families).toEqual(["hiphop"]);
  });

  it("splits hip-hop between the club night and the street dance", () => {
    expect(matchStyles("90s Hip Hop Party")).toEqual({
      styles: ["hip_hop_club"],
      families: ["club"],
    });
    expect(matchStyles("Hip-Hop & R&B Night").styles).toEqual(["hip_hop_club"]);
    expect(matchStyles("Hip-Hop & R&B Night").families).toEqual(["club"]);
    expect(matchStyles("Breaking cypher and hip hop freestyle session")).toEqual({
      styles: ["breaking", "hip_hop"],
      families: ["hiphop"],
    });
    expect(matchStyles("Hip hop dance class").styles).toEqual(["hip_hop"]);
    expect(matchStyles("Hip hop").styles).toEqual(["hip_hop", "hip_hop_club"]);
    expect(matchStyles("Hip-hop").styles).toEqual(["hip_hop", "hip_hop_club"]);
    expect(matchStyles("Hiphop").styles).toEqual(["hip_hop", "hip_hop_club"]);
    expect(matchStyles("Hip hop concert").styles).toEqual([]);
    expect(matchStyles("Soirée hip hop", ["fr"]).styles).toEqual(["hip_hop_club"]);
    expect(matchStyles("Cours de hip hop", ["fr"]).styles).toEqual(["hip_hop"]);
    expect(searchQueriesFor("club", "en").some((q) => /hip hop/.test(q))).toBe(true);
    expect(searchQueriesFor("club", "es").some((q) => /hip hop/.test(q))).toBe(true);
    expect(searchQueriesFor("club", "fr").some((q) => /hip hop/.test(q))).toBe(true);
    expect(searchQueriesFor("club", "de").some((q) => /hip hop/.test(q))).toBe(true);
  });

  it("finds East Coast Swing and country swing", () => {
    expect(matchStyles("East Coast Swing lesson and social")).toEqual({
      styles: ["east_coast_swing"],
      families: ["swing"],
    });
    expect(matchStyles("Six count swing basics").styles).toEqual(["east_coast_swing"]);
    expect(matchStyles("ECS and Lindy").styles).toEqual(["lindy_hop"]);
    expect(matchStyles("ECS").styles).toEqual(["east_coast_swing"]);
    expect(matchStyles("Country swing lesson then dancing")).toEqual({
      styles: ["country_swing"],
      families: ["country"],
    });
  });

  it("splits cha-cha between the salsa scene and the ballroom", () => {
    const party = matchStyles("Friday Night Practice Party: waltz, foxtrot, cha cha");
    expect(party.styles).toContain("ballroom_cha_cha");
    expect(party.styles).toContain("waltz");
    expect(party.families).toContain("ballroom");
    expect(matchStyles("International cha cha technique").styles).toEqual(["ballroom_cha_cha"]);
    expect(matchStyles("Cuban cha cha night").styles).toEqual(["cha_cha"]);
    expect(matchStyles("cha cha").styles).toEqual(["cha_cha", "ballroom_cha_cha"]);
    expect(matchStyles("Cowboy cha cha")).toEqual({
      styles: ["line_dance"],
      families: ["country"],
    });
    expect(matchStyles("Cha cha slide at the wedding").styles).toEqual([]);
  });

  it("knows kompa and bal musette and the new false friends", () => {
    expect(matchStyles("Hustle and Flow film screening")).toEqual({ styles: [], families: [] });
    expect(matchStyles("Jive Turkey Thanksgiving dinner")).toEqual({ styles: [], families: [] });
    expect(matchStyles("Merengue de fresa")).toEqual({ styles: [], families: [] });
    expect(matchStyles("Kompa party")).toEqual({ styles: ["kompa"], families: ["kizomba"] });
    expect(matchStyles("Soirée konpa").styles).toEqual(["kompa"]);
    expect(matchStyles("Bal musette")).toEqual({ styles: ["musette"], families: ["folk"] });
    expect(matchStyles("Guinguette on the Marne").styles).toEqual([]);
  });

  it("narrows to the given languages plus English", () => {
    expect(matchStyles("Tanzabend", ["en"]).families).toEqual([]);
    expect(matchStyles("Tanzabend", ["de"]).families).toEqual(["other"]);
    expect(matchStyles("Soirée salsa", ["de"]).styles).toEqual(["salsa"]);
    expect(matchStyles("Bal folk", ["de"]).styles).toEqual(["bal_folk"]);
    expect(matchStyles("Baile de salsa", ["fr"]).styles).toEqual(["salsa"]);
    expect(matchStyles("Salsa verde", ["ja"]).styles).toEqual([]);
  });
});

describe("searchQueriesFor", () => {
  it("returns the local phrases first then the English ones, with no repeats", () => {
    const fr = searchQueriesFor("salsa", "fr");
    expect(fr[0]).toBe("soirée salsa");
    expect(fr).toContain("salsa social");
    expect(new Set(fr).size).toBe(fr.length);
    expect(searchQueriesFor("tango", "es")).toContain("milonga");
    expect(searchQueriesFor("tango", "es").filter((q) => q === "milonga")).toHaveLength(1);
    expect(searchQueriesFor("kizomba", "pt")).toContain("forró");
    expect(searchQueriesFor("ballroom", "de")).toContain("tanzabend");
    expect(searchQueriesFor("ballroom", "en")).toContain("ballroom practice party");
    expect(searchQueriesFor("club", "de")).toContain("house party");
    expect(searchQueriesFor("club", "de")).not.toContain("House Party Club");
    expect(searchQueriesFor("folk", "fr")).toContain("bal folk");
  });

  it("writes German queries in lower case like the other languages", () => {
    for (const f of FAMILIES) {
      for (const q of f.queries.de ?? []) expect(q, `${f.key}/de`).toBe(q.toLowerCase());
    }
  });

  it("falls back to English for a family without that language", () => {
    expect(searchQueriesFor("country", "ja")).toEqual([...searchQueriesFor("country", "en")]);
    expect(searchQueriesFor("swing")).toEqual([...searchQueriesFor("swing", "en")]);
  });

  it("gives every family a query in every language or an English fallback", () => {
    for (const f of FAMILIES) {
      for (const lang of LANGS)
        expect(searchQueriesFor(f.key, lang).length, `${f.key}/${lang}`).toBeGreaterThan(0);
    }
  });
});

describe("Chinese (Hong Kong) style words (D-663)", () => {
  it.each([
    ["週三騷莎舞會 @ 蘭桂坊", "salsa"],
    ["巴恰塔之夜", "bachata"],
    ["林迪舞社交晚會", "lindy_hop"],
    ["的士高之夜", "disco"],
    ["阿根廷探戈 米隆加", "milonga"],
    ["肚皮舞表演", "belly_dance"],
  ])("%s -> %s", (title, style) => {
    expect(matchStyles(title, ["zh"]).styles).toContain(style);
  });
  it("Chinese words are not used for a metro without zh", () => {
    expect(matchStyles("的士高之夜", ["es"]).styles).toEqual([]);
  });
});
