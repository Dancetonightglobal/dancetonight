// Where a metro reaches, for the check that a listing's own address names a place outside it
// (`geoapifyElsewhere`, PR 2): "3050 Bristol St, Costa Mesa, CA" on a New York page (run 33).

/**
 * Each country's first-level regions as an address writes them: the code and the name. A region
 * is recognised only from this table, so a spelling not in it ("New York State") is never taken
 * for another region. A country missing here is checked by country only.
 */
export const COUNTRY_REGIONS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  US: [
    ["AL", "Alabama"],
    ["AK", "Alaska"],
    ["AZ", "Arizona"],
    ["AR", "Arkansas"],
    ["CA", "California"],
    ["CO", "Colorado"],
    ["CT", "Connecticut"],
    ["DE", "Delaware"],
    ["DC", "District of Columbia"],
    ["FL", "Florida"],
    ["GA", "Georgia"],
    ["HI", "Hawaii"],
    ["ID", "Idaho"],
    ["IL", "Illinois"],
    ["IN", "Indiana"],
    ["IA", "Iowa"],
    ["KS", "Kansas"],
    ["KY", "Kentucky"],
    ["LA", "Louisiana"],
    ["ME", "Maine"],
    ["MD", "Maryland"],
    ["MA", "Massachusetts"],
    ["MI", "Michigan"],
    ["MN", "Minnesota"],
    ["MS", "Mississippi"],
    ["MO", "Missouri"],
    ["MT", "Montana"],
    ["NE", "Nebraska"],
    ["NV", "Nevada"],
    ["NH", "New Hampshire"],
    ["NJ", "New Jersey"],
    ["NM", "New Mexico"],
    ["NY", "New York"],
    ["NC", "North Carolina"],
    ["ND", "North Dakota"],
    ["OH", "Ohio"],
    ["OK", "Oklahoma"],
    ["OR", "Oregon"],
    ["PA", "Pennsylvania"],
    ["RI", "Rhode Island"],
    ["SC", "South Carolina"],
    ["SD", "South Dakota"],
    ["TN", "Tennessee"],
    ["TX", "Texas"],
    ["UT", "Utah"],
    ["VT", "Vermont"],
    ["VA", "Virginia"],
    ["WA", "Washington"],
    ["WV", "West Virginia"],
    ["WI", "Wisconsin"],
    ["WY", "Wyoming"],
    ["PR", "Puerto Rico"],
  ],
  // Brazil's 26 states and the Federal District (IBGE), as addresses write them ("Rio de Janeiro - RJ") (D-420).
  BR: [
    ["AC", "Acre"],
    ["AL", "Alagoas"],
    ["AP", "Amapá"],
    ["AM", "Amazonas"],
    ["BA", "Bahia"],
    ["CE", "Ceará"],
    ["DF", "Distrito Federal"],
    ["ES", "Espírito Santo"],
    ["GO", "Goiás"],
    ["MA", "Maranhão"],
    ["MT", "Mato Grosso"],
    ["MS", "Mato Grosso do Sul"],
    ["MG", "Minas Gerais"],
    ["PA", "Pará"],
    ["PB", "Paraíba"],
    ["PR", "Paraná"],
    ["PE", "Pernambuco"],
    ["PI", "Piauí"],
    ["RJ", "Rio de Janeiro"],
    ["RN", "Rio Grande do Norte"],
    ["RS", "Rio Grande do Sul"],
    ["RO", "Rondônia"],
    ["RR", "Roraima"],
    ["SC", "Santa Catarina"],
    ["SP", "São Paulo"],
    ["SE", "Sergipe"],
    ["TO", "Tocantins"],
  ],
  // India's states and union territories (ISO 3166-2:IN), as addresses write them (D-620).
  IN: [
    ["AP", "Andhra Pradesh"],
    ["AR", "Arunachal Pradesh"],
    ["AS", "Assam"],
    ["BR", "Bihar"],
    ["CT", "Chhattisgarh"],
    ["GA", "Goa"],
    ["GJ", "Gujarat"],
    ["HR", "Haryana"],
    ["HP", "Himachal Pradesh"],
    ["JH", "Jharkhand"],
    ["KA", "Karnataka"],
    ["KL", "Kerala"],
    ["MP", "Madhya Pradesh"],
    ["MH", "Maharashtra"],
    ["MN", "Manipur"],
    ["ML", "Meghalaya"],
    ["MZ", "Mizoram"],
    ["NL", "Nagaland"],
    ["OR", "Odisha"],
    ["PB", "Punjab"],
    ["RJ", "Rajasthan"],
    ["SK", "Sikkim"],
    ["TN", "Tamil Nadu"],
    ["TG", "Telangana"],
    ["TR", "Tripura"],
    ["UP", "Uttar Pradesh"],
    ["UK", "Uttarakhand"],
    ["WB", "West Bengal"],
    ["AN", "Andaman and Nicobar Islands"],
    ["CH", "Chandigarh"],
    ["DH", "Dadra and Nagar Haveli and Daman and Diu"],
    ["DL", "Delhi"],
    ["JK", "Jammu and Kashmir"],
    ["LA", "Ladakh"],
    ["LD", "Lakshadweep"],
    ["PY", "Puducherry"],
  ],
};

/**
 * Towns that count as outside only when they appear right after a comma, as the place's town.
 * Used for names that are also city streets (e.g., "La Plata" is a CABA street).
 */
export const METRO_OUTSIDE_TOWNS_AFTER_COMMA: Readonly<Record<string, readonly string[]>> = {
  "buenos-aires": [
    "La Plata",
    "Ensenada",
    "Quilmes",
    "Avellaneda",
    "Lanús",
    "Lomas de Zamora",
    "Tigre",
    "San Isidro",
    "Pilar",
    "Escobar",
    "Morón",
    "Mar del Plata",
  ],
  // Paris (D-1040): towns that are also Paris streets, stations or gardens (Gare de Lyon, rue de Rennes, avenue de
  // Versailles, Jardin du Luxembourg, rue de Londres) count only as an address's town, after a comma.
  // Delhi (D-1140): Jaipur House (NGMA) and Mathura Road, Meerut Road are inside, so these only as a town.
  delhi: ["Jaipur", "Mathura", "Meerut", "Agra", "Alwar", "Rohtak"],
  paris: [
    "Versailles",
    "Lyon",
    "Marseille",
    "Lille",
    "Strasbourg",
    "Nantes",
    "Rennes",
    "Reims",
    "Rouen",
    "Fontainebleau",
    "Pontoise",
    "Poissy",
    "Rambouillet",
    "Meaux",
    "Nice",
    "Bruxelles",
    "Amsterdam",
    "Londres",
    "London",
    "Luxembourg",
  ],
};

/**
 * The first-level regions each metro's radius reaches, by code in `COUNTRY_REGIONS`. A metro
 * missing here is checked by country only.
 */
export const METRO_REGIONS: Readonly<Record<string, readonly string[]>> = {
  // The five boroughs, all in New York State (D-084); the borough outline does the rest
  // (src/domain/metro-bounds.ts).
  nyc: ["NY"],
  // The City of Philadelphia and its near suburbs (D-300, D-511), all in Pennsylvania: a New Jersey address (Camden, Cherry
  // Hill) is outside; the county outline does the rest.
  philadelphia: ["PA"],
  // Orleans and Jefferson Parishes, Louisiana (D-340, D-555).
  "new-orleans": ["LA"],
  // Miami-Dade County, Florida (D-320).
  miami: ["FL"],
  // Wake and Durham Counties, North Carolina (D-600, D-601).
  raleigh: ["NC"],
  // Davidson County, Tennessee (D-1200).
  nashville: ["TN"],
  // Los Angeles County, California (D-1160).
  "los-angeles": ["CA"],
  // Travis County and the City of Austin, Texas (D-1180).
  austin: ["TX"],
  // Rio de Janeiro and Niterói, both in the state of Rio de Janeiro (D-420).
  "rio-de-janeiro": ["RJ"],
  // Five municipios of Puerto Rico (D-460); the outline does the rest.
  "san-juan": ["PR"],
  // Greater Mumbai, Maharashtra (D-620); the outline does the rest.
  mumbai: ["MH"],
  // NCT Delhi, Gurugram district (Haryana) and Gautam Buddh Nagar (Noida, Uttar Pradesh) (D-1140).
  delhi: ["DL", "HR", "UP"],
  // Pune, Pimpri-Chinchwad and Hinjewadi, Maharashtra (D-1120); the outline does the rest.
  pune: ["MH"],
};

