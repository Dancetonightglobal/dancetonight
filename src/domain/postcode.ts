// A postal code that pins an address to a street, per country (D-202, D-231): a US ZIP, a UK postcode,
// a Portuguese 4-3 code, a Brazilian CEP, an Argentine CPA, a Colombian 6-digit code, an Indian PIN code; Hong
// Kong has none, so a street number or a named building in a Hong Kong area pins it instead (D-662).
interface PostcodeRule {
  find: RegExp;
  normalize: (match: RegExpMatchArray) => string;
  word: string;
}

const NO_POSTCODE = new Set(["HK", "AE", "LB"]);

/** Fold Japanese address: NFKC, replace hyphen-like chars with ASCII "-". */
function foldJp(address: string): string {
  const normalized = address.normalize("NFKC");
  // Replace various hyphen-like characters with ASCII "-"
  return normalized.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u30FC\uFF0D]/g, "-");
}

/** Per-country rules (D-231); GB's is a whole postcode: an outward code alone ("N1") names a district. */
const RULES: Record<string, PostcodeRule> = {
  // Great Britain
  GB: {
    find: /\b(?:GIR ?0AA|[A-PR-UWYZ](?:\d[A-HJKPSTUW\d]?|[A-HK-Y]\d[ABEHMNPRVWXY\d]?) ?\d[ABD-HJLNP-UW-Z]{2})\b/i,
    normalize: (match) => match[0].toUpperCase().replace(/\s+/g, ""),
    word: "postcode",
  },
  // Portugal
  PT: {
    find: /\b\d{4}-\d{3}\b/,
    normalize: (match) => match[0],
    word: "postcode",
  },
  // Brazil
  BR: {
    find: /\b\d{5}-?\d{3}\b/,
    normalize: (match) => match[0].replace(/-/g, ""),
    word: "CEP",
  },
  // Argentina: a CPA ("C1414ABC"), its letter and digits ("C1414"), "CP 1414", or "(1414)". A bare
  // 4-digit number is a street number ("Av. Corrientes 1414"), not a postcode.
  AR: {
    find: /\b(?:[A-HJ-NP-Z]\d{4}(?:[A-Z]{3})?|C\.?\s?P\.?\s?\d{4})\b|\(\d{4}\)/i,
    normalize: (match) =>
      /^[A-Z]\d{4}/i.test(match[0]) ? match[0].toUpperCase() : match[0].replace(/\D/g, ""),
    word: "postcode",
  },
  // Colombia
  CO: {
    find: /\b\d{6}\b/,
    normalize: (match) => match[0],
    word: "postcode",
  },
  // India: a 6-digit PIN code, first digit 1-8, written "400050" or "400 050".
  IN: {
    find: /(?<![\d+])\b[1-8]\d{2}\s?\d{3}\b(?![\s-]?\d)/,
    normalize: (match) => match[0].replace(/\s+/g, ""),
    word: "PIN code",
  },
  // Japan: 〒NNN-NNNN postcode (D-1222)
  JP: {
    find: /(?<![\d\-¥$,.])(?:〒\s?)?\d{3}-\d{4}(?![\d\-]|[.,]\d|\s?(?:円|yen|JPY))/i,
    normalize: (match) => match[0].replace(/[^\d]/g, ""),
    word: "postcode",
  },
};

/** Every other country (US, PR, ES, MX...): five digits on their own; a ZIP+4 keeps its five. */
const DEFAULT_RULE: PostcodeRule = {
  find: /\b\d{5}\b/,
  normalize: (match) => match[0],
  word: "ZIP",
};

// Street+number pattern (allows optional comma after street name)
const STREET_NUMBER = /\p{L}{3,}\.?,?\s+\d{1,5}\b/u;
// City words for ES and PT
const CITY_WORDS: Record<string, RegExp> = {
  ES: /\bBarcelona\b/i,
  PT: /\b(?:Lisboa|Lisbon)\b/i,
};
// France (D-1043): a house number (optional bis/ter/quater or a single letter, optional comma) then a street word.
const FR_STREET =
  /(?<![\p{L}\p{N}])\d{1,4}(?:\s?(?:bis|ter|quater|[a-d]))?,?\s+(?:rue|avenue|av\.?|boulevard|bd|blvd|place|pl\.|quai|passage|impasse|all[ée]e|cours|chemin|square|villa|cit[ée]|route|faubourg|port|esplanade|parvis|rond-point|galerie|sentier|voie)(?![\p{L}])/iu;
