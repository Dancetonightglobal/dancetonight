// Community and folk styles named in the city gap reports (D-559 fix 3): Cape Verdean, Haitian,
// Cuban, Colombian, Brazilian, Portuguese, Catalan, Puerto Rican, Indian, Ukrainian, Gulf, African
// American and New Orleans dances that had no key. Spread into STYLES in config/styles.ts.
import type { StyleDef } from "@/config/styles";

export const WORLD_STYLES = [
  // kizomba family
  {
    key: "funana",
    family: "kizomba",
    label: "Funaná",
    synonyms: { en: ["funana", "funana night", "noite de funana"] },
  },
  {
    key: "batuque",
    family: "kizomba",
    label: "Batuque",
    synonyms: { en: ["batuque", "batuku"] },
  },
  {
    key: "coladeira",
    family: "kizomba",
    label: "Coladeira and morna",
    synonyms: { en: ["coladeira", "coladera", "morna e coladeira", "noite de morna"] },
  },
  {
    key: "zouk_love",
    family: "kizomba",
    label: "Zouk love",
    synonyms: { en: ["zouk love", "zouk antillais", "zouk retro"] },
  },
  {
    key: "raboday",
    family: "kizomba",
    label: "Raboday",
    synonyms: { en: ["raboday"] },
  },
  {
    key: "coupe_decale",
    family: "kizomba",
    label: "Coupé-décalé",
    synonyms: { en: ["coupe decale"] },
  },
  // salsa family
  {
    key: "guaguanco",
    family: "salsa",
    label: "Cuban rumba",
    synonyms: { en: ["guaguanco", "rumba cubana", "rumba de cajon"] },
  },
  {
    key: "vallenato",
    family: "salsa",
    label: "Vallenato",
    synonyms: { en: ["vallenato", "noche vallenata"] },
  },
  {
    key: "bolero",
    family: "salsa",
    label: "Bolero",
    synonyms: { en: ["baile de bolero", "bolero dance", "clases de bolero", "noche de boleros"] },
  },
  // swing family
  {
    key: "hand_dancing",
    family: "swing",
    label: "Hand dancing",
    synonyms: { en: ["hand dancing"] },
  },
  // country family
  {
    key: "soul_line",
    family: "country",
    label: "Soul line dance",
    synonyms: { en: ["soul line dancing", "soul line dance", "soul line"] },
  },
  {
    key: "clogging",
    family: "country",
    label: "Clogging",
    synonyms: { en: ["clogging", "clog dancing"] },
  },
  // folk family
  {
    key: "portuguese_folk",
    family: "folk",
    label: "Portuguese folk",
    synonyms: {
      en: [
        "rancho folclorico",
        "folclore portugues",
        "danca tradicional",
        "bailarico",
        "corridinho",
        "malhao",
      ],
    },
  },
  {
    key: "kola_san_jon",
    family: "folk",
    label: "Kola San-Jon",
    synonyms: { en: ["kola san jon"] },
  },
  {
    key: "catalan_folk",
    family: "folk",
    label: "Catalan and Balearic folk",
    synonyms: { en: ["ball de bot", "ball de bastons"] },
  },
  {
    key: "puerto_rican_folk",
    family: "folk",
    label: "Puerto Rican folk",
    synonyms: {
      en: ["baile jibaro", "musica jibara", "seis bombeao", "seis chorreao", "trulla navidena"],
    },
  },
  {
    key: "joropo",
    family: "folk",
    label: "Joropo",
    synonyms: { en: ["joropo"] },
  },
  {
    key: "brazilian_folk",
    family: "folk",
    label: "Brazilian folk",
    synonyms: {
      en: ["jongo", "ciranda", "coco de roda", "maracatu", "afoxe", "xaxado", "vanerao", "vaneira"],
    },
  },
  {
    key: "marathi_folk",
    family: "folk",
    label: "Lavani and Koli",
    synonyms: { en: ["lavani", "koli dance", "koli nritya"] },
  },
  {
    key: "ukrainian_folk",
    family: "folk",
    label: "Ukrainian folk",
    synonyms: { en: ["zabava", "malanka", "hopak"] },
  },
  {
    key: "scottish_highland",
    family: "folk",
    label: "Highland dancing",
    synonyms: { en: ["highland dancing", "highland dance"] },
  },
  {
    key: "khaleeji",
    family: "folk",
    label: "Khaleeji",
    synonyms: { en: ["khaleeji"], ar: ["رقص خليجي", "الرقص الخليجي", "سهرة خليجية"] },
  },
  // hiphop family
  {
    key: "charme",
    family: "hiphop",
    label: "Charme",
    synonyms: { en: ["baile charme", "noite de charme", "charme dance"] },
  },
  {
    key: "passinho",
    family: "hiphop",
    label: "Passinho",
    synonyms: { en: ["passinho"] },
  },
  // other family
  {
    key: "indian_classical",
    family: "other",
    label: "Indian classical dance",
    synonyms: { en: ["kathak", "bharatanatyam", "bharatnatyam", "odissi"] },
  },
  {
    key: "capoeira",
    family: "other",
    label: "Capoeira",
    synonyms: { en: ["capoeira", "roda de capoeira"] },
  },
  {
    key: "second_line",
    family: "other",
    label: "Second line",
    synonyms: { en: ["second line", "second line parade", "second line sunday"] },
  },
  {
    key: "steppin",
    family: "other",
    label: "Steppin'",
    synonyms: { en: ["chicago steppin", "chicago stepping", "steppin", "steppers set"] },
  },
  {
    key: "sabar",
    family: "other",
    label: "Sabar and mbalax",
    synonyms: { en: ["sabar", "mbalax", "mbalakh"] },
  },
  // Japanese dances (Tokyo, D-1226)
  {
    key: "bon_odori",
    family: "folk",
    label: "Bon odori",
    synonyms: { en: ["bon odori", "bon dance"], ja: ["盆踊り", "盆おどり"] },
  },
  {
    key: "awa_odori",
    family: "folk",
    label: "Awa odori",
    synonyms: { en: ["awa odori"], ja: ["阿波踊り", "阿波おどり"] },
  },
  {
    key: "hula",
    family: "folk",
    label: "Hula",
    synonyms: { en: ["hula dance", "hula class", "hula night"], ja: ["フラダンス", "フラ ダンス"] },
  },
  {
    key: "para_para",
    family: "club",
    label: "Para Para",
    synonyms: {
      en: ["para para", "parapara"],
      ja: ["パラパラ ナイト", "パラパラナイト", "パラパラダンス"],
    },
  },
] as const satisfies readonly StyleDef[];