/**
 * The postal-code prefixes of the places inside each metro. A listing address whose postal code
 * (`postcodeOf`, src/domain/postcode.ts) starts with none of them is outside the metro, whatever
 * the geocoder answers. A metro missing here is not checked this way. New York City: Manhattan
 * 100-102, Staten Island 103, the Bronx 104, Queens 110, 111, 113, 114, 116, Brooklyn 112 (USPS).
 */
export const METRO_POSTCODE_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  nyc: ["100", "101", "102", "103", "104", "110", "111", "112", "113", "114", "116"],
  // Orleans Parish (USPS): every New Orleans ZIP is 701xx (70112-70131 and PO boxes 70139-70190); 70121-70123 also
  // reach into Jefferson Parish. Jefferson Parish (D-555): Metairie 70001-70006, Kenner 70062-70065, Gretna and Harvey
  // 70053-70058, Marrero 70072, Westwego 70094. A deliberate superset: 700 also holds St. Bernard, Plaquemines,
  // St. Charles and St. John towns; the outline and the outside towns catch those. Grand Isle (70358) is left to the
  // outline: 703 would let Houma and Thibodaux in.
  "new-orleans": ["700", "701"],
  // Prefecture of Marrakech (Barid Al-Maghrib): every Marrakech code is 40xxx; Al Haouz (Tahannaout, Ourika, Asni)
  // is 42xxx and Chichaoua 41xxx, so those addresses are outside (D-1100).
  marrakesh: ["40"],
  // Ciudad de Mexico (Correos de Mexico): every Mexico City codigo postal is 01000-16999 (01 Alvaro Obregon to 16
  // Xochimilco); Estado de Mexico's are 50000-57999, so Neza, Naucalpan and Ecatepec addresses are outside (D-440).
  "mexico-city": [
    "01",
    "02",
    "03",
    "04",
    "05",
    "06",
    "07",
    "08",
    "09",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
  ],
  // Miami-Dade County (USPS): 330xx (Hialeah 33010-33018, Homestead and Florida City 33030-33035, Opa-locka and
  // Miami Gardens 33054-33056), 331xx and 332xx. A deliberate superset (#292): 330 also holds Broward's Hallandale
  // Beach, Hollywood and Pembroke Pines (33009, 33019-33029); the outline and the outside towns catch those.
  miami: ["330", "331", "332"],
  // Wake County (USPS): Raleigh 276xx; Cary, Apex, Garner, Holly Springs, Fuquay-Varina, Knightdale, Morrisville,
  // Rolesville, Wake Forest, Wendell and Zebulon 275xx. Durham County (D-601): Durham and Research Triangle Park
  // 277xx; Bahama and Rougemont 275xx. A deliberate superset (#292): 275 also holds Chapel Hill and Carrboro
  // (27510, 27514-27517) and Johnston/Franklin towns; the outline and the outside towns catch those.
  raleigh: ["275", "276", "277"],
  // Davidson County (USPS): Nashville 372xx; Antioch, Goodlettsville, Hermitage, Joelton and parts of Brentwood
  // 370xx; Madison, Old Hickory and Whites Creek 371xx. A deliberate superset (#292): 370 and 371 also hold
  // Franklin, Murfreesboro, Hendersonville, Mount Juliet and other Middle Tennessee towns; the outline and the
  // outside towns catch those (D-1200).
  nashville: ["370", "371", "372"],
  // Los Angeles County (USPS, D-1160): 900-908 (Los Angeles, Inglewood, Santa Monica, Torrance, Whittier, Long Beach,
  // Avalon), 910-918 (Pasadena, Glendale, the San Fernando and Santa Clarita valleys, Burbank, the San Gabriel Valley,
  // Pomona) and 935 (Lancaster, Palmdale). A deliberate superset (#292): 906/907 also hold Orange County's La Habra,
  // Buena Park, Cypress and Seal Beach, 913 Ventura County's Thousand Oaks, 917 San Bernardino County's Chino and
  // Ontario, 935 Kern County's Mojave; the outline and the outside towns catch those.
  "los-angeles": [
    "900",
    "901",
    "902",
    "903",
    "904",
    "905",
    "906",
    "907",
    "908",
    "910",
    "911",
    "912",
    "913",
    "914",
    "915",
    "916",
    "917",
    "918",
    "935",
  ],
  // Travis County and the City of Austin (USPS): Austin, West Lake Hills, Rollingwood, Bee Cave, Lakeway, Sunset
  // Valley 787xx; Pflugerville 78660, Manor 78653, Del Valle 78617, Manchaca 78652, Lago Vista and Jonestown 78645,
  // Spicewood 78669 (786xx). A deliberate superset (#292): 786 also holds Round Rock, Georgetown, Cedar Park, Leander,
  // San Marcos, Kyle and Buda; the outline and the outside towns catch those.
  austin: ["786", "787"],
  // The Lisbon Metropolitan Area (CTT, D-380): every City of Lisbon code is 1xxx-xxx; the other 17 municipalities
  // use 2600-2999 (Vila Franca 2600-2625, Odivelas 2620-2675, Loures 2660-2695, Amadora 2700-2720, Sintra
  // 2605-2749, Oeiras 2730-2795, Cascais 2645-2785, Mafra 2640-2669, Almada 2800-2829, Barreiro and Moita
  // 2830-2864, Seixal 2840-2865, Montijo 2870 and 2985, Alcochete 2890, Setúbal 2900-2925, Palmela 2950-2965,
  // Sesimbra 2970-2975), plus a few Odivelas and Oeiras codes in 1675-1685 and 1495. A deliberate superset
  // (#292): 26xx also holds Arruda dos Vinhos (2630), outside; the outline catches it.
  lisbon: ["1", "26", "27", "28", "29"],
  // Greater London (Royal Mail): the London postal district by area and first digit, so "N1" takes
  // N1-N22 but never Norwich NR, Northampton NN or Newcastle NE; then the twelve outer areas that
  // reach into London (BR, CR, DA, EN, HA, IG, KT, RM, SM, TW, UB, WD). Those outer areas also hold
  // towns outside London; listing them whole keeps every London listing (coverage first), and the
  // outside towns below and the metro outline catch the rest.
  london: [
    ...["E", "N", "NW", "SE", "SW", "W"].flatMap((area) =>
      ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => area + digit),
    ),
    "EC",
    "WC",
    ...["BR", "CR", "DA", "EN", "HA", "IG", "KT", "RM", "SM", "TW", "UB", "WD"],
  ],
  // The City of Philadelphia (USPS): every street ZIP is 191xx; the near suburbs (D-511: Delaware County, Lower Merion,
  // Narberth, Cheltenham, Abington, Jenkintown, Rockledge) are all 190xx. 190 is a deliberate superset (lower Bucks
  // County such as Bensalem 19020 is 190 too), which the outline and the outside towns catch. 194xx (Norristown,
  // King of Prussia), 193xx (Chester County), New Jersey 08xxx and Delaware 197xx-198xx stay out.
  philadelphia: ["191", "190"],
  // The Ciudad Autónoma de Buenos Aires (D-400): a CPA starts with C ("C1414ABC"), and the old four-digit codes
  // run 1000-1499. The province of Buenos Aires is B and 1600 up (Olivos B1636, Avellaneda 1870).
  "buenos-aires": ["C", "10", "11", "12", "13", "14"],
  // The Barcelonès (Correos): Barcelona 08001-08042, L'Hospitalet de Llobregat 08901-08908, Badalona
  // 08911-08918, Santa Coloma de Gramenet 08921-08924, Sant Adrià de Besòs 08930 (D-360). Not "089" whole:
  // Cornellà 08940, Esplugues 08950 and Sant Joan Despí 08970 are outside.
  barcelona: ["080", "0890", "0891", "0892", "08930"],
  // Rio de Janeiro and Niterói (Correios CEP ranges): the city of Rio is 20000-000 to 23799-999 (2300x-2379x;
  // 238xx is Itaguaí), Niterói 24000-000 to 24399-999; São Gonçalo (244xx-247xx) and the Baixada (25xxx-26xxx)
  // are outside. Prefixes match the CEP as `postcodeOf` returns it, five or eight digits (D-420).
  "rio-de-janeiro": [
    "20",
    "21",
    "22",
    "230",
    "231",
    "232",
    "233",
    "234",
    "235",
    "236",
    "237",
    "240",
    "241",
    "242",
    "243",
  ],
  // The five municipios' ZIPs are all 009xx (San Juan 00901-00940, Bayamón 00956-00961, Cataño 00962-00963,
  // Guaynabo 00965-00971, Carolina 00979-00987); a deliberate superset (#292): 009 also holds Toa Baja
  // (00949-00952) and Trujillo Alto (00976-00977), which the outline and the outside towns catch.
  "san-juan": ["009"],
  // Greater Mumbai's PIN codes are 400001-400104 (India Post), so "4000" and "4001"; Thane (4006xx), Navi Mumbai
  // (4007xx, 410xxx) and Mira-Bhayandar (4011xx) are outside (D-620).
  mumbai: ["4000", "4001"],
  // Delhi (D-1140), India Post: NCT Delhi is 110001-110097; Gurugram district 122001-122508 (Manesar 122050-122052,
  // Sohna 122103, Pataudi 122503); Gautam Buddh Nagar is Noida/Greater Noida 201301-201318, Dadri 203207, Dankaur
  // 203201, Jewar 203135. A deliberate superset (#292): 122 also holds Nuh, 2031/2032 parts of Bulandshahr, which the
  // outline catches. Ghaziabad (2010xx-2012xx) and Faridabad (1210xx) are outside.
  delhi: ["110", "122", "2013", "2031", "2032"],
  // Pune's and Pimpri-Chinchwad's PIN codes are 4110xx (Pune 411001-411062, Pimpri-Chinchwad 411017-411062,
  // Hinjewadi 411057; India Post), plus Ravet and Dehu Road 412101 and Moshi 412105 in Pimpri-Chinchwad; other 412xxx and
  // 410xxx codes (Wagholi 412207, Talegaon 410507, Lonavala 410401) are outside (D-1120). A deliberate superset (#292):
  // 4110 also holds a few villages past the line, which the outline catches.
  pune: ["4110", "412101", "412105"],
  // Colombian 6-digit codes start with the department's two digits (05 = Antioquia; OSM wiki "Colombia/Guide for
  // mapping postal codes"). The 4-72 code for each of the 10 municipalities is unverified, so this is the whole
  // department, a deliberate superset (#292): an 05 code outside the 10 municipalities is left to the outline.
  medellin: ["05"],
  // Istanbul province (PTT, D-680): every code is 34xxx (Fatih 34080-34130, Beyoğlu 34420-34440, Kadıköy
  // 34700-34730, Silivri 34570-34580, Şile 34980); 34 is no other province's code.
  istanbul: ["34"],
  // Berlin's codes are 10115-14199 (Deutsche Post): 10xxx, 12xxx, 13xxx and 140xx-141xx. Brandenburg uses
  // 14xxx from 14400 up (Potsdam 144xx-145xx), 15xxx and 16xxx. 12529 Schönefeld is Brandenburg but kept by
  // the 12 prefix, a deliberate superset (#292): the outline decides it (D-1020).
  berlin: ["10", "12", "13", "140", "141"],
  // Metropole du Grand Paris (La Poste, D-1040): Paris 75xxx, every commune of Hauts-de-Seine 92, Seine-Saint-Denis
  // 93 and Val-de-Marne 94; Argenteuil 95100; Athis-Mons 91200, Juvisy-sur-Orge 91260, Morangis 91420,
  // Paray-Vieille-Poste 91550, Savigny-sur-Orge 91600, Viry-Chatillon 91170.
  paris: ["75", "92", "93", "94", "95100", "91200", "91260", "91420", "91550", "91600", "91170"],
  // Tulum and Solidaridad (Correos de Mexico): every code is 777xx (Playa del Carmen 77710-77728, Puerto Aventuras
  // 77733, Akumal 77776, Tulum 77760-77796). Cancun 775xx, Puerto Morelos 77580 and Cozumel 776xx are outside (D-1080).
  tulum: ["777"],
  // Tokyo's postcodes (Japan Post) are 100-0000 to 208-xxxx: the 23 wards 100-178, Tama 180-208. Codes are
  // normalised to 7 digits (D-1222). A deliberate superset (#292): 1 also holds the Izu and Ogasawara islands
  // (100-01xx to 100-21xx) and Sagamihara's 199-xxxx, which the outline catches. Kanagawa is 210-259, Saitama
  // 330-369, Chiba 260-299.
  tokyo: ["1", "20"],
};