const FR_CITY = /(?<![\p{L}])Paris(?![\p{L}])/iu;

// A Colombian street plate (D-640): "Cra 43A # 10-50", "Calle 10 Sur # 50FF-28".
const CO_PLATE =
  /\b(?:Calle|Cll?|Carrera|Cra|Cr|Kra|Kr|Avenida|Avda|Av|Diagonal|Diag|Dg|Transversal|Trans|Tv|Tr|Circular|Circ|Cq)\.?\s*\d{1,3}\s?[A-Z]{0,2}(?:\s+(?:Bis|Sur))*\s*(?:#|N(?:o|ro|º|°)\.?)\s*\d{1,3}\s?[A-Z]{0,2}(?:\s+(?:Bis|Sur))*\s*-\s*\d{1,3}\s?[A-Z]?\b/iu;
// The 10 municipalities of the Área Metropolitana del Valle de Aburrá (D-640), the department, and two areas
// pages name instead of the city; the metro outline still decides.
const CO_METRO_TOWN =
  /(?<![\p{L}\p{N}])(?:Medell[ií]n|Bello|Itag[uü][ií]|Envigado|Sabaneta|La Estrella|Caldas|Copacabana|Girardota|Barbosa|Antioquia|El Poblado|Laureles)(?![\p{L}\p{N}])/iu;

/** D-507: a US five-digit group that starts an address part and is followed by a word is a house number. */
function isUsHouseNumber(address: string, index: number, length: number): boolean {
  // Check if the text before index, with trailing spaces removed, is empty or ends with ','
  const before = address.slice(0, index).trimEnd();
  const isStartOfPart = before === "" || before.endsWith(",");

  if (!isStartOfPart) {
    return false;
  }

  // Check if the text after the match starts with one or more spaces followed by a letter
  const after = address.slice(index + length);
  return /^\s+\p{L}/u.test(after);
}

/** Whether `address` carries a postal code of the metro's country. */
export function hasPostcode(address: string, countryCode: string): boolean {
  // Hong Kong: no postcodes, but a street number or a named building in a Hong Kong area pins it (D-662)
  if (countryCode === "HK") {
    // a) English street number + capitalised street name
    const englishPattern =
      /(?<!(?:HKD|HK\$|\$)\s?)\b\d{1,4}[A-Z]?(?:\s?-\s?\d{1,4}[A-Z]?)?\s+(?!(?:AM|PM|am|pm|HKD)\b)(?:\p{Lu}[\p{L}'.]*\s+){0,4}(?:Road|Rd|Street|St|Avenue|Ave|Lane|Terrace|Path|Square|Drive|Praya|Fong|Circuit|Crescent|Hill|Gardens?)\b\.?/u;
    if (englishPattern.test(address)) {
      return true;
    }
    // b) Chinese street + number + 號
    const chinesePattern =
      /\p{Script=Han}{1,8}(?:道|街|路|里|坊|徑|台)\s?\d{1,4}(?:\s?[-–至]\s?\d{1,4})?\s?號/u;
    if (chinesePattern.test(address)) {
      return true;
    }
    // c) a building word AND a Hong Kong area word both present
    const buildingWords =
      /\b(?:Building|Bldg|Tower|Centre|Center|Plaza|House|Mansion|Court|Mall|Arcade)\b|大廈|大樓|中心|廣場|商場/;
    const hkAreas =
      /\b(?:Central|Sheung Wan|Wan Chai|Causeway Bay|Admiralty|Mid-Levels|Kennedy Town|Sai Ying Pun|North Point|Quarry Bay|Tsim Sha Tsui|Jordan|Yau Ma Tei|Mong Kok|Prince Edward|Sham Shui Po|Kwun Tong|Kowloon Bay|Kowloon|Hong Kong Island|Sha Tin|Tsuen Wan|Aberdeen|Wong Chuk Hang|Stanley|Sai Kung|Discovery Bay|Mui Wo)\b|中環|上環|灣仔|銅鑼灣|金鐘|尖沙咀|旺角|油麻地|觀塘|九龍/;
    if (buildingWords.test(address) && hkAreas.test(address)) {
      return true;
    }
    return false;
  }

  // UAE: no postcodes, but a street number or a named building in a Dubai area pins it (D-1061)
  if (countryCode === "AE") {
    // a) Street number and street word pattern
    // Avoid numbers preceded by AED/Dhs/Dh or followed by AM/PM/AED/Dhs
    const streetNumberPattern =
      /(?<!\b(AED|Dhs?|Dh\.?)\s?)\b\d{1,4}[A-Z]?\s+(?!(?:AM|PM|am|pm|AED|Dhs?|Dh\.?)\b)(?:\p{Lu}[\p{L}'.]*\s+){0,4}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd)\b\.?/u;
    // Also "Street 12", "St. 12", "Road 12" pattern
    const streetWordFirstPattern =
      /\b(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?)\s+\d{1,4}[A-Z]?\b/i;
    // Unit/Shop/Office/Villa pattern
    const unitPattern = /\b(?:Unit|Shop|Warehouse|Office|Villa)\s+\d{1,5}\b/i;

    if (
      streetNumberPattern.test(address) ||
      streetWordFirstPattern.test(address) ||
      unitPattern.test(address)
    ) {
      return true;
    }

    // b) Building word AND Dubai area word both present
    const buildingWords =
      /\b(?:Hotel|Resort|Tower|Towers|Building|Bldg|Mall|Centre|Center|Plaza|Club|Beach|Walk|Hall|Arena|Theatre|Theater|Opera|Warehouse|Level|Floor|Rooftop|Marina|Pier|Souk|Market|Studio|House)\b/i;
    const dubaiAreas =
      /\b(?:Downtown Dubai|Downtown|DIFC|Business Bay|Dubai Marina|JBR|Jumeirah Beach Residence|JLT|Jumeirah Lakes Towers|Jumeirah|Jumeira|Al Quoz|Alserkal|Al Barsha|Barsha|Deira|Bur Dubai|Karama|Al Karama|Satwa|Al Satwa|Palm Jumeirah|The Palm|Bluewaters|Dubai Media City|Media City|Dubai Internet City|Internet City|Knowledge Village|Festival City|Al Seef|Al Habtoor City|Dubai Design District|d3|City Walk|La Mer|Umm Suqeim|Al Sufouh|Trade Centre|World Trade Centre|Za'abeel|Zabeel|Oud Metha|Garhoud|Al Garhoud|Jaddaf|Al Jaddaf|Creek Harbour|Dubai Creek|Dubai Hills|Motor City|Sports City|JVC|Jumeirah Village Circle|Mirdif|Al Wasl|Expo City|Al Rigga|Rigga|Port Rashid|Mina Rashid|Jebel Ali|Dubai Silicon Oasis|Al Qusais|Al Nahda|Bur Dubai|Hatta)\b/i;

    // Check if there's a building word and a Dubai area word
    if (buildingWords.test(address) && dubaiAreas.test(address)) {
      // Additional check: ensure the building word is not part of the matched area phrase
      // For example, "Dubai Marina" contains "Marina" but it's part of the area name
      const areaMatches = address.match(dubaiAreas) || [];
      const buildingMatches = address.match(buildingWords) || [];
      // Check if there exists at least one building match that is not contained in any area match
      for (const buildingMatch of buildingMatches) {
        let isContained = false;
        for (const areaMatch of areaMatches) {
          if (areaMatch.includes(buildingMatch)) {
            isContained = true;
            break;
          }
        }
        if (!isContained) {
          return true;
        }
      }
    }
    return false;
  }

  // Lebanon: no postcodes; a street with a building or a street number pins it (D-1002)
  if (countryCode === "LB") {
    // Street words (case-insensitive)
    const streetWords =
      /\b(?:Street|St|St\.|Rue|Avenue|Ave|Road|Rd|Highway|Hwy|Boulevard|Blvd|Autostrade|Corniche)\b/i;
    // Arabic street substrings
    const arabicStreet = /شارع|طريق|جادة|أوتوستراد/;
    const hasStreet = streetWords.test(address) || arabicStreet.test(address);
    if (!hasStreet) {
      return false;
    }
    // Building words
    const buildingWords =
      /\b(?:Building|Bldg|Bldg\.|Bloc|Block|Immeuble|Imm\.|Tower|Center|Centre|Mall|Plaza|Hotel|Complex)\b|بناية|مبنى|برج|سنتر/;
    const hasBuilding = buildingWords.test(address);
    if (hasBuilding) {
      return true;
    }
    // Street number patterns
    // English pattern: number before street word (include Arabic-Indic digits)
    const englishNumberBefore =
      /(?<![\p{L}\p{N}$])[\d٠-٩]{1,4}\s+(?:\p{Lu}[\p{L}'.-]*\s+){0,4}(?:Street|St\.?|Rue|Avenue|Ave|Road|Rd|Highway|Hwy|Boulevard|Blvd|Autostrade|Corniche)\b/u;
    // English pattern: street word before number (include Arabic-Indic digits)
    const englishNumberAfter =
      /\b(?:Street|St\.?|Rue|Avenue|Ave|Road|Rd|Highway|Hwy|Boulevard|Blvd|Autostrade|Corniche)\s+(?:\p{Lu}[\p{L}'.-]*\s+){0,3}(?<!\$)[\d٠-٩]{1,4}(?![\p{L}\p{N}])/iu;
    // Arabic pattern: street word before number (no price/time after) (include Arabic-Indic digits)
    const arabicNumberAfter =
      /(?:شارع|طريق|جادة|أوتوستراد)[^\d،,]{0,30}(?<!\$)[\d٠-٩]{1,4}(?!\s?(?:am|pm)\b)/u;

    if (
      englishNumberBefore.test(address) ||
      englishNumberAfter.test(address) ||
      arabicNumberAfter.test(address)
    ) {
      return true;
    }
    return false;
  }

  const rule = RULES[countryCode] || DEFAULT_RULE;
  // For Japan: fold first, then check postcode rule
  if (countryCode === "JP") {
    const folded = foldJp(address);
    if (rule.find.test(folded)) {
      return true;
    }
    // Check for block address with ward/city
    // Block address pattern: digits-hyphen-digits with 2 or 3 groups, each 1-4 digits
    const blockPattern = /(?<![\d\-:.,¥$])\d{1,4}-\d{1,4}(?:-\d{1,4})?(?![\d\-:])/;
    // Also reject phone numbers (starts with "0" followed by digits)
    const phonePattern = /^0\d/;
    // Also reject prices (followed by optional spaces then 円/yen/JPY)
    const pricePattern = /^\s?(?:円|yen|JPY)/i;
    // Also reject when preceded by ¥ or $
    const precededByCurrency = /[¥$]/;

    // Japanese "N丁目", "N番地", "N番", "N号" patterns
    const jpBlockPatterns = [/\d{1,2}丁目/, /\d{1,4}番(?:地|\s?\d|号|$)/];

    // Ward or city patterns
    const jpWardCity = /\p{Script=Han}{1,4}[区市]/u;
    const enWardCity = /\b[A-Za-z]+-(?:ku|shi)\b/i;
    const tokyoWord = /\bTokyo\b|東京/i;

    // Check for block address
    let hasBlock = false;
    // Check digit-hyphen pattern: loop over all matches
    const digitMatches = folded.matchAll(new RegExp(blockPattern.source, "g"));
    for (const digitMatch of digitMatches) {
      const matched = digitMatch[0];
      // A two-part block ("2-29") counts only right after a town name ("道玄坂2-29"), so a date ("11-08") or a
      // time range ("22-5") is not read as one (coverage-114).
      if (matched.split("-").length === 2) {
        const prev = folded.slice(0, digitMatch.index!).slice(-1);
        if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(prev)) {
          continue;
        }
      }
      // Check it's not a phone number
      if (phonePattern.test(matched)) {
        continue;
      }
      // Check it's not followed by price indicator
      const after = folded.slice(digitMatch.index! + matched.length);
      if (pricePattern.test(after)) {
        continue;
      }
      // Check not preceded by currency
      const before = folded.slice(0, digitMatch.index!);
      if (precededByCurrency.test(before.slice(-1))) {
        continue;
      }
      hasBlock = true;
      break;
    }
    // Check Japanese patterns
    for (const pattern of jpBlockPatterns) {
      if (pattern.test(folded)) {
        hasBlock = true;
        break;
      }
    }

    // Check for ward/city
    const hasWardCity =
      jpWardCity.test(folded) || enWardCity.test(folded) || tokyoWord.test(folded);

    return hasBlock && hasWardCity;
  }
  // For Argentina only: also accept street+number with CABA word (D-236)
  if (countryCode === "AR") {
    // Check for AR postcode rule first
    if (rule.find.test(address)) {
      return true;
    }
    // Check for street+number pattern
    if (!STREET_NUMBER.test(address)) {
      return false;
    }
    // Check for CABA word
    const cabaPattern =
      /\b(CABA|C\.A\.B\.A\.?|Capital Federal|Ciudad de Buenos Aires|Ciudad Autónoma de Buenos Aires|Ciudad Autonoma de Buenos Aires)\b/i;
    return cabaPattern.test(address);
  }
  // Colombia: accept 6-digit postcode OR plate with Medellín area town (D-640)
  if (countryCode === "CO") {
    // Normalize dash variants to ASCII "-" for both postcode and plate tests
    const normalized = address.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212-]/g, "-");
    // Check for CO postcode rule first (using normalized)
    if (rule.find.test(normalized)) {
      return true;
    }
    // Otherwise require both plate and metro town (using normalized)
    return CO_PLATE.test(normalized) && CO_METRO_TOWN.test(address);
  }
  // France (D-1043): a house number and street in Paris places without a postcode, as Barcelona does.
  if (countryCode === "FR" && !rule.find.test(address)) {
    return FR_STREET.test(address) && FR_CITY.test(address);
  }
  // ES and PT: a street and house number in the core city's own name places without a postcode,
  // as CABA does (D-258): "C/ de Llança, 5, Barcelona" (Meetup prints no postcode).
  const cityWord = CITY_WORDS[countryCode];
  if (cityWord && !rule.find.test(address)) {
    return STREET_NUMBER.test(address) && cityWord.test(address);
  }
  // Puerto Rico (US) without ZIP: a house number and street in San Juan metro, as D-262 (Viajando y Bailando).
  if (countryCode === "US" && postcodeOf(address, "US") === null) {
    // House number before a street word: optional #, digits, optional dash, space, at least two letters.
    const houseNumberPattern = /(?:^|,\s*)#?\d{1,5}(?:-\d{1,4})?\s+\p{L}{2,}/u;
    if (!houseNumberPattern.test(address)) {
      return false;
    }
    // San Juan metro town and ends in PR.
    const prTownPattern =
      /\b(?:San Juan|Santurce|Hato Rey|R[ií]o Piedras|Condado|Isla Verde|Carolina|Guaynabo|Bayam[oó]n|Cata[ñn]o)\b[^,]*,?\s*(?:PR|Puerto Rico)\s*$/iu;
    return prTownPattern.test(address);
  }
  // For US, use postcodeOf to check for ZIPs, skipping house numbers
  if (countryCode === "US") {
    return postcodeOf(address, countryCode) !== null;
  }
  return rule.find.test(address);
}

/** The word the notes use for it: "postcode" for GB, PT, AR, CO; "CEP" for BR; "street number or building" for HK; otherwise "ZIP". */
export function postcodeWord(countryCode: string): string {
  if (countryCode === "HK" || countryCode === "AE") {
    return "street number or building";
  }
  if (countryCode === "LB") {
    return "street and building";
  }
  const rule = RULES[countryCode];
  return rule ? rule.word : DEFAULT_RULE.word;
}

/** The last postal code of the country in `address`, normalized, or null when it has none. */
export function postcodeOf(address: string, countryCode: string): string | null {
  // Hong Kong has no postal codes (D-662)
  if (NO_POSTCODE.has(countryCode)) {
    return null;
  }
  const rule = RULES[countryCode] || DEFAULT_RULE;
  // For Japan, fold the address first
  const text = countryCode === "JP" ? foldJp(address) : address;
  const pattern = new RegExp(rule.find.source, "gi");
  let last: string | null = null;
  for (const match of text.matchAll(pattern)) {
    // A US house number is not a ZIP (D-507).
    if (countryCode === "US" && isUsHouseNumber(address, match.index ?? 0, match[0].length))
      continue;
    last = rule.normalize(match);
  }
  return last;
}