/**
 * Towns outside a metro that its sources' titles name ("Hartford Tango Practica" on theronda.us/nyc,
 * 2026-10-20). A listing with no point and no address whose title names one is not the metro's night.
 * Never list a name that is also a place inside the metro ("Long Island" would catch Long Island City).
 */
export const METRO_OUTSIDE_TOWNS: Readonly<Record<string, readonly string[]>> = {
  nyc: [
    "Hartford",
    "Stony Brook",
    "New Haven",
    "Philadelphia",
    "Princeton",
    "Hoboken",
    "Jersey City",
    "Newark",
    "White Plains",
    "Yonkers",
    "Westchester",
    // New Jersey towns the tango directory theronda.us names in venue names (2026-10-22).
    "Paramus",
    "Park Ridge",
    "Edgewater",
    "Englewood",
    "Red Bank",
    "Milford",
    // Other cities Daybreaker's events page lists (2026-10-22); names that also name New York
    // places, DJs or styles (Washington, Chicago, Berlin, Paris, London, Miami) are left out.
    "San Francisco",
    "Los Angeles",
    "San Diego",
    "Mexico City",
    "Atlanta",
    "Nashville",
    "Toronto",
    "Denver",
    "Seattle",
    // Towns FURBALL's NYC page names for its out-of-town parties (2026-10-25).
    "Palm Springs",
    "Provincetown",
    "P'Town",
    "P\u2019Town",
    "Fire Island",
    "Asbury Park",
  ],
  // Towns and cities outside Greater London that its sources' titles name: the national Ceroc
  // calendar's (first London run, 2026-10-27) and the usual weekend trips. Names that are also
  // London places are left out (Oxford Street, Cambridge Heath, Leicester Square, Old Kent Road,
  // Surrey Quays, Essex Road, Coventry Street, Norfolk Square, Rugby Street, Gillingham Street,
  // Scotland Yard, Duke of York's), as are words with other meanings (Reading, Bath) and names
  // parties borrow (Berlin, Ibiza).
  london: [
    "Ipswich",
    "Norwich",
    "Shrewsbury",
    "Swindon",
    "Tadcaster",
    "Faversham",
    "Bishops Cleeve",
    "Brighton",
    "Manchester",
    "Birmingham",
    "Bristol",
    "Leeds",
    "Liverpool",
    "Sheffield",
    "Nottingham",
    "Newcastle",
    "Edinburgh",
    "Glasgow",
    "Cardiff",
    "Watford",
    "St Albans",
    "Luton",
    "Milton Keynes",
    "Guildford",
    "Southend",
    "Chelmsford",
    "Basingstoke",
    "Southampton",
    "Portsmouth",
    "Bournemouth",
    "Canterbury",
    "Maidstone",
    "Hastings",
    "Eastbourne",
    "Crawley",
    "Horsham",
    "Stevenage",
    "Hemel Hempstead",
    "High Wycombe",
    "Slough",
    "Maidenhead",
    "Bracknell",
    "Woking",
    "Colchester",
    "Harlow",
    "Basildon",
    "Gravesend",
    "Tunbridge Wells",
    "Sevenoaks",
    // A county an event page's address names with no postcode (shoobs, 2026-10-29).
    "Leicestershire",
  ],
  // Towns outside Philadelphia's area (the City plus the near suburbs, D-511), a starting list (D-300): New Jersey across the river
  // and the outer suburbs. Names that are also Philadelphia streets or places are left out (Lancaster,
  // Baltimore, Bethlehem, Reading, Chester, Lansdowne, Bryn Mawr, Easton, Germantown), as are
  // words with other meanings (Media, Wayne) and New York (its parties tour here). The near
  // suburbs' own towns (Upper Darby, Media, Swarthmore, Ardmore, Bala Cynwyd, Narberth, Glenside, Jenkintown, Elkins
  // Park) are inside since D-511 and must not be listed.
  philadelphia: [
    "Camden",
    "Cherry Hill",
    "Collingswood",
    "Haddonfield",
    "Trenton",
    "Princeton",
    "Atlantic City",
    "Wilmington",
    "Conshohocken",
    "King of Prussia",
    "Norristown",
    "Bensalem",
    "Doylestown",
    "New Hope",
    "Phoenixville",
    "West Chester",
    "Allentown",
    "Lambertville",
  ],
  // Towns outside Orleans and Jefferson Parishes that source titles may name (D-340, D-555): St. Bernard,
  // Plaquemines, St. Tammany and the River Parishes, Cajun country, the Mississippi coast. Metairie, Kenner, Gretna,
  // Harahan, River Ridge, Marrero, Westwego and Terrytown are inside since D-555 and must not be listed. Left out
  // because they are also New Orleans places or people: Lafayette (Lafayette Square, Lafayette Cemetery),
  // Mandeville (Mandeville Street), Jefferson (Jefferson Avenue), Lafitte (Lafitte Street), Harvey (a surname).
  "new-orleans": [
    "Belle Chasse",
    "Chalmette",
    "Arabi",
    "Meraux",
    "Slidell",
    "Covington",
    "Hammond",
    "Laplace",
    "LaPlace",
    "Houma",
    "Thibodaux",
    "Baton Rouge",
    "Breaux Bridge",
    "Opelousas",
    "Eunice",
    "Lake Charles",
    "Biloxi",
    "Gulfport",
    "Bay St. Louis",
    "Pass Christian",
    "Ocean Springs",
  ],
  // Towns outside Miami-Dade that Miami listings name (D-320; Eventbrite, DICE and Salsa Vida "Miami" results,
  // 2026-10-29): Broward, Palm Beach, the Keys and other Florida cities. Left out because they are also Miami-Dade
  // places, streets or plain words: Hollywood alone (a party theme; only "Hollywood, FL" and Hollywood Beach),
  // Miramar (also an Edgewater neighbourhood), Plantation, Sunrise, West Park, Wellington, Jupiter, Marathon,
  // Naples, and every "Miami ..." city (Miami Gardens, Miami Lakes, Miami Shores, Miami Springs are inside).
  miami: [
    "Fort Lauderdale",
    "Ft. Lauderdale",
    "Ft Lauderdale",
    "Hallandale Beach",
    "Hallandale",
    "Hollywood Beach",
    "Hollywood, FL",
    "Hollywood, Florida",
    "Dania Beach",
    "Pembroke Pines",
    "Pembroke Park",
    "Davie",
    "Weston",
    "Cooper City",
    "Southwest Ranches",
    "Wilton Manors",
    "Lauderhill",
    "Lauderdale Lakes",
    "Lauderdale-by-the-Sea",
    "Tamarac",
    "Oakland Park",
    "Coral Springs",
    "Coconut Creek",
    "Margate",
    "Pompano Beach",
    "Deerfield Beach",
    "Parkland",
    "Boca Raton",
    "Delray Beach",
    "Boynton Beach",
    "Lake Worth",
    "West Palm Beach",
    "Palm Beach Gardens",
    "Royal Palm Beach",
    "Key West",
    "Key Largo",
    "Islamorada",
    "Fort Myers",
    "Orlando",
    "Tampa",
    "Sarasota",
    "St. Petersburg",
    "Gainesville",
    "Jacksonville",
  ],
  // Towns outside Wake and Durham Counties that Raleigh listings name (D-600, D-601): the rest of the Triangle
  // (Chapel Hill, Carrboro, Hillsborough, Pittsboro), Johnston and Franklin County towns, and North Carolina's
  // other cities. Durham, Research Triangle Park and "RTP" are inside since D-601 and must not be listed.
  // Left out because they are also Wake or Durham places, streets or plain words: Oxford, Clayton and Greenville
  // alone (people and other states; only "Clayton, NC" and "Greenville, NC"), Cary, Garner, Apex and every Wake town.
  // Towns outside Travis County and the City of Austin that Austin listings name (D-1180): the Williamson and Hays
  // County suburbs, the Hill Country dance-hall towns (Gruene Hall is in New Braunfels) and Texas's other cities.
  // Written with ", TX" where the bare word is also a first name, surname or plain word (Kyle, Taylor, Temple, Buda,
  // Elgin, Lockhart, Bryan, Georgetown, Houston, Dallas). Left out because they are also Travis places: Pflugerville,
  // Manor, Lakeway, Bee Cave, Del Valle, Lago Vista, Jonestown, Spicewood, Manchaca.
  austin: [
    "Round Rock",
    "Georgetown, TX",
    "Cedar Park",
    "Leander",
    "Liberty Hill",
    "Hutto",
    "Taylor, TX",
    "San Marcos",
    "Kyle, TX",
    "Buda, TX",
    "Dripping Springs",
    "Wimberley",
    "Bastrop",
    "Elgin, TX",
    "Lockhart, TX",
    "New Braunfels",
    "Gruene",
    "Luling",
    "Marble Falls",
    "San Antonio",
    "Houston, TX",
    "Dallas, TX",
    "Fort Worth",
    "Waco",
    "Temple, TX",
    "Killeen",
    "College Station",
    "Bryan, TX",
  ],
  raleigh: [
    "Chapel Hill",
    "Carrboro",
    "Hillsborough",
    "Pittsboro",
    "Clayton, NC",
    "Smithfield",
    "Selma, NC",
    "Benson, NC",
    "Louisburg",
    "Franklinton",
    "Youngsville",
    "Creedmoor",
    "Butner",
    "Sanford",
    "Burlington",
    "Mebane",
    "Greensboro",
    "Winston-Salem",
    "High Point",
    "Charlotte",
    "Fayetteville",
    "Wilmington",
    "Asheville",
    "Goldsboro",
    "Greenville, NC",
    "Rocky Mount",
    "Wilson, NC",
    "Myrtle Beach",
  ],
  // Towns outside Davidson County that Nashville listings name (D-1200): Williamson, Rutherford, Sumner, Wilson,
  // Robertson, Cheatham and Maury County towns and Tennessee's and nearby states' other cities. Nashville streets
  // carry town names (Franklin Pike, Murfreesboro Pike, Gallatin Pike, Lebanon Pike, Clarksville Pike, Nolensville
  // Pike, Dickson Street), and so do songs and styles ("Chattanooga Choo Choo", Memphis soul, Memphis jookin): those
  // towns only with ", TN". Brentwood and Goodlettsville are left out: both reach into Davidson County (Brentwood's
  // 37027 ZIP, Goodlettsville's Davidson half).
  nashville: [
    "Franklin, TN",
    "Murfreesboro, TN",
    "Gallatin, TN",
    "Lebanon, TN",
    "Clarksville, TN",
    "Nolensville, TN",
    "Dickson, TN",
    "Columbia, TN",
    "Springfield, TN",
    "Smyrna, TN",
    "Hendersonville",
    "Mount Juliet",
    "Mt. Juliet",
    "Mt Juliet",
    "La Vergne",
    "Spring Hill, TN",
    "Thompson's Station",
    "White House, TN",
    "Kingston Springs",
    "Ashland City",
    "Fairview, TN",
    "Cookeville",
    "Tullahoma",
    "Knoxville",
    "Chattanooga, TN",
    "Memphis, TN",
    "Bowling Green",
    "Huntsville",
  ],
  // Towns outside Los Angeles County that its listings name (D-1160): Orange, Ventura, Riverside and San Bernardino
  // county towns, and California's and Nevada's other cities. Left out because they are also LA streets, places or
  // plain words: Ventura (Ventura Blvd), Riverside (Riverside Dr), Brea (La Brea Ave), Orange, Corona, Cypress,
  // Westminster (Westminster Ave, Venice), Westlake Village (partly in the county), and
  // San Clemente only with ", CA" (San Clemente Island is Los Angeles County).
  "los-angeles": [
    "Orange County",
    "Anaheim",
    "Irvine",
    "Santa Ana",
    "Huntington Beach",
    "Newport Beach",
    "Costa Mesa",
    "Fullerton",
    "Garden Grove",
    "Laguna Beach",
    "Buena Park",
    "Tustin",
    "Mission Viejo",
    "Dana Point",
    "San Clemente, CA",
    "Seal Beach",
    "La Habra",
    "Yorba Linda",
    "Placentia",
    "Oxnard",
    "Ventura, CA",
    "Thousand Oaks",
    "Simi Valley",
    "Camarillo",
    "Moorpark",
    "Newbury Park",
    "Riverside, CA",
    "Temecula",
    "Moreno Valley",
    "Murrieta",
    "Palm Springs",
    "Palm Desert",
    "Indio",
    "Inland Empire",
    "San Bernardino",
    "Ontario, CA",
    "Rancho Cucamonga",
    "Upland",
    "Chino",
    "Fontana",
    "Redlands",
    "Big Bear",
    "San Diego",
    "Santa Barbara",
    "Bakersfield",
    "Las Vegas",
    "San Francisco",
    "Oakland",
    "San Jose",
    "Sacramento",
    "Fresno",
  ],
  // Towns outside the Lisbon Metropolitan Area that listings name (D-380): Portugal's other cities, the coast and
  // the Algarve, and the towns just past the 18 municipalities. Left out because they are also words, names or
  // Lisbon places: Porto ("Porto Tonic", port wine), Madeira (wine, wood), Fátima, Lagos, Alentejo (Casa do
  // Alentejo is a Lisbon hall), Ribatejo, and every place inside (Ericeira, Sintra, Setúbal, Cascais, Almada).
  lisbon: [
    "Coimbra",
    "Braga",
    "Aveiro",
    "Guimarães",
    "Viseu",
    "Leiria",
    "Santarém",
    "Évora",
    "Evora",
    "Faro",
    "Albufeira",
    "Portimão",
    "Vilamoura",
    "Algarve",
    "Funchal",
    "Ponta Delgada",
    "Açores",
    "Azores",
    "Torres Vedras",
    "Caldas da Rainha",
    "Óbidos",
    "Peniche",
    "Nazaré",
    "Alenquer",
    "Arruda dos Vinhos",
    "Benavente",
    "Samora Correia",
    "Comporta",
    "Tróia",
    "Troia",
    "Grândola",
    "Sines",
    "Vila Nova de Gaia",
    "Matosinhos",
    "Madrid",
    "Seville",
    "Sevilla",
  ],
  // Greater Buenos Aires towns and nearby cities that tango and salsa titles name (Hoy Milonga, 2026-10-29). Each was
  // checked against the City's street list (USIG callejero) and its 48 barrios. Left out because they are also CABA
  // streets: Olivos, Martínez, Acassuso, San Isidro, Tigre, Pilar, Escobar, San Martín, Caseros, Ciudadela, Haedo,
  // Ramos Mejía, Castelar, Morón, Ituzaingó, Moreno, Lanús, Avellaneda, Wilde, Sarandí, Bernal, Quilmes, Lomas de
  // Zamora, Temperley, Ezeiza, La Plata, Ensenada, Mar del Plata, Rosario, Montevideo, Córdoba, Sáenz Peña, Bella
  // Vista, Vicente López, Remedios de Escalada, Valentín Alsina, Martín Coronado, José C. Paz, Tres de Febrero.
  "buenos-aires": [
    "La Lucila",
    "Florida Oeste",
    "Munro",
    "Villa Martelli",
    "Villa Adelina",
    "Beccar",
    "San Fernando",
    "Nordelta",
    "Benavídez",
    "Benavidez",
    "Don Torcuato",
    "Ingeniero Maschwitz",
    "Garín",
    "Garin",
    "Villa Ballester",
    "El Palomar",
    "Hurlingham",
    "Paso del Rey",
    "Merlo",
    "San Justo",
    "Gerli",
    "Berazategui",
    "Florencio Varela",
    "Banfield",
    "Adrogué",
    "Adrogue",
    "Burzaco",
    "Longchamps",
    "Glew",
    "Monte Grande",
    "Luis Guillón",
    "Luis Guillon",
    "City Bell",
    "Gonnet",
    "Villa Sarmiento",
    "Colonia del Sacramento",
  ],
  // Towns outside the Barcelonès that Barcelona listings name (D-360): the rest of the metropolitan area,
  // the coast and Catalan cities. Left out: Girona, Tarragona, Lleida and València (Eixample streets carry
  // their names), Sabadell (a bank's name on Barcelona halls), and any name an inside town shares ("Santa
  // Coloma" alone would catch Santa Coloma de Gramenet).
  barcelona: [
    "Castelldefels",
    "Sitges",
    "Cornellà",
    "Cornella",
    "Esplugues",
    "Sant Cugat",
    "El Prat de Llobregat",
    "Gavà",
    "Viladecans",
    "Sant Boi",
    "Sant Feliu de Llobregat",
    "Sant Joan Despí",
    "Sant Just Desvern",
    "Molins de Rei",
    "Cerdanyola",
    "Montcada i Reixac",
    "Montgat",
    "El Masnou",
    "Mataró",
    "Terrassa",
    "Granollers",
    "Vilanova i la Geltrú",
    "Lloret de Mar",
    "Salou",
    "Reus",
    "Torredembarra",
    "Blanes",
    "Igualada",
    "Madrid",
  ],
  // Towns outside Mexico City that its listings name (D-440; Salsa Vida "Mexico City" nights in Neza, Tlalnepantla and
  // Cuautitlan Izcalli, 2026-10-29): Estado de Mexico municipalities around the city, plus weekend-trip towns. Left out
  // because Roma, Condesa and Juarez streets carry their names: Puebla, Cuernavaca, Pachuca, Toluca, Queretaro,
  // Guadalajara, Monterrey, Acapulco, Durango and the other state names; "La Paz" and "Santa Fe" (Santa Fe is inside);
  // "Gustavo Baz" (an avenue). "Ciudad de Mexico" names both the city and the country's capital region: never listed.
  // Hong Kong (D-660): Shenzhen, Macau and the Pearl River Delta cities just outside.
  "hong-kong": [
    "Shenzhen",
    "深圳",
    "Macau",
    "Macao",
    "澳門",
    "澳门",
    "Zhuhai",
    "珠海",
    "Guangzhou",
    "廣州",
    "广州",
    "Dongguan",
    "東莞",
  ],
  "mexico-city": [
    "Estado de México",
    "Edomex",
    "Edo. Méx",
    "Edo Mex",
    "Nezahualcóyotl",
    "Nezahualcoyotl",
    "Neza",
    "Ecatepec",
    "Tlalnepantla",
    "Naucalpan",
    "Ciudad Satélite",
    "Cuautitlán Izcalli",
    "Cuautitlan Izcalli",
    "Cuautitlán",
    "Atizapán",
    "Atizapan",
    "Huixquilucan",
    "Interlomas",
    "Chimalhuacán",
    "Chalco",
    "Ixtapaluca",
    "Texcoco",
    "Tecámac",
    "Coacalco",
    "Tultitlán",
    "Nicolás Romero",
    "Metepec",
    "Tepoztlán",
    "Valle de Bravo",
  ],
  // Towns around Rio de Janeiro and Niterói and the cities Rio's touring nights name (D-420), written with and
  // without accents. Left out on purpose: names that are also Rio places or common words (Campo Grande and Santa
  // Cruz are Rio bairros, Natal is Christmas, Vitória victory, Recife a reef, Fortaleza a fort in Niterói, Belém
  // also Lisbon's, Queimados "burnt", Mesquita a surname, Itaipava a beer brand).
  "rio-de-janeiro": [
    "São Gonçalo",
    "Sao Goncalo",
    "Duque de Caxias",
    "Nova Iguaçu",
    "Nova Iguacu",
    "Belford Roxo",
    "São João de Meriti",
    "Sao Joao de Meriti",
    "Nilópolis",
    "Nilopolis",
    "Itaboraí",
    "Itaborai",
    "Maricá",
    "Marica",
    "Magé",
    "Saquarema",
    "Petrópolis",
    "Petropolis",
    "Teresópolis",
    "Teresopolis",
    "Nova Friburgo",
    "Búzios",
    "Buzios",
    "Cabo Frio",
    "Arraial do Cabo",
    "Macaé",
    "Macae",
    "Angra dos Reis",
    "Ilha Grande",
    "Paraty",
    "Itaguaí",
    "Itaguai",
    "Volta Redonda",
    "Juiz de Fora",
    "São Paulo",
    "Sao Paulo",
    "Belo Horizonte",
    "Brasília",
    "Brasilia",
    "Curitiba",
    "Florianópolis",
    "Florianopolis",
    "Porto Alegre",
  ],
  // Towns outside Delhi + Gurugram + Noida that titles name (D-1140). Never a place inside it: no "Delhi",
  // "Gurgaon", "Noida", "Greater Noida", "Aerocity", "Dwarka", "Okhla". Left out because they are Delhi streets or
  // venues: Mathura (Mathura Road), Jaipur (Jaipur House), Meerut, Rohtak and Alwar (roads), Agra (Agra Canal);
  // Goa and Manali (Goa trance and Manali trance nights), Bombay (venue names).
  delhi: [
    "Ghaziabad",
    "Indirapuram",
    "Kaushambi",
    "Faridabad",
    "Sonipat",
    "Sonepat",
    "Bahadurgarh",
    "Jhajjar",
    "Panipat",
    "Rewari",
    "Neemrana",
    "Chandigarh",
    "Dehradun",
    "Rishikesh",
    "Shimla",
    "Mumbai",
    "Pune",
    "Bengaluru",
    "Bangalore",
    "Hyderabad",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
    "Lucknow",
    "Dubai",
  ],
  // Towns outside Greater Mumbai that titles name (D-620). Never a place inside it: no "Bombay",
  // "Andheri", "Juhu" or "Powai".
  mumbai: [
    "Thane",
    "Navi Mumbai",
    "Vashi",
    "Kharghar",
    "Belapur",
    "Panvel",
    "Kalyan",
    "Dombivli",
    "Mira Road",
    "Bhayandar",
    "Vasai",
    "Virar",
    "Lonavala",
    "Khandala",
    "Alibaug",
    "Karjat",
    "Pune",
    "Nashik",
    "Goa",
    "New Delhi",
    "Delhi",
    "Gurgaon",
    "Gurugram",
    "Bengaluru",
    "Bangalore",
    "Hyderabad",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
    "Jaipur",
    "Dubai",
  ],
  // Towns outside Pune, Pimpri-Chinchwad and Hinjewadi that titles name (D-1120): the hill stations and weekend
  // towns around Pune, Mumbai and its neighbours, and India's other big cities. Never a place inside: no "Poona",
  // "Camp", "Pimpri", "Chinchwad", "Hinjewadi", "Kharadi" or "Mundhwa"; "Wagholi" and "Undri" are left to the outline.
  pune: [
    "Mumbai",
    "Navi Mumbai",
    "Thane",
    "Lonavala",
    "Khandala",
    "Lavasa",
    "Talegaon",
    "Chakan",
    "Kamshet",
    "Mahabaleshwar",
    "Panchgani",
    "Satara",
    "Kolhapur",
    "Nashik",
    "Aurangabad",
    "Nagpur",
    "Alibaug",
    "Goa",
    "New Delhi",
    "Delhi",
    "Gurgaon",
    "Gurugram",
    "Bengaluru",
    "Bangalore",
    "Hyderabad",
    "Chennai",
    "Kolkata",
    "Ahmedabad",
    "Jaipur",
    "Dubai",
  ],
  // Towns outside the five municipios that San Juan listings name (D-460, Eventbrite and Salsa Vida
  // San Juan results 2026-10-29). Left out on purpose because they are also San Juan streets, places or plain words:
  // Ponce (Avenida Ponce de León), Loíza (Calle Loíza, Santurce, and the Loíza subbarrio), Rincón (a plain word,
  // "corner"), Isla Verde (inside, in Carolina), Condado, Hato Rey, Río Piedras, Bayamón, Guaynabo, Carolina, Cataño.
  // Towns outside Istanbul province that listings name (D-680): Turkey's other cities and resorts, Thrace and
  // the Marmara towns past the province line, and the nearby foreign capitals. Left out because they are also
  // Turkish words or Istanbul places: Bodrum ("bodrum kat" = basement floor), Çeşme ("fountain"; Kuruçeşme),
  // Edirne (Edirnekapı), Bolu, Kaş, Side, Datça, and every district inside (Silivri, Şile, Çatalca, Adalar).
  // The match is case-insensitive but İ never folds to I, so dotted names are listed in both spellings.
  istanbul: [
    "Ankara",
    "İzmir",
    "Izmir",
    "Antalya",
    "Bursa",
    "Eskişehir",
    "Eskisehir",
    "Kocaeli",
    "İzmit",
    "Izmit",
    "Gebze",
    "Sapanca",
    "Yalova",
    "Tekirdağ",
    "Tekirdag",
    "Çorlu",
    "Corlu",
    "Çanakkale",
    "Canakkale",
    "Alaçatı",
    "Alacati",
    "Kuşadası",
    "Kusadasi",
    "Marmaris",
    "Fethiye",
    "Göcek",
    "Gocek",
    "Kapadokya",
    "Cappadocia",
    "Muğla",
    "Mugla",
    "Trabzon",
    "Adana",
    "Mersin",
    "Gaziantep",
    "Konya",
    "Diyarbakır",
    "Kıbrıs",
    "Cyprus",
    "Athens",
    "Atina",
    "Sofia",
    "Thessaloniki",
    "Selanik",
    "Tbilisi",
    "Baku",
    "Bakü",
  ],
  // Towns outside the Emirate of Dubai that listings name (D-1060): the other six emirates and their towns, and
  // the Gulf capitals weekend events come from. Left out: Hatta and Jebel Ali (inside), Beirut (Lebanese nights in
  // Dubai are titled after it), and Dubai's own districts named after places (Jumeirah, Al Barsha).
  dubai: [
    "Abu Dhabi",
    "Al Ain",
    "Sharjah",
    "Ajman",
    "Umm Al Quwain",
    "Ras Al Khaimah",
    "Fujairah",
    "Khor Fakkan",
    "Kalba",
    "Ruwais",
    "Muscat",
    "Doha",
    "Manama",
    "Bahrain",
    "Riyadh",
    "Jeddah",
    "Kuwait City",
  ],
  "san-juan": [
    "Dorado",
    "Toa Baja",
    "Levittown",
    "Toa Alta",
    "Trujillo Alto",
    "Canóvanas",
    "Piñones",
    "Río Grande",
    "Luquillo",
    "Fajardo",
    "Caguas",
    "Humacao",
    "Arecibo",
    "Mayagüez",
    "Aguadilla",
    "Isabela",
    "Cabo Rojo",
    "Vieques",
    "Culebra",
    "Vega Baja",
    "Manatí",
    "Cayey",
    "Naguabo",
    "Ceiba",
    "Gurabo",
  ],
  // Towns outside the Prefecture of Marrakech that listings name (D-1100): other Moroccan cities, the Atlas valleys
  // and resorts. Left out because addresses inside use them: "Ourika" (Route de l'Ourika), "Agafay" (part of the
  // desert is inside), "Amizmiz" (Route d'Amizmiz), "Tahannaout" (route de Tahannaout), "Fes" (Route de Fès).
  marrakesh: [
    "Casablanca",
    "Rabat",
    "Agadir",
    "Essaouira",
    "Taghazout",
    "Tangier",
    "Tanger",
    "Ouarzazate",
    "Imlil",
    "Oukaimeden",
    "Lalla Takerkoust",
    "Setti Fatma",
    "El Jadida",
    "Safi, Morocco",
    "Dakhla",
  ],
  // Towns outside the Beirut area that listings name (D-1000): the coast north and south, the
  // mountain resorts, and the nearby foreign cities. Left out because they are inside: every Beirut quarter and the
  // Metn/Baabda towns in the outline (Hamra, Achrafieh, Gemmayzeh, Mar Mikhael, Baabda, Hazmieh, Dbayeh, Antelias).
  // Tokyo (D-1221): Kanagawa, Saitama and Chiba towns and the other big Japanese cities. Bare Kawasaki and
  // 川崎 are left out (a surname, and DJ Kawasaki); only the city forms count.
  tokyo: [
    "Yokohama",
    "横浜",
    "Kawasaki City",
    "川崎市",
    "Saitama",
    "埼玉",
    "Omiya",
    "大宮",
    "Chiba",
    "千葉",
    "Urayasu",
    "浦安",
    "Maihama",
    "舞浜",
    "Shonan",
    "湘南",
    "Kamakura",
    "鎌倉",
    "Hakone",
    "箱根",
    "Karuizawa",
    "軽井沢",
    "Osaka",
    "大阪",
    "Kyoto",
    "京都",
    "Kobe",
    "神戸",
    "Nagoya",
    "名古屋",
    "Fukuoka",
    "福岡",
    "Sapporo",
    "札幌",
    "Sendai",
    "仙台",
    "Okinawa",
    "沖縄",
  ],
  beirut: [
    "Jounieh",
    "Kaslik",
    "Zouk Mosbeh",
    "Byblos",
    "Jbeil",
    "Batroun",
    "Tripoli",
    "Sidon",
    "Saida",
    "Tyre",
    "Sour, Lebanon",
    "Faraya",
    "Faqra",
    "Broummana",
    "Beit Meri",
    "Aley",
    "Bhamdoun",
    "Zahle",
    "Ehden",
    "Damour",
    "Chouf",
    "Cyprus",
    "Limassol",
    "Larnaca",
    "Amman",
    "Istanbul",
  ],
  // Towns outside the 10 municipalities that Medellín listings name (D-640). Left out on purpose because they are
  // also Medellín places or plain words: Belén, Santa Elena, San Antonio de Prado, San Cristóbal, Palmitas,
  // Altavista (comunas and corregimientos), Jardín (Jardín Botánico), Caldas (a municipality inside).
  medellin: [
    "Rionegro",
    "Llanogrande",
    "Guarne",
    "Marinilla",
    "La Ceja",
    "El Retiro",
    "Santa Fe de Antioquia",
    "San Jerónimo",
    "Guatapé",
    "El Peñol",
    "Jericó",
    "El Carmen de Viboral",
    "San Pedro de los Milagros",
    "Amagá",
    "Bogotá",
    "Cali",
    "Cartagena",
    "Barranquilla",
    "Pereira",
    "Manizales",
    "Bucaramanga",
    "Santa Marta",
    "Armenia",
  ],
  // Never "Brandenburg" alone (Brandenburger Tor) or "Frankfurt" alone (Frankfurter Allee). Matching is whole-word,
  // so "Potsdam" does not catch Potsdamer Platz/Straße and "Hamburg" does not catch Hamburger Bahnhof (D-1020).
  berlin: [
    "Potsdam",
    "Brandenburg an der Havel",
    "Oranienburg",
    "Bernau",
    "Falkensee",
    "Königs Wusterhausen",
    "Schönefeld",
    "Teltow",
    "Kleinmachnow",
    "Hennigsdorf",
    "Strausberg",
    "Erkner",
    "Ludwigsfelde",
    "Cottbus",
    "Leipzig",
    "Dresden",
    "Hamburg",
    "Munich",
    "München",
    "Cologne",
    "Köln",
    "Frankfurt am Main",
    "Rostock",
    "Prague",
    "Warsaw",
    "Vienna",
    "Copenhagen",
    "Amsterdam",
    "Paris",
    "London",
  ],
  // Towns outside the Metropole du Grand Paris that titles name (D-1040). Names that are also Paris streets,
  // stations or gardens count only after a comma (METRO_OUTSIDE_TOWNS_AFTER_COMMA).
  paris: [
    "Saint-Germain-en-Laye",
    "Cergy",
    "Évry",
    "Evry",
    "Marne-la-Vallée",
    "Marne la Vallee",
    "Chessy",
    "Disneyland",
    "Massy",
    "Roissy",
    "Melun",
    "Mantes-la-Jolie",
    "Toulouse",
    "Montpellier",
    "Grenoble",
    "Bordeaux",
    "Lausanne",
    "Genève",
    "Geneva",
    "Brussels",
    "Berlin",
    "Barcelona",
    "Barcelone",
  ],
  // Towns outside the Tulum and Solidaridad municipios that listings name (D-1080): the rest of Quintana Roo's
  // coast and islands, and the Yucatan towns day trips and tours come from. Left out: Akumal, Cobá, Puerto Aventuras,
  // Xcaret, Chemuyil and Xpu-Ha (inside), "Riviera Maya" (names the area itself) and "Maya" alone.
  tulum: [
    "Cancún",
    "Cancun",
    "Puerto Morelos",
    "Cozumel",
    "Isla Mujeres",
    "Holbox",
    "Bacalar",
    "Chetumal",
    "Mahahual",
    "Felipe Carrillo Puerto",
    "Valladolid",
    "Mérida",
    "Merida",
  ],
};

/**
 * Other city names that, when they appear at the start of a title followed by a separator (`:`, `|`, or ` - `),
 * indicate the listing is for that other city, not for this metro. This prefix-only rule avoids false positives
 * from street names (e.g., Mexico City's Roma/Juárez streets are named after cities). See D-296.
 */
export const METRO_OTHER_CITY_PREFIXES: Readonly<Record<string, readonly string[]>> = (() => {
  const US_CITY_PREFIXES = [
    "New York",
    "NYC",
    "Brooklyn",
    "Philadelphia",
    "Philly",
    "Miami",
    "New Orleans",
    "NOLA",
    "Chicago",
    "Los Angeles",
    "Atlanta",
    "Boston",
    "Washington DC",
    "Houston",
    "Dallas",
    "Austin",
    "Orlando",
    "Tampa",
    "San Francisco",
    "Seattle",
    "Denver",
    "Nashville",
    "Baltimore",
  ];
  const filterOwn = (ownNames: string[]) =>
    US_CITY_PREFIXES.filter((city) => !ownNames.includes(city));
  return {
    "hong-kong": [
      "Singapore",
      "Taipei",
      "Bangkok",
      "Shanghai",
      "Beijing",
      "Tokyo",
      "Seoul",
      "Manila",
      "Kuala Lumpur",
    ],
    "mexico-city": [
      "Guadalajara",
      "Monterrey",
      "Puebla",
      "Querétaro",
      "Queretaro",
      "Tijuana",
      "Cancún",
      "Cancun",
      "Mérida",
      "Merida",
      "Oaxaca",
      "León",
      "Leon",
      "Toluca",
      "Playa del Carmen",
      "Tulum",
      "San Miguel de Allende",
      "Aguascalientes",
      "Morelia",
      "Acapulco",
      "Veracruz",
      "Puerto Vallarta",
      "San Luis Potosí",
      "San Luis Potosi",
    ],
    barcelona: [
      "Madrid",
      "Valencia",
      "Sevilla",
      "Seville",
      "Bilbao",
      "Málaga",
      "Malaga",
      "Zaragoza",
      "Palma",
      "Ibiza",
      "Granada",
      "Alicante",
    ],
    lisbon: ["Porto", "Braga", "Coimbra", "Faro", "Aveiro", "Funchal", "Madrid"],
    "rio-de-janeiro": [
      "São Paulo",
      "Sao Paulo",
      "Belo Horizonte",
      "Salvador",
      "Curitiba",
      "Brasília",
      "Brasilia",
      "Porto Alegre",
      "Florianópolis",
      "Florianopolis",
      "Recife",
      "Fortaleza",
    ],
    "buenos-aires": [
      "Córdoba",
      "Cordoba",
      "Rosario",
      "Mendoza",
      "Mar del Plata",
      "Montevideo",
      "Santiago",
    ],
    london: [
      "Manchester",
      "Birmingham",
      "Bristol",
      "Leeds",
      "Liverpool",
      "Glasgow",
      "Edinburgh",
      "Brighton",
      "Paris",
      "Berlin",
      "Amsterdam",
      "Dublin",
    ],
    istanbul: ["Ankara", "İzmir", "Izmir", "Antalya", "Bodrum", "Bursa", "Athens", "Berlin"],
    dubai: ["Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Doha", "Riyadh", "Muscat"],
    beirut: ["Paris", "Istanbul", "Amman", "Cyprus", "Limassol", "Jounieh", "Byblos"],
    tulum: ["Cancún", "Cancun", "Mérida", "Merida", "CDMX", "Mexico City", "Cozumel", "Holbox"],
    tokyo: ["Osaka", "Kyoto", "Seoul", "Taipei", "Shanghai", "Singapore", "Bangkok"],
    marrakesh: ["Casablanca", "Rabat", "Agadir", "Essaouira", "Tangier", "Tanger", "Paris"],
    "san-juan": [
      "Ponce",
      "Mayagüez",
      "Mayaguez",
      "Aguadilla",
      "Arecibo",
      "Miami",
      "New York",
      "Orlando",
    ],
    nyc: filterOwn(["New York", "NYC", "Brooklyn"]),
    philadelphia: filterOwn(["Philadelphia", "Philly"]),
    miami: filterOwn(["Miami"]),
    "new-orleans": filterOwn(["New Orleans", "NOLA"]),
  };
})();

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const outsideTownPatterns = new Map<string, ReadonlyArray<{ town: string; pattern: RegExp }>>();
const outsideTownAfterCommaPatterns = new Map<
  string,
  ReadonlyArray<{ town: string; pattern: RegExp }>
>();

/** The compiled whole-word patterns of a metro's outside towns, built once from the list. */
function outsideTownPatternsFor(
  metroSlug: string,
): ReadonlyArray<{ town: string; pattern: RegExp }> {
  const cached = outsideTownPatterns.get(metroSlug);
  if (cached) return cached;
  const towns = Object.prototype.hasOwnProperty.call(METRO_OUTSIDE_TOWNS, metroSlug)
    ? (METRO_OUTSIDE_TOWNS[metroSlug] ?? [])
    : [];
  const built = towns.map((town) => {
    const words = town.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
    return {
      town,
      pattern: new RegExp(`(?<![A-Za-z0-9])${words}(?![A-Za-z0-9])`, "i"),
    };
  });
  outsideTownPatterns.set(metroSlug, built);
  return built;
}

/** The compiled patterns of a metro's outside towns that count only after a comma. */
function outsideTownAfterCommaPatternsFor(
  metroSlug: string,
): ReadonlyArray<{ town: string; pattern: RegExp }> {
  const cached = outsideTownAfterCommaPatterns.get(metroSlug);
  if (cached) return cached;
  const towns = Object.prototype.hasOwnProperty.call(METRO_OUTSIDE_TOWNS_AFTER_COMMA, metroSlug)
    ? (METRO_OUTSIDE_TOWNS_AFTER_COMMA[metroSlug] ?? [])
    : [];
  const built = towns.map((town) => {
    const words = town.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
    // Pattern: comma, optional whitespace, the town, followed by lookahead for end or separator
    return {
      town,
      pattern: new RegExp(`,\\s*${words}(?=\\s*(?:$|[|,(\\-–—]))`, "i"),
    };
  });
  outsideTownAfterCommaPatterns.set(metroSlug, built);
  return built;
}

const otherCityPrefixPatterns = new Map<string, ReadonlyArray<{ city: string; pattern: RegExp }>>();

function otherCityPrefixPatternsFor(
  metroSlug: string,
): ReadonlyArray<{ city: string; pattern: RegExp }> {
  const cached = otherCityPrefixPatterns.get(metroSlug);
  if (cached) return cached;
  const cities = Object.prototype.hasOwnProperty.call(METRO_OTHER_CITY_PREFIXES, metroSlug)
    ? (METRO_OTHER_CITY_PREFIXES[metroSlug] ?? [])
    : [];
  // Sort by length descending to match longer names first
  const sorted = [...cities].sort((a, b) => b.length - a.length);
  const built = sorted.map((city) => {
    const words = city.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
    // Pattern matches at start of string (after optional whitespace) followed by optional whitespace
    // and then one of the separators: `:`, `|`, or a dash with spaces around it.
    // The separator is not captured; we just need to know it's there.
    return {
      city,
      pattern: new RegExp(`^\\s*${words}\\s*(?:[:|]|\\s+[-–—]\\s+)`, "i"),
    };
  });
  otherCityPrefixPatterns.set(metroSlug, built);
  return built;
}

/**
 * Returns the other city name when the title starts with that city followed by a separator
 * (`:`, `|`, or ` - `). Otherwise returns null.
 */
export function titlePrefixNamesOtherCity(metroSlug: string, title: string): string | null {
  if (!title.trim()) return null;
  for (const { city, pattern } of otherCityPrefixPatternsFor(metroSlug)) {
    if (pattern.test(title)) return city;
  }
  return null;
}

// A metro's own names in a script written without spaces, blanked before outside towns are matched (D-782):
// "東京都" (Tokyo Metropolis) holds "京都" (Kyoto), so every Tokyo address read as Kyoto (Tokyo read
// 42420733466 took 7 Meetup rows in Roppongi, Ebisu and Higashiyama off the site).
const METRO_OWN_NAMES_UNSPACED: Readonly<Record<string, readonly string[]>> = {
  tokyo: ["東京"],
};

function withoutOwnNames(metroSlug: string, text: string): string {
  const names = Object.prototype.hasOwnProperty.call(METRO_OWN_NAMES_UNSPACED, metroSlug)
    ? (METRO_OWN_NAMES_UNSPACED[metroSlug] ?? [])
    : [];
  return names.reduce((out, name) => out.split(name).join(" "), text);
}

/**
 * The outside town `title` names for this metro, as listed in METRO_OUTSIDE_TOWNS, or null.
 * Also returns a city when the title starts with that city followed by a separator (`:`, `|`, or ` - `),
 * as per METRO_OTHER_CITY_PREFIXES.
 * Towns that are also city streets (e.g., "La Plata" in Buenos Aires) count only when they appear
 * right after a comma, as listed in METRO_OUTSIDE_TOWNS_AFTER_COMMA.
 */
export function titleNamesOutsideTown(metroSlug: string, rawTitle: string): string | null {
  if (!rawTitle.trim()) return null;
  const title = withoutOwnNames(metroSlug, rawTitle);
  for (const { town, pattern } of outsideTownPatternsFor(metroSlug)) {
    if (pattern.test(title)) return town;
  }
  for (const { town, pattern } of outsideTownAfterCommaPatternsFor(metroSlug)) {
    if (pattern.test(title)) return town;
  }
  return titlePrefixNamesOtherCity(metroSlug, title);
}
