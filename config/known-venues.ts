// Venues the seeded map data does not hold (bars, event halls), named by directory pages with no
// street address. A listing that names one and gives no address is placed at the address here.
// Every address is checked by hand, with its ZIP, and the check's source is in the comment.

export interface KnownVenue {
  /** The names directory pages use for it, as written ("The Last Word", "Last Word"). */
  names: readonly string[];
  /** Street address with ZIP (US) or postcode (UK). */
  address: string;
  /**
   * Neighbourhoods a source may write instead of a street ("Kween, Astoria"): a town-only address
   * naming one of them takes the checked address (menna writes only the neighbourhood, 2026-10-25).
   */
  areas?: readonly string[];
  /**
   * Street names a source may write instead of the venue's name ("Between 51 & 53 Croftdown Road"):
   * a listing with no known name whose venue name or address names one of them is placed here.
   */
  streets?: readonly string[];
  /**
   * A hand-checked point for the venue (OSM or the venue's own map), for addresses the geocoder
   * answers too vaguely (parks "s/n", many Mexico City streets). The entry's comment names the check.
   * When the entry is applied, the listing takes this point instead of the source's (D-260).
   */
  point?: { lat: number; lng: number };
  /**
   * The venue has closed: the evidence, with its date ("closed per its Instagram, 2026-10-29").
   * A listing placed at it (its address is this entry's address) is screened as "venue closed" (D-263).
   */
  closed?: string;
  /**
   * Every name is the same venue, and listings matched to this entry are stored under its first name, so
   * they land on one venue record and the same night merges (D-265). Without it the name is kept as written.
   */
  canonical?: boolean;
}

export const KNOWN_VENUES: Readonly<Record<string, readonly KnownVenue[]>> = {
  nyc: [
    // House of Yes, 2 Wyckoff Ave, Bushwick: its own calendar row sat in Williamsburg, RA's "The Onyx Room at House of
    // Yes" in Bushwick, so one night showed twice (weekly review 2026-11-23, D-889). Point: OSM events_venue "House of
    // Yes, 2, Wyckoff Avenue, Bushwick, 11237" (Nominatim, 2026-11-23).
    {
      names: [
        "House of Yes",
        "The Onyx Room at House of Yes",
        "Onyx Room at House of Yes",
        "House of Yes NYC",
      ],
      address: "2 Wyckoff Ave, Brooklyn, NY 11237",
      point: { lat: 40.7067833, lng: -73.9235822 },
      canonical: true,
    },
    // Astoria cocktail bar; Time Out NYC, NYC Tourism (2026-10-22).
    {
      names: ["The Last Word"],
      address: "31-30 Ditmars Blvd, Astoria, NY 11105",
    },
    // Financial District club beneath the Beekman; Xceed, Downtown Alliance (2026-10-22).
    {
      names: ["Laissez Faire", "Laissez-Faire"],
      address: "10 Theatre Alley, New York, NY 10038",
    },
    // Union Square food hall, salsa on Fridays; Time Out (2026-10-22).
    {
      names: ["Time Out Market Union Square", "Time Out Market New York Union Square"],
      address: "124 E 14th St, New York, NY 10003",
    },
    // 92NY (92nd Street Y), Upper East Side: Wednesday Israeli folk dance open session (8:15 pm, Mack Gym), listed on
    // 92ny.org through Jan 2027 (opened in Chrome 2026-11-06; recheck in January). 92ny.org blocks our bot
    // (Incapsula), so there is no daily read: address only (blocked-platform audit, D-758).
    {
      names: ["92NY", "92nd Street Y", "92Y", "92nd Street Y, New York"],
      address: "1395 Lexington Ave, New York, NY 10128",
    },
    // Navy Yard event hall, Building 293; TagVenue, Hire Space (2026-10-22). 63 Flushing Ave is the Yard's address.
    {
      names: ["Brooklyn Storehouse"],
      address: "63 Flushing Ave, Building 293, Brooklyn, NY 11205",
    },
    // Long Island City speakeasy under the former Z Hotel; Social Life Magazine (2026-10-22).
    // DICE also writes "The Newsroom, New York City"; its event page gives 11-01 43rd Avenue (2026-10-22).
    {
      names: ["Newsroom Speakeasy", "The Newsroom"],
      address: "11-01 43rd Ave, Long Island City, NY 11101",
    },
    // Westbury, Long Island restaurant hosting Argentine TangoLovers milongas;
    // longisland.com, Tagvenue (2026-10-22).
    {
      names: ["Mirelle's", "Mirelles", "Mirelle's Restaurant"],
      address: "170 Post Ave, Westbury, NY 11590",
    },
    // Nutley, NJ ballroom and tango studio; Giftly (2026-10-22).
    {
      names: ["Starlight Dance Center"],
      address: "7 High St, Nutley, NJ 07110",
    },
    // Williamsburg waterfront park (DICE "Domino park"); AAA, NYC Tourism, Time Out (2026-10-22).
    {
      names: ["Domino Park"],
      address: "15 River St, Brooklyn, NY 11249",
    },
    // Ridgewood bar that swing listings call "Brooklyn"; Atly, Untapped Cities (2026-10-22).
    {
      names: ["The Keep"],
      address: "205 Cypress Ave, Ridgewood, NY 11385",
    },
    // Williamsburg bathhouse, Daybreaker's Sauna Rave; LoopNet, NY YIMBY (2026-10-22).
    {
      names: ["Othership Williamsburg", "Othership"],
      address: "25 Kent Ave, Brooklyn, NY 11249",
    },
    // Roosevelt Island chapel, Nuevo Tango Arts' "La Capilla del Tango"; nuevotangoarts.org, RIOC (2026-10-22).
    {
      names: [
        "Chapel of the Good Shepherd",
        "Historic Chapel of the Good Shepherd",
        "La Capilla del Tango",
      ],
      address: "543 Main St, New York, NY 10044",
    },
    // East Village music venue; menna's own event page writes this address (2026-10-25).
    {
      names: ["DROM"],
      address: "85 Avenue A, New York, NY 10009",
      areas: ["East Village"],
    },
    // Astoria queer cocktail lounge; atly, QNS, Queens Post (2026-10-25).
    {
      names: ["Kween"],
      address: "34-10 30th Ave, Astoria, NY 11103",
      areas: ["Astoria"],
    },
    // Bed-Stuy Middle Eastern restaurant and bar; The Infatuation, FSR, Brooklyn Paper (2026-10-25).
    {
      names: ["Laziza"],
      address: "306A Malcolm X Blvd, Brooklyn, NY 11233",
      areas: ["Bed-Stuy", "Bedford-Stuyvesant"],
    },
    // East Williamsburg nightclub (D-869): tickeri writes ZIP 10038 (Manhattan; geocoded to Chinatown), RA writes
    // "Viva Toro - 987 Grand Street". Point: Nominatim, 987 Grand Street, Brooklyn 11211 (2026-11-11).
    {
      names: ["Viva Toro", "Viva Toro Nightclub"],
      address: "987 Grand St, Brooklyn, NY 11211",
      streets: ["987 Grand Street", "987 Grand St"],
      point: { lat: 40.7133622, lng: -73.9353778 },
      canonical: true,
    },
  ],
  london: [
    // Alexandra Palace, Alexandra Palace Way N22 7AY: DICE's row was geocoded to Mortlake beside Ticketmaster's
    // "Alexandra Palace Theatre", so Gorgon City showed three times on 11-28 (weekly review 2026-11-23, D-889). Point:
    // OSM exhibition_centre "Alexandra Palace, Alexandra Palace Way, Hornsey, N22 7AY" (Nominatim, 2026-11-23).
    {
      names: [
        "Alexandra Palace",
        "Alexandra Palace Theatre",
        "Alexandra Palace Great Hall",
        "Ally Pally",
      ],
      address: "Alexandra Palace Way, London N22 7AY",
      point: { lat: 51.5943495, lng: -0.1306402 },
      canonical: true,
    },
    // UNDR, under the Westway at Portobello Green: ruedalibre writes "UNDR House Of Flavaz" (Casa Tumbao), which was
    // geocoded to East London (51.555, 0.016); social-dance.today writes "Undrw10", 3 Thorpe Close (daily check 11-05,
    // D-750). Thorpe Close is W10 5XL (freeofficefinder, zestate); point: OSM postcode W10 5XL (Nominatim, 2026-11-05).
    {
      names: ["UNDR", "UNDR W10", "Undrw10", "UNDR House Of Flavaz", "House Of Flavaz"],
      address: "3 Thorpe Close, London W10 5XL",
      streets: ["Thorpe Close"],
      point: { lat: 51.5182896, lng: -0.2084052 },
      canonical: true,
    },
    // Downstairs at The Dome, the Boston Music Room's building at 178 Junction Road, Tufnell Park: Funky Mambo's Tuesday
    // salsa. londonsalsaevents writes "Downstairs at The Dome", funkymambo.com and social-dance.today "Funky Mambo",
    // social-dance.today also "Dirty Water Club London, 1996-2009" (the old club in the building) and "Junction Road"
    // (geocoded 900 m off, daily check 11-05, D-753). Point: OSM node 10681094108 "Boston Music Room, 178 Junction
    // Road, N19 5QQ" (Nominatim, 2026-11-05).
    // social-dance.today writes the full "Dirty Water Club London, 1996-2009" (daily check 11-06).
    {
      names: [
        "Downstairs at The Dome",
        "The Dome",
        "The Dome Tufnell Park",
        "Boston Music Room",
        "Funky Mambo",
        "Dirty Water Club London",
        "Dirty Water Club London, 1996-2009",
        "Junction Road",
      ],
      address: "178 Junction Road, London N19 5QQ",
      point: { lat: 51.5573334, lng: -0.1383779 },
      canonical: true,
    },
    // Leaf & Cane, the Latin bar in the vaults of Hyatt Regency London Blackfriars, 19 New Bridge Street: Funky
    // Mambo's monthly Friday salsa. Eventbrite writes "Hyatt Regency Leaf & Cane", funkymambo.com "Leaf and cane"
    // (daily check 11-06). Address: hyattrestaurants.com and tagvenue (2026-11-06).
    // "Nineteen Below" (same address, listing titled "Leaf and Cane – Funky Mambo", daily check 11-07): no such bar exists (web search 2026-11-08).
    {
      names: [
        "Leaf & Cane",
        "Hyatt Regency Leaf & Cane",
        "Leaf and Cane",
        "The Leaf & Cane",
        "The Leaf and Cane",
        "Nineteen Below",
      ],
      address: "19 New Bridge Street, London EC4V 6DB",
      canonical: true,
    },
    // St Aldhelm's Church, Edmonton: Salsynergy Sundays. ruedalibre writes "St. Aldhelms Church, 2 Windmill Road,
    // London" (no postcode), which was geocoded to Windmill Road, Chiswick, 21 km off; social-dance.today and salsavida
    // write "The London Dance Factory, Gladys Aylward School, 1 Windmill Rd ... N18 1NB" (next door). Two cards every
    // Sunday (daily check 11-12, D-879). Address: salsavida's Salsynergy page "2 Windmill Rd, London N18 1PA";
    // point: OSM postcode N18 1PA (Nominatim, 2026-11-12).
    {
      names: [
        "St Aldhelm's Church",
        "St. Aldhelms Church",
        "St Aldhelms Church",
        "St. Aldhelm's Church",
        "St. Aldehelm's Church",
        "The London Dance Factory",
        "London Dance Factory",
      ],
      address: "2 Windmill Road, London N18 1PA",
      streets: ["Gladys Aylward School"],
      point: { lat: 51.61809, lng: -0.08041 },
      canonical: true,
    },
    // Ecstatic Dance London's Dartmouth Park space; its feed writes "Between 51 & 53 Croftdown
    // Road ... NW5 1EL" among directions (the organiser emails the door). OSM: 53 Croftdown Road is
    // NW5 1HE; the organiser's NW5 1EL is the same street, ~100 m on (postcodes.io, 2026-10-28).
    // The house number is kept: the geocoder places only an address with one (D-071).
    {
      names: ["Ecstatic Dance London, Croftdown Road"],
      address: "53 Croftdown Road, London NW5 1HE",
      streets: ["Croftdown Road"],
    },
    // Tango halls that London Milongas and Tango Amistoso name with only an area and a postcode
    // ("Westminster Boating Base, Pimlico SW1V 3JY"), which the geocoder cannot place: 30 nights were
    // unplaced on run 40943543133 (D-217). Each address checked 2026-10-29: Tango Amistoso's own page
    // (Herbal Hill, Claremont Project), Westminster Boating Base's RYA and Companies House entries,
    // St Paul's A Church Near You page, New Unity's own "find us", New Cross House's CAMRA entry, and
    // the venues' own sites for the Tabernacle, the Dutch Church, Haverstock School and Cecil Sharp House.
    {
      names: [
        "City Academy Studio",
        "City Academy",
        "10 Herbal Hill, Farringdon",
        "10 Herbal Hill",
        "Herbal Hill",
      ],
      address: "10 Herbal Hill, London EC1R 5EG",
    },
    {
      names: [
        "Claremont Project",
        "Claremont Project, Lower Hall",
        "Angel/Islington Lower Hall",
        "Angel/Islington Upper Hall",
        "Angel/Islington",
      ],
      address: "24-27 White Lion Street, London N1 9PD",
      // London Milongas writes "24-27 White Lion Street, Angel N1 9PD", which the geocoder refused (D-481).
      streets: ["24-27 White Lion Street"],
      point: { lat: 51.532628, lng: -0.107761 },
      // Tango Amistoso lists one Sunday class at "Angel/Islington Upper Hall, Claremont Project" and
      // again at "Angel/Islington Lower Hall": one venue record, so its two copies merge (D-747).
      canonical: true,
    },
    {
      names: ["Westminster Boating Base"],
      address: "136 Grosvenor Road, London SW1V 3JY",
    },
    {
      names: [
        "St. Paul's Church, Marylebone",
        "St Paul's Church, Marylebone",
        "St Paul's Marylebone",
      ],
      address: "5 Rossmore Road, London NW1 6NJ",
    },
    {
      names: ["The Tabernacle"],
      address: "34-35 Powis Square, London W11 2AY",
    },
    {
      names: ["Dutch Hall", "Dutch Church"],
      address: "7 Austin Friars, London EC2N 2HA",
    },
    {
      names: ["Haverstock School"],
      address: "24 Haverstock Hill, London NW3 2BQ",
    },
    {
      names: [
        "New Unity Hall",
        "New Unity",
        "New Unity Angel/Islington New Hall",
        "Angel/Islington New Hall",
        "Unity Hall",
      ],
      address: "277A Upper Street, London N1 2TZ",
      areas: ["Islington"],
    },
    {
      names: ["New Cross House"],
      address: "316 New Cross Road, London SE14 6AF",
    },
    {
      names: ["Cecil Sharp House"],
      address: "2 Regent's Park Road, London NW1 7AY",
    },
    // D-218, each checked 2026-10-30 (postcodes.io confirms every postcode). St John's Community
    // Centre (London Milongas' "Crossharbour E14 3NE"): Tower Hamlets' halls-for-hire page and OSM.
    // St Philip's (London Milongas' "Earl's Court W8 6QH"): its A Church Near You page writes no house
    // number, so the point is OSM way 88117500. RAES (DILF's "6 O'MEARA STREET, LONDON BRIDGE., SE1
    // 1TE"): DILF's Ticket Tailor page and Time Out.
    {
      names: ["St John's Community Centre", "St Johns Community Centre"],
      address: "37-43 Glengall Grove, London E14 3NE",
    },
    {
      names: [
        "St Philip's Church",
        "St Phillip's Church",
        "St Philip's",
        "St Philip's, Earl's Court",
      ],
      address: "Earl's Court Road, London W8 6QH",
      point: { lat: 51.4958458, lng: -0.1961269 },
    },
    {
      names: ["RAES", "RAES (Previously O'MEARA)", "O'Meara", "Omeara"],
      address: "6 O'Meara Street, London SE1 1TE",
      areas: ["London Bridge"],
    },
    // London Milongas' "Wickham Hall, West Wickham BR4 0JX" (D-219): Sussex Road, no house number, so the
    // point is OSM node 13149646437 (postcodes.io: Bromley, 2026-10-30).
    {
      names: ["Wickham Hall"],
      address: "Sussex Road, West Wickham BR4 0JX",
      areas: ["West Wickham"],
      point: { lat: 51.377403, lng: -0.0195301 },
    },
    // Newham's tea dances (D-492): the model names "Old Town Hall Stratford", not the seed's label,
    // so the seed's address was not used and the geocoder left it unplaced on read 41066784589.
    // Point: postcodes.io E15 4BQ, 2026-10-30.
    {
      names: ["Old Town Hall Stratford", "Old Town Hall", "Stratford Old Town Hall"],
      address: "29 The Broadway, London E15 4BQ",
      areas: ["Stratford"],
      point: { lat: 51.540946, lng: 0.002718 },
    },
    // Read 41044155102 (D-298): halls the geocoder could not place, points from postcodes.io 2026-10-30.
    // Forró Family's "Exmouth Market Church Hall, EC1R 4QE" (no house number).
    {
      names: ["Exmouth Market Church Hall"],
      address: "Exmouth Market, London EC1R 4QE",
      areas: ["Clerkenwell"],
      point: { lat: 51.525848, lng: -0.108893 },
    },
    // Ritmo Latino's own studio, "next to Metropolis Vauxhall".
    {
      names: [
        "Ritmo Latino - Dance Studio and Event Space",
        "Ritmo Latino - Dance Studio and Event Space (Next to Metropolis Vauxhall)",
        "Ritmo Latino - Dance Studio and Events Venue",
        "Ritmo Latino Dance Studio",
      ],
      address: "72 Albert Embankment, London SE1 7TP",
      areas: ["Vauxhall"],
      point: { lat: 51.487956, lng: -0.123714 },
    },
    // Rueda Libre's TIMBA Y CASINO nights: "St. Thomas Street, London, SE1 9RT" is Guy's Bar.
    {
      names: ["Guy's Bar", "St. Thomas Street, London, SE1 9RT"],
      address: "St Thomas Street, London SE1 9RT",
      areas: ["London Bridge", "St. Thomas Street"],
      streets: ["St. Thomas Street, London, United Kingdom"],
      point: { lat: 51.503331, lng: -0.086771 },
    },
    // Swing Out London's socials, which it names with only an area ("Jamboree in King's Cross"), so
    // each lists its area. Checked 2026-10-30: Jamboree's and the Bedford's own sources here; the
    // Ritzy and St Mary's Islington write no house number, so their points are OSM node 245955704 and
    // way 4969133; Craft Metropolis per Verdant's page; the Phoenix, George & Devonshire, Dog and Fox
    // and Genesis per OSM; the Hammersmith Club per its salsa club's and A-Train's listings; the
    // Castle per CAMRA; the South London Irish Association per pubwiki; Jazzbourne per CAMRA; the
    // cornerHOUSE per its own site; the Bishopsgate Institute per OSM.
    {
      names: ["Jamboree"],
      address: "6 St Chad's Place, London WC1X 9HH",
      areas: ["King's Cross", "Kings Cross"],
    },
    {
      names: ["The Ritzy Cinema", "The Ritzy Cinema (upstairs)", "The Ritzy", "Ritzy Picturehouse"],
      address: "Brixton Oval, Coldharbour Lane, London SW2 1JG",
      areas: ["Brixton"],
      point: { lat: 51.46115, lng: -0.114961 },
    },
    {
      names: ["St Mary's Islington", "St Mary's Church, Islington", "St Mary's Church Islington"],
      address: "Upper Street, London N1 2TX",
      areas: ["Highbury and Islington", "Islington"],
      point: { lat: 51.538406, lng: -0.101719 },
    },
    {
      names: ["Craft Metropolis"],
      address: "Arch 263, 241 Coldharbour Lane, London SW9 8RR",
      areas: ["Brixton", "Loughborough Junction"],
    },
    {
      names: ["The Phoenix", "The Phoenix, Cavendish Square"],
      address: "37 Cavendish Square, London W1G 0PP",
      areas: ["Oxford Circus", "Marylebone"],
    },
    {
      names: ["The Hammersmith Club", "Hammersmith Club"],
      address: "11 Rutland Grove, London W6 9DH",
      areas: ["Hammersmith"],
    },
    {
      names: ["The George & Devonshire", "George & Devonshire", "The George and Devonshire"],
      address: "8 Burlington Lane, London W4 2QE",
      areas: ["Chiswick"],
    },
    {
      names: ["The Bedford"],
      address: "77 Bedford Hill, London SW12 9HD",
      areas: ["Balham"],
    },
    {
      names: ["The Castle", "The Castle, Aldgate"],
      address: "44 Commercial Road, London E1 1LN",
      areas: ["Aldgate", "Aldgate East", "Whitechapel"],
    },
    {
      names: ["South London Irish Club", "South London Irish Association"],
      address: "140 Hartfield Road, London SW19 3TG",
      areas: ["Wimbledon"],
    },
    {
      names: ["Dog and Fox", "The Dog and Fox", "Dog & Fox"],
      address: "24 High Street, London SW19 5EA",
      areas: ["Wimbledon", "Wimbledon Village"],
    },
    {
      names: ["Jazzbourne", "The Jazzbourne"],
      address: "443 New Cross Road, London SE14 6TA",
      areas: ["New Cross"],
    },
    {
      names: ["The Corner House", "The cornerHOUSE", "cornerHOUSE Arts Centre"],
      address: "116 Douglas Road, Surbiton KT6 7SB",
      areas: ["Surbiton"],
    },
    {
      names: ["Genesis Cinema"],
      address: "93-95 Mile End Road, London E1 4UJ",
      areas: ["Whitechapel", "Stepney Green"],
    },
    {
      names: ["The Bishopsgate Institute", "Bishopsgate Institute"],
      address: "230 Bishopsgate, London EC2M 4QH",
      areas: ["Spitalfields", "Liverpool Street"],
    },
    // Read 41085025249's unplaced rows (D-481). DICE venues: the address each one's DICE listing
    // writes (2026-10-30), the geocoder refused it; points are the postcode's centre (postcodes.io;
    // W1G 0BB is a terminated postcode, its last centre).
    {
      names: ["Egg LDN", "Egg London", "EGG London"],
      address: "5-13 Vale Royal, London N7 9AP",
      point: { lat: 51.54202, lng: -0.123697 },
    },
    {
      names: ["Outernet Live", "Outernet London", "Outernet"],
      address: "Denmark Street, London WC2H 8LH",
      point: { lat: 51.515741, lng: -0.129159 },
    },
    {
      names: ["Venue MOT", "Venue MOT Unit 18"],
      address: "Unit 18, Orion Business Centre, Surrey Canal Road, London SE14 5RT",
      point: { lat: 51.484993, lng: -0.048535 },
    },
    {
      names: ["77 London"],
      address: "77 Welbeck Street, London W1G 0BB",
      point: { lat: 51.515675, lng: -0.148806 },
    },
    {
      names: ["Boxhall City (London)", "Boxhall City"],
      address: "1-27 The Arcade, Liverpool Street, London EC2M 7PN",
      point: { lat: 51.517183, lng: -0.08201 },
    },
    {
      names: ["Hackney Bridge"],
      address: "Units 1-28, Echo Building, London E15 2SJ",
      point: { lat: 51.544647, lng: -0.021406 },
    },
    {
      names: ["Crate Brewery", "Crate"],
      address: "Unit 7, Queens Yard, London E9 5EN",
      point: { lat: 51.542958, lng: -0.023109 },
    },
    {
      // RA writes "Club Silly (Bosi)" at "Bureau Of Silly ideas, Arch 555, Valentia Place, London, SW9 8PJ"
      // (read 41327983492): another postcode on the same street.
      names: ["Club Silly", "Club Silly (Bosi)", "Bureau Of Silly Ideas"],
      address: "18 Valentia Place, London SW9 8EP",
      streets: ["Valentia Place"],
      point: { lat: 51.462959, lng: -0.109853 },
    },
    // Shoobs' LA Lounge nights: "@ LA LOUNGE (Hacienda) Bell Lane, Dock Road, London, E16 2AB".
    {
      names: ["LA Lounge", "LA Lounge (Hacienda)"],
      address: "Bell Lane, Dock Road, London E16 2AB",
      streets: ["Bell Lane, Dock Road"],
      point: { lat: 51.502126, lng: 0.017816 },
    },
    // Rincón Latino's Sunday social: its Rueda Libre event page names "G4P Padel Yard, 2 Armoury
    // Way, Wandsworth, SW18 1HQ" (its venue field writes SW18 1SH).
    {
      names: ["G4P Padel Yard"],
      address: "2 Armoury Way, London SW18 1HQ",
      streets: ["2 Armoury Way"],
      point: { lat: 51.458262, lng: -0.195869 },
    },
    // London Milongas' Negracha Kingston milonga: "Kingston Work Men's Club, 25 Old London Road".
    {
      names: ["Kingston Work Men's Club", "Kingston Workmen's Club"],
      address: "25 Old London Road, Kingston upon Thames KT2 6ND",
      streets: ["25 Old London Road"],
      point: { lat: 51.410982, lng: -0.298995 },
    },
    // Tango Amistoso's Monday classes: "Shepherd's Bush, 41 Uxbridge road, Shepherd's Bush W12 8LH".
    {
      names: ["Tango Amistoso Shepherd's Bush"],
      address: "41 Uxbridge Road, London W12 8LH",
      streets: ["41 Uxbridge Road"],
      point: { lat: 51.50557, lng: -0.227576 },
    },
    // Swing Patrol's class pages, each naming its hall under "Where" (2026-10-30).
    {
      names: ["Where Living Space"],
      address: "1 Coral Street, London SE1 7BE",
      point: { lat: 51.500891, lng: -0.108803 },
    },
    {
      names: ["St Anne and All Saints Church", "St Anne and All Saints C of E Church"],
      address: "Miles Street, London SW8 1RL",
      point: { lat: 51.48289, lng: -0.124037 },
    },
    {
      names: ["Exmouth Market Centre"],
      address: "Exmouth Market, London EC1R 4QE",
      point: { lat: 51.525848, lng: -0.108893 },
    },
    {
      names: ["The Langham Club", "Langham Club"],
      address: "600 Green Lanes, London N8 0RY",
      point: { lat: 51.584707, lng: -0.099623 },
    },
    // WCSUK's Farnham class (Waverley Borough Council's page): outside London, so its point
    // takes the row off the London site instead of leaving it unplaced.
    {
      names: ["Farnham Memorial Hall"],
      address: "Babbs Mead, West Street, Farnham GU9 7EE",
      point: { lat: 51.21107, lng: -0.806992 },
    },
    // Ceroc's and Salsateca's weekly halls and SwingdanceUK's City Sport (D-482). Each address is the
    // one the organiser's own page writes (2026-10-30); Ceroc's points are its own venue map's,
    // the others their postcode's centre (postcodes.io). Each source's venueAddress is this address.
    {
      names: ["Pimlico Academy"],
      address: "Pimlico Academy, Lupus Street, London SW1V 3AT",
      streets: ["Lupus Street"],
      point: { lat: 51.488117, lng: -0.13763 },
    },
    {
      names: ["Romford United Services and Social Club"],
      address: "28 Mawney Road, Romford RM7 7HB",
      streets: ["28 Mawney Road"],
      point: { lat: 51.578564, lng: 0.176644 },
    },
    {
      names: ["Crofton Hall"],
      address: "Crofton Hall, Crofton Road, Orpington BR6 8PR",
      streets: ["Crofton Road"],
      point: { lat: 51.373409, lng: 0.087291 },
    },
    {
      names: ["Winning Post Pub & Grill", "Winning Post"],
      address: "Winning Post, Chertsey Road, Twickenham TW2 6LS",
      streets: ["Chertsey Road"],
      point: { lat: 51.44692, lng: -0.357807 },
    },
    {
      names: ["MPW Queen's Gate House", "Queen's Gate House"],
      address: "65 Queen's Gate, London SW7 5JS",
      streets: ["65 Queen's Gate"],
      point: { lat: 51.49553, lng: -0.17932 },
    },
    {
      names: ["Harris Academy Eltham"],
      address: "Harris Academy, Middle Park Avenue, London SE9 5EQ",
      streets: ["Middle Park Avenue"],
      point: { lat: 51.451482, lng: 0.03616 },
    },
    {
      names: ["New Windmill Hall"],
      address: "New Windmill Hall, St Mary's Lane, Upminster RM14 2QH",
      streets: ["St Mary's Lane"],
      point: { lat: 51.556416, lng: 0.245508 },
    },
    {
      names: ["Edith Neville Primary School"],
      address: "Edith Neville Primary School, Purchese Street, London NW1 1RW",
      streets: ["Purchese Street"],
      point: { lat: 51.532786, lng: -0.131288 },
    },
    {
      names: ["Warren Centre"],
      address: "Warren Centre, Northumberland House, London W1T 5JU",
      streets: ["Northumberland House"],
      point: { lat: 51.523619, lng: -0.138249 },
    },
    {
      names: ["St Saviour's and St Olave's School"],
      address: "47 Bartholomew Street, London SE1 4AN",
      streets: ["47 Bartholomew Street"],
      point: { lat: 51.494666, lng: -0.087566 },
    },
    {
      names: ["Bromley United Services Club"],
      address: "33 London Road, Bromley BR1 1DG",
      streets: ["33 London Road"],
      point: { lat: 51.409191, lng: 0.010068 },
    },
    {
      names: ["St Mary Moorfields Hall"],
      address: "4-5 Eldon Street, London EC2M 7LS",
      streets: ["4-5 Eldon Street"],
      point: { lat: 51.518717, lng: -0.085679 },
    },
    {
      names: ["Christ Church Hall, Blackfriars Road"],
      address: "27 Blackfriars Road, London SE1 8NY",
      streets: ["27 Blackfriars Road"],
      point: { lat: 51.505773, lng: -0.104797 },
    },
    {
      names: ["Zhulin Hidden Village"],
      address: "100-104 Lewisham High Street, London SE13 5JH",
      streets: ["100-104 Lewisham High Street"],
      point: { lat: 51.46291, lng: -0.010751 },
    },
    {
      names: ["City Sport", "City Sport Studio"],
      address: "124 Goswell Road, London EC1V 7DP",
      streets: ["124 Goswell Road"],
      point: { lat: 51.524709, lng: -0.099123 },
    },
    // Read 41157882789's postcode-only rows (D-487): Ticket Tailor writes the venue's name as its street
    // and a postcode. Addresses from pubology.co.uk and the organisers' pages; points are the postcode's
    // centre (postcodes.io, 2026-10-31).
    {
      names: ["The George IV", "George IV"],
      address: "185 Chiswick High Road, London W4 2DR",
      streets: ["185 Chiswick High Road"],
      point: { lat: 51.492291, lng: -0.257176 },
    },
    {
      names: ["The Drayton Court", "Drayton Court"],
      address: "2 The Avenue, London W13 8PH",
      streets: ["2 The Avenue"],
      point: { lat: 51.514716, lng: -0.319274 },
    },
    {
      names: ["Be At One - Regent Street", "Be At One Regent Street"],
      address: "10 Beak Street, London W1F 9RA",
      streets: ["10 Beak Street"],
      point: { lat: 51.511878, lng: -0.138454 },
    },
    {
      // DANCE GPS's Ticket Tailor page spells it "Dance Staion".
      names: ["Dance Staion", "Dance Station"],
      address: "80 Leadenhall Street, London EC3A 3DH",
      streets: ["80 Leadenhall Street"],
      point: { lat: 51.513356, lng: -0.078438 },
    },
    {
      // RSCDS London's Thursday Social, Upper Hall.
      names: ["St Columba's", "St Columba's Church", "St Columba's Church, Pont Street"],
      address: "Pont Street, London SW1X 0BD",
      streets: ["Pont Street"],
      point: { lat: 51.496553, lng: -0.162317 },
    },
    // Read 41327983492 (2026-11-01): addresses the geocoder refused as too vague. Each address is the
    // source's own street and postcode (5Rhythms class pages, RA, DICE, Incognito Dance's calendar);
    // each point is the postcode's centre (postcodes.io, 2026-11-01).
    {
      // 5Rhythms Dance Kew: "top floor of Kew Community Centre, St Luke's Church, The Avenue, Kew TW9 2AJ".
      names: [
        "Kew Community Centre",
        "Kew Community Centre, St Luke's Church",
        "top floor of Kew Community Centre",
        "St Luke's Church, Kew",
      ],
      address: "Kew Community Centre, St Luke's Church, The Avenue, London TW9 2AJ",
      streets: ["The Avenue, Kew"],
      point: { lat: 51.473686, lng: -0.287822 },
    },
    {
      // 5Rhythms Emerging Waves Balham: "Chestnut Grove School, Boundaries Road entrance, Balham SW12 8JZ".
      names: ["Chestnut Grove School", "Chestnut Grove Academy"],
      address: "Chestnut Grove School, Boundaries Road, London SW12 8JZ",
      streets: ["Boundaries Road"],
      point: { lat: 51.444657, lng: -0.155464 },
    },
    {
      // 5Rhythms saturday Waves: "URC Church, , Pond Square, Highgate, N6 6BA".
      names: [
        "URC Church",
        "URC Church, Pond Square",
        "Highgate URC",
        "Highgate United Reformed Church",
      ],
      address: "Highgate United Reformed Church, Pond Square, London N6 6BA",
      streets: ["Pond Square"],
      point: { lat: 51.570959, lng: -0.149216 },
    },
    {
      // 5Rhythms T.W.C: "St Luke, Hillmarton Road, London N7 9RE".
      names: [
        "St Luke",
        "St Luke, Hillmarton Road",
        "St Luke's, Hillmarton Road",
        "St Luke's Church, Hillmarton Road",
      ],
      address: "St Luke's Church, Hillmarton Road, London N7 9RE",
      streets: ["Hillmarton Road"],
      point: { lat: 51.553358, lng: -0.119609 },
    },
    {
      // 5Rhythms Friday Beat: "Marlborough Primary School, Draycott Ave, Chelsea, London SW3 3AP".
      names: ["Marlborough Primary School"],
      address: "Marlborough Primary School, Draycott Avenue, London SW3 3AP",
      streets: ["Draycott Avenue"],
      point: { lat: 51.492679, lng: -0.165887 },
    },
    {
      // 5Rhythms Body Prayer: "Large Dance Studio, ACLAND BURGHLEY SCHOOL, Entrance on Churchill Road, NW5 1AN".
      names: ["Acland Burghley School", "Large Dance Studio, Acland Burghley School"],
      address: "Acland Burghley School, Churchill Road, London NW5 1AN",
      streets: ["Churchill Road"],
      point: { lat: 51.557893, lng: -0.141235 },
    },
    {
      // RA: "Arch 535, Orphans Yard, Brixton Station Rd, London SW9 8QB".
      names: ["Arch535", "Arch 535"],
      address: "Arch 535, Orphans Yard, Brixton Station Road, London SW9 8QB",
      streets: ["Orphans Yard"],
      point: { lat: 51.463916, lng: -0.107323 },
    },
    {
      // RA: "joiner street, se1 9QU".
      names: ["The View From The Shard"],
      address: "The Shard, Joiner Street, London SE1 9QU",
      streets: ["Joiner Street"],
      point: { lat: 51.50444, lng: -0.086422 },
    },
    {
      // RA and DICE: "Hanbury St, London E1 5JP".
      names: ["Kizuna"],
      address: "Hanbury Street, London E1 5JP",
      streets: ["Hanbury Street"],
      point: { lat: 51.520431, lng: -0.071193 },
    },
    {
      // DICE: "02 Hollywood Bowl", "Peninsula Square, Greenwich, London, SE10 0EN".
      names: ["02 Hollywood Bowl", "O2 Hollywood Bowl", "Hollywood Bowl O2"],
      address: "Hollywood Bowl, Peninsula Square, London SE10 0EN",
      streets: ["Peninsula Square"],
      point: { lat: 51.501459, lng: 0.005308 },
    },
    {
      // DICE: "Block C", "E15 2SJ, London, Greater London, England" (postcode only).
      names: ["Block C"],
      address: "Block C, London E15 2SJ",
      point: { lat: 51.544647, lng: -0.021406 },
    },
    {
      // Incognito Dance's calendar: "Earls Court Salsa & Bachata Club, Earls Court Road, London, W8 6QH".
      names: ["Earls Court Salsa & Bachata Club"],
      address: "Earls Court Salsa & Bachata Club, Earls Court Road, London W8 6QH",
      streets: ["Earls Court Road"],
      point: { lat: 51.495327, lng: -0.195718 },
    },
    {
      // Sway Bar, Holborn (its seed's venueAddress, config/sources/london.ts). latinkrazy.com's Thursday
      // page writes "@ SWAY BAR 61-65 Great Queen Street London WC2B 5BZ near Holborn"; the name alone was
      // geocoded near Cannon Street (2026-11-05 row). Point: the stored Holborn venue (coverage-89, 2026-11-01).
      names: ["Sway Bar", "Sway Bar London", "Sway", "Sway Bar Holborn"],
      address: "Sway, 61-65 Great Queen Street, London WC2B 5BZ",
      streets: ["Great Queen Street"],
      point: { lat: 51.51575, lng: -0.12044 },
      canonical: true,
    },
  ],
  philadelphia: [
    // Estilo Dance Studio's Fishtown studio: its contact page gives 2036 Frankford Ave, 19125 (2026-10-31); the
    // site had it at 2301 N Front St (stale). Its Old City classes are inside Brasil's (112 Chestnut St, own entry).
    {
      names: ["Estilo Dance Studio", "Estilo Dance Studio Fishtown", "Estilo Dance"],
      address: "2036 Frankford Ave, Philadelphia, PA 19125",
      canonical: true,
    },
    // National Mechanics, Old City: its own site and La Discoteka's Eventbrite gave two names for one bar on 11-06
    // (D-524 gap analysis); 22 S 3rd St from its own home page (2026-10-31).
    {
      names: [
        "National Mechanics",
        "National Mechanics Bar and Restaurant",
        "National Mechanics Bar & Restaurant",
      ],
      address: "22 S 3rd St, Philadelphia, PA 19106",
      canonical: true,
    },
    // Woody's, Gayborhood: its own site and Out x Out's event pages (D-524); 202 S 13th St (own site, 2026-10-31).
    {
      names: ["Woody's", "Woodys", "Woody's Bar", "Woody's Philadelphia"],
      address: "202 S 13th St, Philadelphia, PA 19107",
      canonical: true,
    },
    // Thursday Contra's Mt Airy hall: its Meetup pages give "6815 Emlen St, Philadelphia, PA" with no ZIP;
    // thursdaycontra.com gives "The Irish Center (a.k.a. Commodore John Barry Arts and Cultural Center), 6815 Emlen
    // St., Philadelphia, PA 19119" (2026-10-29).
    {
      names: [
        "Commodore John Barry Arts and Cultural Center",
        "The Irish Center",
        "Commodore Barry Club",
      ],
      address: "6815 Emlen St, Philadelphia, PA 19119",
    },
    // PBR's country bar at Stateside Live! (Xfinity Live! until 2025), line dancing on Thursdays; Our Philly names
    // it "PBR Philly at Stateside Live!" with no street (run 40943365923). 1100 Pattison Ave: Visit Philly (2026-10-29).
    {
      names: [
        "PBR Philly",
        "PBR Philly at Stateside Live!",
        "PBR: A Coors Banquet Bar",
        "Stateside Live!",
      ],
      address: "1100 Pattison Ave, Philadelphia, PA 19148",
    },
    // Old City Latin club; Our Philly and Salsa Vida give 112 Chestnut St (2026-10-29).
    {
      names: ["Brasil's Nightclub", "Brasils Nightclub", "Brasil's"],
      address: "112 Chestnut St, Philadelphia, PA 19106",
    },
    // South Broad DJ bar; Our Philly's event pages give 1539 South Broad Street (2026-10-29).
    {
      names: ["The Dolphin Tavern", "Dolphin Tavern", "The Dolphin"],
      address: "1539 S Broad St, Philadelphia, PA 19147",
    },
    // The Rail Park's elevated park (Siempre Salsa's "Dance on the Park"); Our Philly gives 1300 Noble Street (2026-10-29).
    { names: ["The Rail Park", "Rail Park"], address: "1300 Noble St, Philadelphia, PA 19123" },
    // Gayborhood LGBTQ nightclub; Out x Out names it "Voyeur Nightclub" or "Voyeur" ("Weekends at Voyeur") while
    // its own site gives 1221 St James St (voyeurnightclub.com, 2026-10-30), so both rows share one venue.
    // Out x Out also writes "Voyeur Nightclub, Philadelphia" (read 41223672054: a 11-13 duplicate); canonical.
    {
      names: [
        "Voyeur",
        "Voyeur Nightclub",
        "Voyeur Night Club",
        "Voyeur Philly",
        "Voyeur Nightclub, Philadelphia",
      ],
      address: "1221 St James St, Philadelphia, PA 19107",
      canonical: true,
    },
    // West Philadelphia lounge (Temple Swag & Friends' nights): its Eventbrite listings name it "Spades Restaurant &
    // Lounge | SpadesPHL" at 4022 Lancaster Ave, 19104 (event 1909334724559, 2026-10-31), so cards showed the raw
    // name; canonical stores its listings under the first name.
    {
      names: [
        "Spades Restaurant & Lounge",
        "Spades Restaurant & Lounge | SpadesPHL",
        "Spades PHL",
        "SpadesPHL",
      ],
      address: "4022 Lancaster Ave, Philadelphia, PA 19104",
      canonical: true,
    },
  ],
  "new-orleans": [
    // WWOZ Livewire names its venues without an address (D-342), and the band bars' feeds write "618 Frenchman
    // St" with no ZIP. Each address is the venue's WWOZ page (wwoz.org/organizations/<slug>), checked against
    // the US Census geocoder for street spelling and ZIP (2026-10-29); the Rabbit Hole, the Jazz & Blues Market
    // (Oretha Castle Haley Blvd, which the geocoder does not know) and the Orpheum keep WWOZ's and the venue's own
    // ZIP. Out-of-parish venues (Gretna, Arabi, Harahan, Jefferson, Slidell, Bay St. Louis, Baton Rouge) are left out.
    { names: ["Preservation Hall"], address: "726 St Peter St, New Orleans, LA 70116" },
    { names: ["Fritzel's Jazz Club"], address: "733 Bourbon St, New Orleans, LA 70116" },
    { names: ["Mahogany Jazz Hall"], address: "125 Chartres St, New Orleans, LA 70130" },
    {
      names: ["d.b.a.", "DBA New Orleans", "dba", "d.b.a. New Orleans"],
      address: "618 Frenchmen St, New Orleans, LA 70116",
    },
    { names: ["21st Amendment"], address: "725 Iberville St, New Orleans, LA 70130" },
    {
      names: ["Maple Leaf", "Maple Leaf Bar", "The Maple Leaf"],
      address: "8316 Oak St, New Orleans, LA 70118",
    },
    { names: ["The Maison", "Maison"], address: "508 Frenchmen St, New Orleans, LA 70116" },
    {
      names: ["New Orleans Jazz National Historical Park"],
      address: "419 Decatur St, New Orleans, LA 70130",
    },
    {
      names: ["Café Negril", "Cafe Negril", "Café Negril on Frenchmen", "Cafe Negril on Frenchmen"],
      address: "606 Frenchmen St, New Orleans, LA 70116",
    },
    { names: ["Favela Chic"], address: "525 Frenchmen St, New Orleans, LA 70116" },
    {
      names: [
        "Spotted Cat",
        "The Spotted Cat",
        "Spotted Cat Music Club",
        "The Spotted Cat Music Club",
      ],
      address: "623 Frenchmen St, New Orleans, LA 70116",
    },
    { names: ["Okay Bar"], address: "1700 Port St, New Orleans, LA 70117" },
    { names: ["Pat O'Brien's"], address: "718 St Peter St, New Orleans, LA 70116" },
    { names: ["Dos Jefes"], address: "5535 Tchoupitoulas St, New Orleans, LA 70115" },
    { names: ["Maison Bourbon Jazz Club"], address: "641 Bourbon St, New Orleans, LA 70130" },
    { names: ["Saturn Bar"], address: "3067 St Claude Ave, New Orleans, LA 70117" },
    { names: ["BMC"], address: "1331 Decatur St, New Orleans, LA 70116" },
    { names: ["Snug Harbor"], address: "626 Frenchmen St, New Orleans, LA 70116" },
    {
      names: ["The Rabbit Hole", "Rabbit Hole"],
      address: "1228 Oretha Castle Haley Blvd, New Orleans, LA 70113",
    },
    { names: ["Saenger Theatre"], address: "1111 Canal St, New Orleans, LA 70112" },
    { names: ["Bamboula's"], address: "514 Frenchmen St, New Orleans, LA 70116" },
    {
      names: ["Bayou Bar at the Pontchartrain"],
      address: "2031 St Charles Ave, New Orleans, LA 70130",
    },
    { names: ["Bacchanal (OUTDOORS)"], address: "600 Poland Ave, New Orleans, LA 70117" },
    { names: ["Chickie Wah Wah"], address: "2828 Canal St, New Orleans, LA 70119" },
    { names: ["Siberia"], address: "2227 St Claude Ave, New Orleans, LA 70117" },
    { names: ["30/90"], address: "520 Frenchmen St, New Orleans, LA 70116" },
    {
      // One venue: WWOZ lists the upstairs room as its own place, Blue Nile writes "(Balcony Room)" in titles,
      // so both read as Blue Nile and the same night merges (coverage-46, 2026-10-29).
      names: [
        "Blue Nile",
        "The Blue Nile",
        "Blue Nile Live",
        "Blue Nile - Balcony Room",
        "Blue Nile Balcony Room",
      ],
      address: "532 Frenchmen St, New Orleans, LA 70116",
      canonical: true,
    },
    {
      names: ["Bourbon O Bar at The Bourbon Orleans Hotel"],
      address: "717 Orleans Ave, New Orleans, LA 70116",
    },
    { names: ["Broadside (Outdoor Stage)"], address: "600 N Broad St, New Orleans, LA 70119" },
    { names: ["Crescent City Brewhouse"], address: "527 Decatur St, New Orleans, LA 70130" },
    {
      names: ["The Polo Club at Windsor Court", "Polo Club at Windsor Court"],
      address: "300 Gravier St, New Orleans, LA 70130",
    },
    { names: ["Carrollton Station"], address: "8140 Willow St, New Orleans, LA 70118" },
    { names: ["Gasa Gasa"], address: "4920 Freret St, New Orleans, LA 70115" },
    { names: ["New Orleans Jazz Museum"], address: "400 Esplanade Ave, New Orleans, LA 70116" },
    {
      names: ["New Orleans Jazz & Blues Market"],
      address: "1436 Oretha Castle Haley Blvd, New Orleans, LA 70113",
    },
    { names: ["Three Muses"], address: "536 Frenchmen St, New Orleans, LA 70116" },
    { names: ["Cajun Boil House"], address: "438 Canal St, New Orleans, LA 70130" },
    {
      names: ["Mayfield's 208 Bourbon presented by Felix's"],
      address: "208 Bourbon St, New Orleans, LA 70130",
    },
    {
      names: [
        "Mid-City Lanes Rock 'n' Bowl",
        "Rock 'n' Bowl",
        "Rock n Bowl",
        "Rock 'n' Bowl New Orleans",
      ],
      address: "3016 S Carrollton Ave, New Orleans, LA 70118",
    },
    { names: ["NOLA Brewing"], address: "3001 Tchoupitoulas St, New Orleans, LA 70115" },
    {
      names: ["Twilight Room at The Allways Lounge"],
      address: "2240 St Claude Ave, New Orleans, LA 70117",
    },
    {
      names: ["Tipitina's", "Tipitina's Uptown"],
      address: "501 Napoleon Ave, New Orleans, LA 70115",
    },
    { names: ["Bar Redux"], address: "801 Poland Ave, New Orleans, LA 70117" },
    { names: ["BJ's Lounge"], address: "4301 Burgundy St, New Orleans, LA 70117" },
    { names: ["B Mac's (OUTDOORS)"], address: "819 St Louis St, New Orleans, LA 70112" },
    { names: ["Buffa's"], address: "1001 Esplanade Ave, New Orleans, LA 70116" },
    {
      names: ["Carousel Bar & Lounge at Hotel Monteleone"],
      address: "214 Royal St, New Orleans, LA 70130",
    },
    {
      names: ["Chemin à la Mer at Four Seasons Hotel"],
      address: "2 Canal St, New Orleans, LA 70130",
    },
    {
      names: ["Davenport Lounge at The Ritz-Carlton"],
      address: "921 Canal St, New Orleans, LA 70112",
    },
    {
      names: ["The Domino Lounge", "Domino Lounge"],
      address: "3044 St Claude Ave, New Orleans, LA 70117",
    },
    { names: ["Good Measure at The Barnett"], address: "600 Carondelet St, New Orleans, LA 70130" },
    { names: ["Holy Diver"], address: "1200 St Bernard Ave, New Orleans, LA 70116" },
    { names: ["Le Bon Temps Roulé"], address: "4801 Magazine St, New Orleans, LA 70115" },
    { names: ["Santos Bar"], address: "1135 Decatur St, New Orleans, LA 70116" },
    { names: ["Tuff Break Loser's Lounge"], address: "3021 St Claude Ave, New Orleans, LA 70117" },
    { names: ["Lobby Lounge at JW Marriott"], address: "614 Canal St, New Orleans, LA 70130" },
    { names: ["NOLA 'Nacular Art Gallery"], address: "1172 Magazine St, New Orleans, LA 70130" },
    { names: ["Banks Street Bar"], address: "4401 Banks St, New Orleans, LA 70119" },
    { names: ["The Broadside", "Broadside"], address: "600 N Broad St, New Orleans, LA 70119" },
    {
      names: ["Chapel Club at Hotel St. Vincent"],
      address: "1507 Magazine St, New Orleans, LA 70130",
    },
    {
      names: ["Double Dealer at the Orpheum Theater"],
      address: "129 Roosevelt Way, New Orleans, LA 70112",
    },
    { names: ["Howlin' Wolf"], address: "907 S Peters St, New Orleans, LA 70130" },
    { names: ["Howlin' Wolf - The Den"], address: "907 S Peters St, New Orleans, LA 70130" },
    { names: ["Kerry Irish Pub"], address: "331 Decatur St, New Orleans, LA 70130" },
    {
      names: ["LSU New Orleans - Lakefront Arena"],
      address: "6801 Franklin Ave, New Orleans, LA 70122",
    },
    { names: ["May Baily's Place"], address: "415 Dauphine St, New Orleans, LA 70112" },
    { names: ["Old Point Bar"], address: "545 Patterson Dr, New Orleans, LA 70114" },
    {
      names: ["Republic New Orleans", "Republic NOLA"],
      address: "828 S Peters St, New Orleans, LA 70130",
    },
    { names: ["Paulie's"], address: "8201 Oak St, New Orleans, LA 70118" },
    { names: ["Tropical Isle Bourbon"], address: "721 Bourbon St, New Orleans, LA 70116" },
    {
      names: ["Audubon Clubhouse by Dickie Brennan"],
      address: "6975 Magazine St, New Orleans, LA 70118",
    },
    { names: ["Columns Hotel"], address: "3811 St Charles Ave, New Orleans, LA 70115" },
    {
      names: ["Ellis Marsalis Center for Music"],
      address: "1901 Bartholomew St, New Orleans, LA 70117",
    },
    { names: ["Tigermen Den"], address: "3113 Royal St, New Orleans, LA 70117" },
    { names: ["AllWays Lounge"], address: "2240 St Claude Ave, New Orleans, LA 70117" },
    { names: ["Apple Barrel"], address: "609 Frenchmen St, New Orleans, LA 70116" },
    { names: ["Markey Park (OUTDOORS)"], address: "3301 Royal St, New Orleans, LA 70117" },
    { names: ["St. Roch Tavern"], address: "1200 St Roch Ave, New Orleans, LA 70117" },
    { names: ["Café Degas"], address: "3127 Esplanade Ave, New Orleans, LA 70119" },
    { names: ["Café Istanbul"], address: "2372 St Claude Ave, New Orleans, LA 70117" },
    { names: ["Howlin' Wolf - The Porch"], address: "907 S Peters St, New Orleans, LA 70130" },
    {
      names: ["LSU New Orleans - The Sandbar at The Cove"],
      address: "2000 Lakeshore Dr, New Orleans, LA 70122",
    },
    {
      names: ["Picnic Provisions & Whiskey (OUTDOORS)"],
      address: "741 State St, New Orleans, LA 70118",
    },
    { names: ["Aguasanta"], address: "8312 Oak St, New Orleans, LA 70118" },
    {
      names: ["The Blue Crawfish", "Blue Crawfish"],
      address: "1620 Dumaine St, New Orleans, LA 70116",
    },
    { names: ["Brutto Americano"], address: "600 Carondelet St, New Orleans, LA 70130" },
    {
      names: ["Commons Club at Virgin Hotels New Orleans"],
      address: "550 Baronne St, New Orleans, LA 70113",
    },
    { names: ["Dew Drop Inn Hotel & Lounge"], address: "2836 LaSalle St, New Orleans, LA 70115" },
    { names: ["The Fillmore", "Fillmore"], address: "6 Canal St, New Orleans, LA 70130" },
    { names: ["Joy Theater"], address: "1200 Canal St, New Orleans, LA 70112" },
    { names: ["Junebug"], address: "744 Camp St, New Orleans, LA 70130" },
    {
      names: ["Music Box Village (OUTDOORS)"],
      address: "4557 N Rampart St, New Orleans, LA 70117",
    },
    {
      names: ["San Lorenzo Restaurant at Hotel St. Vincent"],
      address: "1507 Magazine St, New Orleans, LA 70130",
    },
    { names: ["Skeeta Hawk Brewing"], address: "455 N Dorgenois St, New Orleans, LA 70119" },
    {
      names: ["Community Farmers Market - Marigny (OUTDOORS)"],
      address: "2624 Burgundy St, New Orleans, LA 70117",
    },
    {
      names: ["HEY Coffee Co. on the Greenway"],
      address: "2606 St Louis St, New Orleans, LA 70119",
    },
    { names: ["Hi Ho Lounge"], address: "2239 St Claude Ave, New Orleans, LA 70117" },
    {
      names: [
        "Kermit's Tremé Mother-in-Law Lounge",
        "Kermit's Treme Mother-in-Law Lounge",
        "Mother-in-Law Lounge",
      ],
      address: "1500 N Claiborne Ave, New Orleans, LA 70116",
    },
    { names: ["New Marigny Theatre"], address: "2301 Marais St, New Orleans, LA 70117" },
    {
      names: ["New Orleans Catholic Worker House"],
      address: "1910 Constance St, New Orleans, LA 70130",
    },
    { names: ["Venue Vapaille"], address: "4201 Washington Ave, New Orleans, LA 70125" },
    {
      names: ["Constantinople Stage (OUTDOORS)"],
      address: "1201 Constantinople St, New Orleans, LA 70115",
    },
    { names: ["The Dog House", "Dog House"], address: "2736 Banks St, New Orleans, LA 70119" },
    { names: ["4141 NOLA"], address: "4141 St Charles Ave, New Orleans, LA 70115" },
    { names: ["Abita New Orleans"], address: "2375 Tchoupitoulas St, New Orleans, LA 70130" },
    { names: ["Civic Theatre"], address: "510 O'Keefe Ave, New Orleans, LA 70113" },
    { names: ["Fat Catz"], address: "440 Bourbon St, New Orleans, LA 70130" },
    {
      names: ["Mahalia Jackson Theater for the Performing Arts"],
      address: "1419 Basin St, New Orleans, LA 70116",
    },
    { names: ["New Orleans Storyville Museum"], address: "1010 Conti St, New Orleans, LA 70112" },
    { names: ["Ogden Museum of Southern Art"], address: "925 Camp St, New Orleans, LA 70130" },
    {
      names: ["Peacock Room at the Kimpton Hotel Fontenot"],
      address: "501 Tchoupitoulas St, New Orleans, LA 70130",
    },
    { names: ["Salon Salon"], address: "544 Carondelet St, New Orleans, LA 70112" },
    { names: ["Vaughan's Lounge"], address: "4229 Dauphine St, New Orleans, LA 70117" },
    // The National WWII Museum's event pages name the room only ("BB's Stage Door Canteen", no ZIP); the event
    // page's Location block gives "BB's Stage Door Canteen, 945 Magazine St, New Orleans, LA 70130" (2026-10-30).
    {
      names: [
        "BB's Stage Door Canteen",
        "Stage Door Canteen",
        "The National WWII Museum",
        "National WWII Museum",
      ],
      address: "945 Magazine St, New Orleans, LA 70130",
    },
    // Ohm Lounge's Eventbrite rows name it "Ohm Lounge, Tchoupitoulas Street, New Orleans, LA, USA" with no house
    // number; its own site gives 601 Tchoupitoulas Street, 70130 (2026-10-30). "Tchoupitoulas Street" as an area lets
    // that no-number address take the checked one.
    {
      names: ["Ohm Lounge", "OHM Lounge"],
      address: "601 Tchoupitoulas St, New Orleans, LA 70130",
      areas: ["Tchoupitoulas Street"],
      canonical: true,
    },
    // Tremé Recreation Community Center, start of second-line routes on WWOZ's "Takin' It to the Streets" pages
    // ("START Treme Center", Family Ties 2026-11-14); the wwoz_streets adapter writes "Route starts at <start>".
    // Address: NORD's page nordc.org/parks/treme/ (900 N. Villere St., 70116; checked 2026-11-01).
    {
      names: [
        "Treme Recreation Community Center",
        "Tremé Recreation Community Center",
        "Treme Center",
        "Tremé Center",
        "Route starts at Treme Center",
        "Route starts at Tremé Center",
      ],
      address: "900 N Villere St, New Orleans, LA 70116",
    },
  ],
  miami: [
    // Hole19 Scratch Kitchen + Bar, inside Miami Springs Golf & Country Club: the Miami Salsa Events
    // Meetup page writes "650 Curtiss Parkway, Miami Springs, FL" with no ZIP; Eventbrite's listing
    // and the geocoder give 650 Curtiss Parkway, Miami Springs, FL 33166 (first Miami run, 2026-10-29).
    {
      names: [
        "Hole19 Scratch Kitchen + Bar",
        "Hole 19 Scratch Kitchen + Bar",
        "Hole 19 - Scratch Kitchen + Bar",
        "Miami Springs Golf & Country Club",
      ],
      address: "650 Curtiss Parkway, Miami Springs, FL 33166",
      streets: ["Curtiss Parkway"],
    },
    // Copper Blues, CityPlace Doral: its own page, Eventbrite and Salsa Vida each name it differently, so one
    // place showed as three venues (full read 40948147705, 2026-10-29). Address from its own info page.
    {
      names: [
        "Copper Blues Miami (Doral)",
        "Copper Blues Miami",
        "Copper Blues Rock Pub & Kitchen",
        "Copper Blues CityPlace Doral",
      ],
      address: "3450 NW 83rd Ave, Suite 224, Doral, FL 33122",
      canonical: true,
    },
    // Giralda Plaza, the pedestrian 100 block of Giralda Ave (Ponce de Leon to Galiano): the Salsa Cooperative's
    // outdoor salsa nights name only the plaza (full read 41043635061, 2026-10-30). coralgables.com attraction page.
    {
      names: ["Giralda Plaza", "Giralda Plaza Coral Gables"],
      address: "100 Giralda Avenue, Coral Gables, FL 33134",
      streets: ["Giralda Avenue", "Giralda Ave"],
    },
    // DanceArts Miami, Little River: its Eventbrite listings name the studio three ways (its name, the street
    // address, and the address with "USA"), so one studio showed as three venues (full read 41157878059, 2026-10-31).
    {
      names: ["DanceArts Miami", "250 Northeast 61st Street, Miami, FL, USA", "250 NE 61st St"],
      address: "250 NE 61st St, Miami, FL 33137",
      canonical: true,
    },
    // ZeyZey, Little River: RA writes "ZeyZey", ma.to "ZeyZey Miami" (D-519 audit F1); the address both give.
    {
      names: ["ZeyZey", "ZeyZey Miami"],
      address: "353 NE 61st St, Miami, FL 33137",
      canonical: true,
    },
    // Miami Baila Calle 8, Little Havana: TangoMango writes the studio's website "www.Miamibaila.Com" as the venue
    // (daily read 41440870332, 2026-11-02); its Eventbrite venue 98677249 is "MIAMI BAILA CALLE 8", 760 Southwest
    // 10th Avenue, Miami, FL 33130.
    {
      names: ["Miami Baila Calle 8", "www.Miamibaila.Com"],
      address: "760 SW 10th Ave, Miami, FL 33130",
      canonical: true,
    },
  ],
  istanbul: [
    // Resident Advisor's Istanbul venues that went unplaced in read 2 (run 41175768160, 2026-10-31): RA gives
    // "Tomtom, Tosbağa Sk. 14/A, 34433 Beyoğlu", "Zeytinlik Mah. Yakut Sok. No:7 (Eski 74 Sineması), 34140
    // Bakırköy/İstanbul" and "Cihannüma Mahallesi, Hasfırın Cd. No:26 City: Beşiktaş ... Postal code: 34353".
    // NOH Extended: point is Tosbağa Sokağı, Tomtom (OpenStreetMap street, 2026-10-31; no building in OSM).
    {
      names: ["NOH Extended", "NOH"],
      address: "Tosbağa Sokak 14/A, Tomtom, 34433 Beyoğlu/İstanbul",
      point: { lat: 41.0328596, lng: 28.9773898 },
    },
    // 74 Hall: the old 74 cinema in Zeytinlik, Bakırköy. Point from Bugece's venue record (40.9790922, 28.8735522),
    // which OpenStreetMap reverse-geocodes to "Sahne74", Yakut Sokağı, Zeytinlik (checked 2026-10-31).
    // canonical: true so RA's "74 Hall" and Bugece's "74HALL" land on one venue and the same night merges (D-265).
    {
      names: ["74 Hall", "74 Hall Bakırköy", "74HALL", "Sahne74"],
      canonical: true,
      address: "Zeytinlik Mahallesi, Yakut Sokak No:7, 34140 Bakırköy/İstanbul",
      point: { lat: 40.9790922, lng: 28.8735522 },
    },
    // IF Performance Hall Beşiktaş: OpenStreetMap node "If Performance Hall", Akmazçeşme Sokağı 26 (2026-10-31).
    {
      names: [
        "IF Performance Hall Beşiktaş",
        "IF Performance Hall",
        "If Performance Hall Beşiktaş",
      ],
      address: "Hasfırın Caddesi No:26, Cihannüma Mahallesi, 34353 Beşiktaş/İstanbul",
      point: { lat: 41.0443827, lng: 29.0066032 },
    },
    // Swing Planet's two studios: addresses from its contact page https://www.swingplanet.com.tr/iletisim
    // (2026-10-31). Postcodes from OpenStreetMap: Kazım Orbay Caddesi 35 on the same side is Merkez Mahallesi 34381;
    // Eğitim Mahallesi, Kadıköy is 34722. Points are the studios' own Google Maps pins on that contact page (2026-10-31).
    {
      names: ["Swing Planet Bomonti"],
      address: "Merkez Mah. Kazım Orbay Cad. No:41, Eran Han Kat:2, Bomonti, 34381 Şişli/İstanbul",
      point: { lat: 41.0604596, lng: 28.9833554 },
    },
    {
      names: ["Swing Planet Kadıköy"],
      address: "Eğitim Mah. Adım Sokağı, Oran Plaza İş Merkezi No: 10-18, 34722 Kadıköy/İstanbul",
      point: { lat: 40.9929404, lng: 29.0423373 },
    },
    // areas: the exact area text each row writes ("Taksim / İstanbul"), so the row takes the checked address and point.
    // TangoDANS's milonga list (https://tangodans.com/en/milongas) gives only an area per row; venues checked 2026-10-31.
    // Tango Mia: point is the "TangoMia" Google Maps pin linked from TangoDANS's own row; OSM reverse: Sahne Sokağı, Hüseyinağa.
    {
      names: ["Tango Mia", "TangoMia", "Tango Mia Milonga", "Tango Mia Pratik Milonga"],
      address: "Sahne Sokağı, Hüseyinağa Mah., 34435 Beyoğlu/İstanbul",
      areas: ["Taksim / İstanbul", "Taksim"],
      point: { lat: 41.0341764, lng: 28.9775777 },
    },
    // 333 Milonga: OSM dancing_school "333 Milonga", Sıraselviler Caddesi 33 (istanbultango.com gives the same address).
    {
      names: ["333 Milonga", "Milonga 333", "Milonga @333"],
      address: "Sıraselviler Cad. No:33, Cihangir, 34433 Beyoğlu/İstanbul",
      areas: ["Taksim / İstanbul", "Taksim"],
      point: { lat: 41.0350711, lng: 28.9848597 },
    },
    // Milonga Tormenta: OSM dancing_school "Milonga Tormenta", Karadut Sokak 30 (Tormenta's own site no longer resolves).
    {
      names: ["Milonga Tormenta", "Tormenta"],
      address: "Karadut Sokak No:30, Osmanağa, 34714 Kadıköy/İstanbul",
      areas: ["Kadıköy / İstanbul"],
      point: { lat: 40.990015, lng: 29.0308726 },
    },
    // Zeytuna: OSM restaurant "Zeytuna Cezayir'de", Hayriye Caddesi 12, Firuzağa (Hoy Milonga gives the same address).
    {
      names: ["Zeytuna Cezayir'de", "Zeytuna", "Zeytuna Tango Milongası", "Zeytuna Tango Bar"],
      address: "Hayriye Cad. No:12, Firuzağa, 34425 Beyoğlu/İstanbul",
      areas: ["Beyoğlu / İstanbul"],
      point: { lat: 41.0318135, lng: 28.9794648 },
    },
    // Bora Erdem Dans Cafe (Milongahane): address from its own contact page; point is OSM's Akdoğan Sokağı by No. 25 (no building for 23/A).
    {
      names: [
        "Bora Erdem Dans Cafe",
        "Milongahane",
        "Milongahane / Bora Erdem Dans Cafe",
        "Bora Erdem Dans Spor Cafe",
      ],
      address: "Cihannüma Mah. Akdoğan Sok. No:23/A, 34022 Beşiktaş/İstanbul",
      areas: ["Beşiktaş / İstanbul", "Beşiktaş"],
      point: { lat: 41.0478445, lng: 29.0074418 },
    },
    // Tangoist: address from its own contact page (Mis Han No:7 Kat:2); point is OSM's Mis Sokağı (no building for No. 7).
    {
      names: ["Tangoist", "Tangoist Stüdyo", "Tangoist Stüdyo Milongası"],
      address: "İstiklal Cad. Mis Sok. Mis Han No:7 Kat:2, Şehit Muhtar, 34435 Beyoğlu/İstanbul",
      areas: ["Taksim / İstanbul", "Taksim"],
      point: { lat: 41.0359809, lng: 28.9816883 },
    },
    // Armada Otel: OSM "Armada", Ahırkapı Caddesi 10, Cankurtaran (the TangoDANS row: "Armada Otel / Sultanahmet / Ahırkapı Restaurant").
    {
      names: ["Armada Otel", "Armada Hotel", "Armada Otel Milonga"],
      address: "Ahırkapı Cad. No:10, Cankurtaran, 34122 Fatih/İstanbul",
      point: { lat: 41.003872, lng: 28.9815882 },
    },
  ],
  lisbon: [
    // Teatro da Luz, Carnide: Trad Balls' monthly balls; Viral Agenda writes "Largo da Luz (Colégio Militar)"
    // with no number or postcode, so it went unplaced. Time Out Lisboa gives Largo da Luz 2, 1600-498 Lisboa
    // (2026-10-29). The house number is kept: the geocoder places only an address with one (D-071).
    // Viral Agenda writes the town-only "Largo da Luz (Colégio Militar), Lisboa, PT" (PT ignored, coverage-43).
    {
      names: ["Teatro da Luz"],
      address: "Largo da Luz 2, 1600-498 Lisboa",
      streets: ["Largo da Luz"],
      areas: ["Largo da Luz (Colégio Militar)"],
    },
    // Rooms salsalisbon.com and the Bachata Lisboa Meetup name with no street (run 40943335594: all unplaced).
    // A street with a house number and "Lisboa" places without a postcode (D-258).
    // Sources also write the town as "Lisbon" ("Lisbon, PT"), so each entry lists it as an area.
    // Time Out Market Lisboa (Mercado da Ribeira); Time Out, 2026-10-29.
    {
      names: ["Time Out Market", "Time Out Market Lisboa", "Time Out Market Lisbon"],
      address: "Av. 24 de Julho 49, 1200-479 Lisboa",
      areas: ["Lisbon", "Cais do Sodré"],
    },
    // B.leza, Cais do Sodre; Viral Agenda's venue page /pt/p/BlezaClube gives "Cais do Gás 1" (2026-10-29).
    {
      names: ["B.leza", "B.Leza", "B.leza Clube", "Clube B.leza"],
      address: "Cais do Gás 1, Lisboa",
      areas: ["Lisbon", "Cais do Sodré"],
    },
    // BUS - Paragem Cultural, Anjos; Viral Agenda's venue page /pt/p/BusParagemCultural gives "Rua Maria, 73".
    {
      names: ["BUS Paragem Cultural", "BusParagem", "BUS - Paragem Cultural"],
      address: "Rua Maria 73, Lisboa",
      areas: ["Lisbon", "Anjos"],
    },
    // Asha's Place, Santa Maria Maior (Only Cuban on Tuesdays); Urban Sports Club's venue page (2026-10-29).
    {
      names: ["Asha's Place"],
      address: "Rua do Diário de Notícias 59, Lisboa",
      areas: ["Lisbon"],
    },
    // Centro Galego - Xuventude de Galicia ("Oliva"), Santana; Viral Agenda and the Spanish embassy (2026-10-29).
    {
      names: ["Oliva (Xuventude de Galicia)", "Xuventude de Galicia", "Centro Galego de Lisboa"],
      address: "Rua Júlio de Andrade 3, Lisboa",
      areas: ["Lisbon"],
    },
    // Tropicavana Bar, Alvalade (Bachata Lisboa's Tuesday social); its Meetup event page (2026-10-29).
    // canonical: true so the card shows "Tropicavana Bar", not Meetup's "📍Tropicavana Bar" (2026-10-31).
    {
      names: ["Tropicavana Bar", "📍Tropicavana Bar", "Tropicavana"],
      address: "Rua José Pinheiro de Melo 60, Lisboa",
      areas: ["Lisbon", "Alvalade"],
      canonical: true,
    },
    // Jazzy Dance Studios, Santos (DanSunday; salsalisbon writes "Jazzy"): OSM's music_school node at Avenida de
    // Brasília 254, 1200-676 Lisboa, which salsalisbon's own "Av. Brasília 254" agrees with (2026-10-29).
    {
      names: ["Jazzy Dance Studios", "Jazzy", "Jazzy Dance Studios Santos", "Jazzy Santos"],
      address: "Avenida de Brasília 254, 1200-676 Lisboa",
      areas: ["Lisbon", "Santos"],
      point: { lat: 38.705976, lng: -9.1525255 },
    },
    // Bar Hawaii, Doca de Santo Amaro (Bachata Lisboa's Dominican nights): the docks use warehouse numbers, which
    // the geocoder cannot place, so the point is the one the organiser's Meetup event page gives (2026-10-29).
    {
      names: ["Bar Hawaii", "Bar Hawaii Doca", "Hawaii"],
      address: "Doca de Santo Amaro, Armazém 1, 1350-353 Lisboa",
      areas: ["Lisbon", "Alcântara"],
      point: { lat: 38.70034, lng: -9.177053 },
    },
    // Fábrica Braço de Prata, Marvila (arts centre). Run 40955491033: the geocoder answered 0.65 for
    // "R. Fábrica de Material de Guerra 1, 1950-128 Lisboa", so the point is OSM's arts_centre node at that
    // address (Nominatim, 2026-10-29).
    {
      names: ["Fábrica Braço de Prata", "Fábrica do Braço de Prata", "Fábrica de Braço de Prata"],
      address: "Rua da Fábrica de Material de Guerra 1, 1950-128 Lisboa",
      streets: ["Fábrica de Material de Guerra"],
      areas: ["Lisbon", "Marvila"],
      point: { lat: 38.7437961, lng: -9.1012245 },
    },
    // Academia do Lumiar, Largo Júlio de Castilho 3, 1600-483 (the source writes "Largo Júlio Castilho 3"; the
    // geocoder answered 0.45). Point: OSM's Largo Júlio de Castilho square, on which the academy stands (2026-10-29).
    {
      names: ["Academia do Lumiar"],
      address: "Largo Júlio de Castilho 3, 1600-483 Lisboa",
      streets: ["Largo Júlio Castilho", "Largo Júlio de Castilho"],
      areas: ["Lisbon", "Lumiar"],
      point: { lat: 38.7754529, lng: -9.1643254 },
    },
    // NOVA Desporto, the NOVA University sports centre on the Campus de Campolide (salsalisbon's Cuban salsa
    // classes, written "Nova Desporto Campus Campolide" with no street). Point and postcode: OSM's campus node,
    // Rua de Campolide, 1070-124 (Nominatim, 2026-10-29).
    {
      names: ["Nova Desporto Campus Campolide", "NOVA Desporto", "Nova Desporto Campolide"],
      address: "Campus de Campolide, Rua de Campolide, 1070-124 Lisboa",
      areas: ["Lisbon", "Campolide"],
      point: { lat: 38.7330911, lng: -9.1607543 },
    },
    // Sammy Sosa, Barreiro (riverside restaurant; salsalisbon's "La Última Rumba", written "Sammy Sosa, Barreiro").
    // OSM's restaurant node on Avenida da Liberdade, 2830-248 Barreiro (Nominatim, 2026-10-29); no house number.
    {
      names: ["Sammy Sosa"],
      address: "Avenida da Liberdade, 2830-248 Barreiro",
      // salsalisbon writes every row's town as "Lisbon, PT" (run 40959620384), so "Lisbon" is listed too.
      areas: ["Barreiro", "Lisbon"],
      point: { lat: 38.6497134, lng: -9.0681063 },
    },
    // Largo José Saramago, by the Casa dos Bicos (Salsa con Sol's outdoor "Salsa Caleña en Lisboa"; its Meetup event
    // page writes "Largo José Saramago, Lisbon, PT" with no postcode). Point: OSM's square (Nominatim, 2026-10-29).
    {
      names: ["Largo José Saramago"],
      address: "Largo José Saramago, 1100-016 Lisboa",
      streets: ["Largo José Saramago"],
      areas: ["Lisbon"],
      point: { lat: 38.7084462, lng: -9.1328372 },
    },
    // Mafondana Café, a shop in the Centro Comercial Gemini by Entrecampos station (NEOLONGA LX tango). Run
    // 40959620384 had "Mafondana Café - Espaço Gemini, R. Sousa Lopes 12B Loja 33, 1600-207 Lisboa", which the geocoder answered
    // 0.5. Point: OSM's "Gemini" retail building off Rua Sousa Lopes (Overpass, 2026-10-30).
    {
      names: [
        "Mafondana Café",
        "Mafondana Cafe",
        "Mafondana",
        "Mafondana Café - Espaço Gemini",
        "Mafondana Café - Centro Comercial Gemini",
      ],
      address: "Rua Sousa Lopes 12B, Loja 33, 1600-207 Lisboa",
      areas: ["Lisbon", "Entrecampos"],
      point: { lat: 38.7439632, lng: -9.1539299 },
    },
    // DJ-bar sweep venues (D-384). Each point is the OSM node whose name is the venue (Nominatim, 2026-10-30).
    // Casa Independente: OSM node 4391504305 (amenity=cafe), Largo do Intendente Pina Manique 45, 1100-285.
    {
      names: ["Casa Independente"],
      address: "Largo do Intendente Pina Manique 45, 1100-285 Lisboa",
      areas: ["Lisbon", "Arroios"],
      point: { lat: 38.7208405, lng: -9.1346505 },
    },
    // Trumps: OSM node 6047546785 (amenity=bar, "Trumps Lisbon"), Rua da Imprensa Nacional 104B, 1250-127.
    {
      names: ["Trumps", "Trumps Lisbon", "Trumps Lisboa"],
      address: "Rua da Imprensa Nacional 104B, 1250-127 Lisboa",
      areas: ["Lisbon", "Santo António"],
      point: { lat: 38.7174149, lng: -9.1519004 },
    },
    // Lust in Rio: OSM node 5103723582 (amenity=nightclub), Rua da Cintura do Porto de Lisboa, 1200-109.
    {
      names: ["Lust in Rio", "Lust In Rio"],
      address: "Rua da Cintura do Porto de Lisboa, 1200-109 Lisboa",
      areas: ["Lisbon", "Misericórdia"],
      point: { lat: 38.7059487, lng: -9.1499859 },
    },
    // DARC - Desterro: OSM node 3686322149 (club=music, "darc desterro"), Calçada do Desterro 7, 1100-089.
    {
      names: ["DARC - Desterro", "DARC Desterro", "Desterro", "DARC"],
      address: "Calçada do Desterro 7, 1100-089 Lisboa",
      areas: ["Lisbon", "Santa Maria Maior"],
      point: { lat: 38.7195525, lng: -9.1362771 },
    },
    // Milonga venues from TangoLX's own list of regular milongas (tangolx.com/milongas-1, 2026-10-30); each point is
    // the OSM object whose name is the venue (Nominatim, 2026-10-30). Postcodes are TangoLX's where it gives one.
    // Clube Ferroviario de Portugal (a Outra Milonga on Mondays, Rave Tanguera on 1st Saturdays): OSM node
    // "Ferroviario" at Rua de Santa Apolonia 59, postcode 1100-468.
    {
      names: [
        "Clube Ferroviario",
        "Clube Ferroviário de Portugal",
        "Clube Ferroviario de Portugal",
      ],
      address: "Rua de Santa Apolónia 59, 1100-468 Lisboa",
      areas: ["Lisbon", "São Vicente"],
      point: { lat: 38.7183989, lng: -9.11838 },
    },
    // Sporting Clube da Penha (Milonga La Orillera, 3rd Thursdays): OSM way at Rua da Penha de Franca 77.
    {
      names: ["Sporting Clube da Penha"],
      address: "Rua da Penha de França 77, 1170-034 Lisboa",
      areas: ["Lisbon", "Penha de França"],
      point: { lat: 38.7235283, lng: -9.1294963 },
    },
    // ADF - Academia Dramatica Familiar 1898 (Milonga La Gata, 2nd and 4th Fridays): OSM way at Rua da Praia de
    // Pedroucos 76, postcode 1400-282.
    {
      names: ["ADF", "Academia Dramática Familiar", "ADF - Academia Dramática Familiar 1898"],
      address: "Rua da Praia de Pedrouços 76, 1400-282 Lisboa",
      areas: ["Lisbon", "Belém"],
      point: { lat: 38.6945047, lng: -9.2178886 },
    },
    // Sociedade Recreativa Musical de Carcavelos (Milonga Dirigida, 3rd Saturdays): OSM node at R. Julio Moreira 5.
    {
      names: ["Sociedade Recreativa Musical de Carcavelos", "SRM Carcavelos"],
      address: "Rua Júlio Moreira 5, 2775-562 Carcavelos",
      areas: ["Cascais", "Carcavelos"],
      point: { lat: 38.6895796, lng: -9.3345851 },
    },
    // Externato A Promotora (Milonga a Promotora, 4th Saturdays): OSM node at Largo das Fontainhas 19.
    {
      names: ["A Promotora", "Externato A Promotora"],
      address: "Largo das Fontaínhas 19, 1300-501 Lisboa",
      areas: ["Lisbon", "Alcântara"],
      point: { lat: 38.704632, lng: -9.1770518 },
    },
    // Casa do Concelho de Castanheira de Pera (Milonga Tango Brujo, last Sundays): OSM way at Rua Alves Torgo 37.
    {
      names: ["Casa do Concelho de Castanheira de Pera", "Casa do Concelho de Castanheira de Pêra"],
      address: "Rua Alves Torgo 37, 1000-034 Lisboa",
      areas: ["Lisbon"],
      point: { lat: 38.7333704, lng: -9.1356343 },
    },
    // Teatro A Barraca, Santos (Milonga d'A Barraca, every Sunday, in its bar): OSM theatre way at Largo de
    // Santos 2, postcode 1200-808 (Overpass, 2026-10-30).
    {
      names: ["Teatro A Barraca", "A Barraca", "Bar A Barraca"],
      address: "Largo de Santos 2, 1200-808 Lisboa",
      areas: ["Lisbon", "Estrela"],
      point: { lat: 38.7071812, lng: -9.1552356 },
    },
    // Casa do Concelho de Tomar, Alvalade (Milonga A Todo Tango! Delux, 2nd Saturdays; TangoLX writes R. Flores do
    // Lima 8, 1700-196): OSM community centre way at Rua Flores de Lima 8A, 1700-196 (Overpass, 2026-10-30).
    {
      names: ["Casa do Concelho de Tomar"],
      address: "Rua Flores do Lima 8A, 1700-196 Lisboa",
      areas: ["Lisbon", "Alvalade"],
      point: { lat: 38.7481331, lng: -9.1452826 },
    },
    // Galeria Antecâmara, Arroios (TangoLX's Fusion Dance Party, 1st Saturdays): TangoLX's list of regular milongas
    // gives "Galeria Antecâmara - Rua de Cabo Verde 17A" (tangolx.com/milongas-1, 2026-10-30). The geocoder refused
    // the address (confidence 0.5, run 41125544576), so the point is the pin of TangoLX's own map link (Google Maps
    // place "Galeria Antecâmara - Galeria e Rádio"); postcode 1170-203 from Geoapify's building match (2026-10-30).
    {
      names: ["Galeria Antecâmara", "Galeria Antecamara", "Antecâmara"],
      address: "Rua de Cabo Verde 17A, 1170-203 Lisboa",
      areas: ["Lisbon", "Arroios"],
      point: { lat: 38.7255264, lng: -9.1322614 },
    },
    // Bombeiros Voluntários de Vila Franca de Xira (Matinés Dançantes, Sunday afternoons): the council's agenda names
    // the "Associação Humanitária dos Bombeiros Voluntários de Vila Franca de Xira" (agenda.cm-vfxira.pt, 2026-10-30).
    // Point: OSM way 310083963, on Avenida dos Bombeiros Voluntários, 2600-098 (Overpass, 2026-10-30).
    {
      names: [
        "Associação Humanitária dos Bombeiros Voluntários de Vila Franca de Xira",
        "Bombeiros Voluntários de Vila Franca de Xira",
      ],
      address: "Avenida dos Bombeiros Voluntários, 2600-098 Vila Franca de Xira",
      areas: ["Vila Franca de Xira"],
      point: { lat: 38.9594216, lng: -8.9866492 },
    },
    // Casa amarela, Laranjeiro (Almada): Bachata Lisboa's Friday socials. The Meetup feed's description gives "Estrada
    // dos Álamos 402, 2810-144 Almada"; the point is the organiser's Meetup venue record (venue 27996720, 2026-10-30).
    // where-to-dance-salsa writes "Casa Amarela (Estrada dos Alamos) or Dance Factory Studios" with a point 401 m off.
    {
      names: ["Casa amarela", "Casa Amarela (Estrada dos Alamos) or Dance Factory Studios"],
      address: "Estrada dos Álamos 402, 2810-144 Almada",
      areas: ["Almada", "Laranjeiro"],
      point: { lat: 38.650864, lng: -9.151569 },
    },
    // Pensão Amor, Cais do Sodré (RA "João Melgueira ~ at Pensão Amor", 2026-11-02, had no location; RA names the
    // venue "TBA - Pensão Amor"): OSM node
    // 3155744757 "Pensão Amor", Rua do Alecrim 19, 1200-292 (Nominatim, 2026-10-31).
    {
      names: ["Pensão Amor", "Pensao Amor", "TBA - Pensão Amor", "TBA - Pensao Amor"],
      address: "Rua do Alecrim 19, 1200-292 Lisboa",
      areas: ["Lisbon", "Cais do Sodré"],
      point: { lat: 38.7072647, lng: -9.1437283 },
    },
    // Arroz Estúdios, Beato: RA nights there were dropped as "not in Lisbon (the listing gives Arroz Estúdios)" and
    // the geocoder called "Av. Infante Dom Henrique, Armazens 8 e 9" too vague (read 41180678144). OSM way
    // 1432087006 "Estudio Arroz", Avenida Infante Dom Henrique, 1900-320 (Nominatim, 2026-10-31).
    {
      names: ["Arroz Estúdios", "Arroz Estudios", "Estúdio Arroz", "Estudio Arroz"],
      address: "Avenida Infante Dom Henrique, Armazéns 8 e 9, 1900-320 Lisboa",
      areas: ["Lisbon", "Beato"],
      point: { lat: 38.7262043, lng: -9.1108663 },
    },
  ],
  barcelona: [
    // Sala Vivaldi, Sant Antoni: dinner, live music and the Tuesday/Thursday "Salsa vs Bachata" socials. Ticket
    // listings (taquilla.com) and the Ajuntament's agenda give Carrer de Llança 5, 08015 (2026-10-29). The Meetup
    // event page writes "C/ de Llança, 5, Barcelona" with no postcode, hence the street phrases.
    {
      names: ["Sala Vivaldi", "Vivaldi"],
      address: "Carrer de Llança 5, 08015 Barcelona",
      streets: ["Llança, 5", "Llança 5"],
    },
    // Antilla Salsa: Salsa Vida's event pages give Carrer d'Alcolea 100, Sants-Montjuïc, 08014 (2026-10-29); older
    // listings still give its former Carrer d'Aragó address.
    // Point: OSM Nominatim, Carrer d'Alcolea 98-102 (2026-10-29); the geocoder answered 0.5.
    {
      names: [
        "Antilla Salsa Barcelona",
        "Antilla Salsa",
        "Antilla BCN",
        "Antilla BCN Latin Club",
        "Antilla",
      ],
      address: "Carrer d'Alcolea 100, 08014 Barcelona",
      point: { lat: 41.3798, lng: 2.13523 },
    },
    // El Sabor Cubano, Gràcia: Salsa Vida's "Latin Nights at El Sabor Cubano" gives Calle Francisco Giner 32,
    // 08012 (2026-10-29).
    // Meetup's event pages write "El Sabor", "Carrer de Francisco Giner, 32" (2026-10-29).
    {
      names: [
        "El Sabor Cubano",
        "Sabor Cubano",
        "Sabor Cubano de Gracia",
        "El Sabor Cubano Barcelona",
        "El Sabor",
      ],
      address: "Carrer de Francisco Giner 32, 08012 Barcelona",
      streets: ["Francisco Giner, 32", "Francisco Giner 32"],
    },
    // Moog, Raval: techno club; its own site gives Arc del Teatre 3 (2026-10-29). Its feed has no LOCATION.
    {
      names: ["Moog", "Moog Barcelona", "Moog Club"],
      address: "Carrer de l'Arc del Teatre 3, 08002 Barcelona",
    },
    // Sala Upload, inside the Poble Espanyol: the city agenda, Fever and Songkick give Av. Francesc Ferrer i
    // Guàrdia 13, 08038 (2026-10-29). DICE writes the name alone, which geocodes elsewhere.
    // Point: OSM Nominatim's "Sala Upload, 13, Avinguda de Francesc Ferrer i Guàrdia" (2026-10-29).
    {
      names: [
        "Sala Upload",
        "Upload",
        "Upload Barcelona",
        "Sala Upload Poble Espanyol",
        "Upload Club",
      ],
      address: "Avinguda de Francesc Ferrer i Guàrdia 13, 08038 Barcelona",
      point: { lat: 41.3683, lng: 2.14711 },
    },
    // Sala Paral·lel 62: DICE's venue page and taquilla.com give Av. del Paral·lel 62, 08001 (2026-10-29).
    {
      names: ["Paral·lel 62", "Sala Paral·lel 62", "Parallel 62", "Sala Parallel 62"],
      address: "Avinguda del Paral·lel 62, 08001 Barcelona",
    },
    // Village Underground Barcelona, L'Hospitalet de Llobregat: club nights in the Districte Cultural. taquilla.com
    // and Songkick give Carrer del Cobalt 12, 08907 (2026-10-31). DICE writes the name alone, which does not geocode.
    // Point: OSM Nominatim's 08907 stretch of Carrer del Cobalt (2026-10-31); RA's own point is 0,0 and the address
    // did not geocode (read 41157714394).
    {
      names: ["Village Underground Barcelona", "Village Underground BCN", "Village Underground"],
      address: "Carrer del Cobalt 12, 08907 L'Hospitalet de Llobregat",
      point: { lat: 41.35916, lng: 2.11089 },
    },
    // Ocaña, Plaça Reial: Time Out gives Plaça Reial 13-15, 08002 (2026-10-29).
    {
      names: ["Ocaña", "Ocana", "Ocaña Barcelona", "Ocanya"],
      address: "Plaça Reial 13-15, 08002 Barcelona",
    },
    // Four Corners, the restaurant of The Hoxton, Poblenou: the hotel's site gives Avinguda Diagonal 205, 08018
    // (2026-10-29).
    {
      names: [
        "Four Corners",
        "Four Corners Poblenou",
        "The Hoxton, Poblenou",
        "The Hoxton Poblenou",
        "Hoxton Poblenou",
      ],
      address: "Avinguda Diagonal 205, 08018 Barcelona",
    },
    // Mojito Club, Eixample: Latin and reggaeton nights, Fri/Sat 23:00-05:30 per Time Out, Trip.com and
    // YouBarcelona; its last dated listing is Aug 2026 and its event page redirects (2026-10-29). Hidden until
    // it is confirmed open (D-362).
    {
      names: ["Mojito Club", "Mojito BCN", "Mojito Barcelona"],
      address: "Carrer del Rosselló 217, 08008 Barcelona",
      streets: ["Rosselló 217", "Rosselló, 217"],
      closed:
        "not confirmed open: Time Out, Trip.com, YouBarcelona; last dated listing Aug 2026 (2026-10-29)",
    },
    // Shôko, Port Olímpic: its own site gives Passeig Marítim de la Barceloneta 36, 08005 (2026-11-01). The address
    // geocodes at confidence 0.5 and was refused (read 41284857494). Point: OSM Nominatim's Shôko node (2026-11-01).
    {
      names: ["Shôko", "Shoko", "Shôko Barcelona", "Shoko Barcelona"],
      address: "Passeig Marítim de la Barceloneta 36, 08005 Barcelona",
      point: { lat: 41.3855, lng: 2.19697 },
    },
    // Plaça d'Orfila, Sant Andreu: outdoor swing ballades. bcnswing.org's JSON-LD writes "Plaça Orfila", "Plaça
    // d'Orfila Barcelona 08030" (2026-11-01). Point: OSM Nominatim's "Plaça d'Orfila, Sant Andreu" (2026-11-01).
    {
      names: ["Plaça Orfila", "Plaça d'Orfila", "Placa Orfila", "Plaça d'Orfila de Sant Andreu"],
      address: "Plaça d'Orfila, 08030 Barcelona",
      point: { lat: 41.436, lng: 2.19103 },
    },
    // Swing Cats (Barcelona SwingCats), Gràcia: swing school with the weekly La Gràcia Swing Jam. bcnswing.org writes
    // "Torrijos, 70 Barcelona 08024", a wrong postcode (OSM: 08012). Point: OSM Nominatim's "Swing Cats, 70, Carrer
    // de Torrijos" (2026-11-01).
    {
      names: [
        "Barcelona SwingCats",
        "SwingCats",
        "Swing Cats",
        "Swing Cats Barcelona",
        "Barcelona Swing Cats",
      ],
      address: "Carrer de Torrijos 70, 08012 Barcelona",
      streets: ["Torrijos"],
      point: { lat: 41.40461, lng: 2.15772 },
    },
    // Swing Maniacs, Camp d'en Grassot: the jams source's seed address is Carrer de Roger de Flor 291, 08025;
    // bcnswing.org writes "carrer Roger de Flor 293 Barcelona 08025" (2026-11-01). Point: OSM Nominatim's
    // "291,293, Carrer de Roger de Flor" (2026-11-01).
    {
      names: ["Swing Maniacs", "Swing Maniacs Barcelona"],
      address: "Carrer de Roger de Flor 291, 08025 Barcelona",
      streets: ["Roger de Flor"],
      point: { lat: 41.40457, lng: 2.16481 },
    },
    // La Deskomunal, Sants: the source seed's address is its night entrance, Carrer de la Riera d'Escuder 38, 08028;
    // bcnswing.org writes "carrer d'en Blanco i Tenor Masini Barcelona 08028" (2026-11-01). Point: OSM Nominatim's
    // "La Deskomvnal, 5, Carrer del Tenor Masini" (2026-11-01).
    {
      names: ["La Deskomunal", "Deskomunal", "La Deskomvnal"],
      address: "Carrer de la Riera d'Escuder 38, 08028 Barcelona",
      point: { lat: 41.37592, lng: 2.13235 },
    },
    // Gaby's Club, Gràcia: Saturday salsa and bachata workshop + social. Meetup's event pages give Carrer de
    // Topazi 24 (one writes "Calle Topazi 24, 1.1" with only "08012" as the address). Point: OSM Nominatim
    // (2026-10-29).
    {
      names: ["Gaby's Club", "Gabys Club", "Gaby's Club Barcelona"],
      address: "Carrer de Topazi 24, 08012 Barcelona",
      streets: ["Topazi 24", "Topazi, 24"],
      point: { lat: 41.40506, lng: 2.15482 },
    },
    // El Galpón, Bon Pastor: Milonga del Galpón (Agenda del Tango gives "El Galpón, Passeig de Enric Sanchis 44").
    // Point: OSM Nominatim has the street only (Passeig d'Enric Sanchis, 08030), not the building (2026-10-29).
    {
      names: ["El Galpón", "El Galpon", "El Galpón Barcelona"],
      address: "Passeig de Enric Sanchis 44, 08030 Barcelona",
      streets: ["Enric Sanchis 44", "Enric Sanchis, 44"],
      point: { lat: 41.43583, lng: 2.20467 },
    },
    // La Tanguería, Poblenou: Wednesday milonga at C/ Pallars 74 (Agenda del Tango, 2026-10-29). Point: OSM
    // Nominatim, house 74 (2026-10-29). Agenda del Tango writes "C/ Pallars, 74 Barcelona" (parsePlace, #546).
    {
      names: ["La Tanguería", "La Tangueria"],
      address: "Carrer de Pallars 74, 08018 Barcelona",
      streets: ["Pallars, 74", "Pallars 74"],
      point: { lat: 41.39425, lng: 2.18852 },
    },
    // Glorieta de la Transsexual Sònia, Parc de la Ciutadella: Milonga de la Glorieta (Agenda del Tango writes
    // "Pérgola de la Transsexual Sonia"). Point: OSM Nominatim's shelter (2026-10-29).
    {
      names: [
        "Pérgola de la Transsexual Sonia",
        "Pérgola de la Transsexual Sonia (Barcelona)",
        "Glorieta de la Transsexual Sònia",
        "Glorieta de la Transsexual Sonia",
      ],
      address: "Plaça de Sonia Rescalvo Zafra, Parc de la Ciutadella, 08003 Barcelona",
      point: { lat: 41.38914, lng: 2.18608 },
    },
    // Parc de la Ciutadella: outdoor milongas (Agenda del Tango writes "Parque de la Ciutadella (Barcelona)").
    // Point: OSM Nominatim's park (2026-10-29).
    {
      names: [
        "Parque de la Ciutadella",
        "Parque de la Ciutadella (Barcelona)",
        "Parc de la Ciutadella",
        "Parc de la Ciutadella (Barcelona)",
      ],
      address: "Parc de la Ciutadella, 08003 Barcelona",
      point: { lat: 41.38842, lng: 2.18625 },
    },
    // W Barcelona hotel (its Eclipse bar hosts club nights), Barceloneta: Plaça de la Rosa dels Vents 1, 08039.
    // Sources write "W Hotel", which the geocoder placed at 0.13. Point: OSM Nominatim (2026-10-29).
    // DICE writes "26th floor W Barcelona" and "W Hotels Worldwide, Plaça Rosa Del Vents, 1" (run 40955847160).
    {
      names: [
        "W Barcelona",
        "W Hotel",
        "W Hotel Barcelona",
        "Hotel W Barcelona",
        "Eclipse Bar",
        "26th floor W Barcelona",
        "W Hotels Worldwide",
      ],
      address: "Plaça de la Rosa dels Vents 1, 08039 Barcelona",
      streets: ["Rosa Del Vents, 1", "Rosa Del Vents 1", "Rosa dels Vents, 1", "Rosa dels Vents 1"],
      point: { lat: 41.36879, lng: 2.19005 },
    },
    // Pla de la Seu, the square in front of the Cathedral (Gòtic): weekend sardana dances. SomSardana writes
    // "Pla de la Catedral - BARCELONA" (2026-10-30). Point: OSM Nominatim's "Pla de la Seu" (2026-10-30).
    {
      names: [
        "Pla de la Catedral",
        "Pla de la Catedral - BARCELONA",
        "Pla de la Seu",
        "Avinguda de la Catedral",
        "Plaça de la Seu",
      ],
      address: "Pla de la Seu, 08002 Barcelona",
      streets: ["Pla de la Catedral", "Pla de la Seu"],
      point: { lat: 41.38435, lng: 2.17607 },
    },
    // Club Sauvage, Plaça Reial 7 (Gòtic): Fever writes the club as "Club Sauvage", "Plaza Real, 7, 08002"
    // (feverup.com/m/601741, 2026-10-30). Point: Fever's own place data (2026-10-30).
    {
      names: ["Club Sauvage", "Sauvage", "Sauvage Club", "Sauvage Barcelona"],
      address: "Plaça Reial 7, 08002 Barcelona",
      streets: ["Plaza Real, 7", "Plaza Real 7", "Plaça Reial, 7", "Plaça Reial 7"],
      point: { lat: 41.38051, lng: 2.17527 },
    },
    // Safestay Passeig de Gràcia, Eixample: hostel rooftop with day and sunset parties. RA gives Pg. de Gràcia 33, 08007
    // with the placeholder point 41, 2 (read 41157714394). Point: OSM Nominatim's "Safestay Passeig de Gracia
    // Barcelona, 33, Passeig de Gràcia" (2026-10-31).
    {
      names: [
        "Safestay Rooftop",
        "Safestay Barcelona",
        "Safestay Passeig de Gracia",
        "Safestay",
        "Hotel Safestay",
      ],
      address: "Passeig de Gràcia 33, 08007 Barcelona",
      point: { lat: 41.39094, lng: 2.16579 },
    },
    // Puerto Bahía, Badalona beach (Platja de la Marina): RA gives "Puerto Bahia Club de Mar", Passeig del Mare
    // Nostrum 61, 08918 Badalona, with the placeholder point 41, 2 (read 41157714394). Point: OSM Nominatim's
    // "Puerto Bahía, Platja de La Marina, Badalona" (2026-10-31).
    {
      names: [
        "Puerto Bahia Club de Mar",
        "Puerto Bahía Club de Mar",
        "Puerto Bahia",
        "Puerto Bahía",
      ],
      address: "Passeig del Mare Nostrum 61, 08918 Badalona",
      point: { lat: 41.43228, lng: 2.24052 },
    },
  ],
  "buenos-aires": [
    // Club Gricel, San Cristóbal: milongas and socials from its own weekly grid (D-402); address from its own
    // site, whose footer writes "La Rioja 1180 - Città di Buenos Aires" (full read of 2026-10-29: 26/26 unplaced).
    // Point: OSM node "Club Gricel, 1180, La Rioja, San Cristóbal" (Nominatim, 2026-10-29).
    {
      names: ["Club Gricel", "Gricel"],
      address: "La Rioja 1180, San Cristóbal, CABA",
      streets: ["La Rioja 1180"],
      point: { lat: -34.6238507, lng: -58.4070502 },
    },
    // El Beso, Balvanera: Cachirulo and the salon's other milongas; address from its own site (4/4 unplaced).
    // Point: OSM "El Beso Club, 416, Riobamba, Balvanera" (Nominatim, 2026-10-29).
    {
      names: ["El Beso", "El Beso Tango", "Cachirulo"],
      address: "Riobamba 416, Balvanera, CABA",
      streets: ["Riobamba 416"],
      point: { lat: -34.6041407, lng: -58.39399 },
    },
    // "Buenos Aires" in the address: Crobar's JSON-LD writes only "Buenos Aires, AR" (town-only rule, 2026-10-29).
    // Crobar, Palermo: club in the Paseo de la Infanta, no street number on its own site (1/3 unplaced on
    // crobar.com.ar, full read of 2026-10-29). Point: OSM nightclub "Crobar, Avenida Coronel Marcelino E. Freyre"
    // (Nominatim, 2026-10-29).
    {
      names: ["Crobar", "Crobar Buenos Aires", "Crobar Studio"],
      address: "Av. Marcelino Freyre s/n, Paseo de la Infanta, Palermo, Buenos Aires",
      point: { lat: -34.5692392, lng: -58.420215 },
      // RA's "Crobar - Buenos Aires" and the club's own "Crobar" were two venue rows (weekly review 2026-11-23, D-889).
      canonical: true,
    },
    // Espacio Riobamba: Champagne Tango Club, Perteño Y Bailarín (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "345, Riobamba, Balvanera" (Nominatim, 2026-10-30).
    {
      names: ["Espacio Riobamba", "Espacio Riobamba 345"],
      address: "Riobamba 345, Balvanera, CABA",
      streets: ["Riobamba 345"],
      point: { lat: -34.6052002, lng: -58.3936968 },
    },
    // Club Villa Malcolm: El Motivo Tango, Milonga La Chiflada, Zorzal Tango (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM leisure "Club Social y Deportivo Villa Malcom, 5064, Avenida Córdoba, Palermo" (Nominatim, 2026-10-30).
    {
      names: ["Club Villa Malcolm"],
      address: "Av. Cordoba 5064, Villa Crespo, CABA",
      streets: ["Av. Cordoba 5064", "Av. Córdoba 5064"],
      point: { lat: -34.5911109, lng: -58.4350889 },
    },
    // La Comedia Tango: A Media Luz Milonga, El Chamuyo Buenos Aires Milonga, Muy Lunes Tango (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM leisure "1074, Rodríguez Peña, Recoleta" (Nominatim, 2026-10-30).
    {
      names: ["La Comedia Tango"],
      address: "Rodriguez Peña 1074, Recoleta, CABA",
      streets: ["Rodriguez Peña 1074"],
      point: { lat: -34.5963557, lng: -58.3920227 },
    },
    // Casa De Galicia: Che Che Espacio Tango, Nuevo Chique (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "224, San José, Monserrat" (Nominatim, 2026-10-30).
    {
      names: ["Casa De Galicia"],
      address: "San Jose 224, Montserrat, CABA",
      streets: ["San Jose 224"],
      point: { lat: -34.6113737, lng: -58.3861035 },
    },
    // Centro Cultural Macedonia: Tangotica (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM amenity "Centro Cultural Macedonia, 3632, Sarmiento, Almagro" (Nominatim, 2026-10-30).
    {
      names: ["Centro Cultural Macedonia"],
      address: "Sarmiento 3632, Almagro, CABA",
      streets: ["Sarmiento 3632"],
      point: { lat: -34.6057821, lng: -58.4165505 },
    },
    // Espacio Antiguas Lunas: Gato Negro (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "2848, Blanco Encalada, Belgrano" (Nominatim, 2026-10-30).
    {
      names: ["Espacio Antiguas Lunas"],
      address: "Blanco Encalada 2848, Belgrano, CABA",
      streets: ["Blanco Encalada 2848"],
      point: { lat: -34.5616904, lng: -58.4631484 },
    },
    // La Paz Arriba: Muy Martes Tango (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM address "1082, Avenida Callao, Recoleta" (Nominatim, 2026-10-30).
    {
      names: ["La Paz Arriba"],
      address: "Av. Callao 1082, Recoleta, CABA",
      streets: ["Av. Callao 1082"],
      point: { lat: -34.5962319, lng: -58.3934408 },
    },
    // Cc El Pasaje De La Luna: La Yuyú Milonga Informal, Maniática Milonga (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM amenity "El Pasaje De La Luna / Luna Porteña (Cooperativa Cultural Gastronómica), 365, San Lorenzo, San Telmo" (Nominatim, 2026-10-30).
    {
      names: ["Cc El Pasaje De La Luna", "El Pasaje De La Luna"],
      address: "Pje. San Lorenzo 365, San Telmo, CABA",
      streets: ["Pje. San Lorenzo 365"],
      point: { lat: -34.616585, lng: -58.3710948 },
    },
    // Sigue La Polilla: Rio De Tango (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "74, Avenida Castro Barros, Almagro" (Nominatim, 2026-10-30).
    {
      names: ["Sigue La Polilla"],
      address: "Castro Barros 74, Almagro, CABA",
      streets: ["Castro Barros 74"],
      point: { lat: -34.6126715, lng: -58.4206365 },
    },
    // Salón Marabú: El Milongón, Milonga Malena, Milonga Parakultural (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM leisure "Salón Marabú, 365, Maipú, San Nicolás" (Nominatim, 2026-10-30).
    {
      names: ["Salón Marabú", "Salon Marabú"],
      address: "Maipú 365, San Nicolas, CABA",
      streets: ["Maipú 365"],
      point: { lat: -34.6038945, lng: -58.3765795 },
    },
    // Lo De Celia: Barajando, Milonga Remembranzas (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM leisure "Barajando, 1783, Humberto I, Constitución" (Nominatim, 2026-10-30).
    {
      names: ["Lo De Celia"],
      address: "Humberto 1° 1783, Constitución, CABA",
      streets: ["Humberto 1° 1783"],
      point: { lat: -34.6214378, lng: -58.3912831 },
    },
    // Libario Espacio Cultural: La Cachivachería Milonga (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "1315, Julián Baltasar Álvarez, Palermo" (Nominatim, 2026-10-30).
    {
      names: ["Libario Espacio Cultural"],
      address: "Julián Álvarez 1315, Palermo, CABA",
      streets: ["Julián Álvarez 1315"],
      point: { lat: -34.5941567, lng: -58.425944 },
    },
    // El Zorzal Esquina Cultural: El Vermú, Tango Bar (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "3002, Zelaya, Balvanera" (Nominatim, 2026-10-30).
    {
      names: ["El Zorzal Esquina Cultural"],
      address: "Zelaya 3002, Balvanera, CABA",
      streets: ["Zelaya 3002"],
      point: { lat: -34.6020396, lng: -58.4083312 },
    },
    // Teatro El Mandril: La Mandrilera Milonga (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "2758, Humberto I, San Cristóbal" (Nominatim, 2026-10-30).
    {
      names: ["Teatro El Mandril"],
      address: "Humberto 1° 2758, San Cristobal, CABA",
      streets: ["Humberto 1° 2758"],
      point: { lat: -34.622653, lng: -58.4035511 },
    },
    // Agrupación Folklorica Nativa El Pial: El Pial, La Baldosa (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM address "2750, Coronel Ramón Lorenzo Falcón, Flores" (Nominatim, 2026-10-30).
    {
      names: ["Agrupación Folklorica Nativa El Pial", "El Pial"],
      address: "Cnel. Ramón L. Falcon 2750, Flores, CABA",
      streets: ["Cnel. Ramón L. Falcon 2750", "Cnel. Ramón L. Falcón 2750"],
      point: { lat: -34.6316033, lng: -58.4670466 },
    },
    // Rincón Familiar Andaluz: De Querusa (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "3745, Carlos Calvo, Boedo" (Nominatim, 2026-10-30).
    {
      names: ["Rincón Familiar Andaluz"],
      address: "Carlos Calvo 3745, Boedo, CABA",
      streets: ["Carlos Calvo 3745"],
      point: { lat: -34.6244611, lng: -58.4183859 },
    },
    // La Maleva Estudio: El Garaje (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "3428, Tucumán, Almagro" (Nominatim, 2026-10-30).
    {
      names: ["La Maleva Estudio"],
      address: "Tucumán 3428, San Nicolás, CABA",
      streets: ["Tucumán 3428"],
      point: { lat: -34.5999552, lng: -58.4141453 },
    },
    // Complejo Belgrano: La Previa De Los Jueves (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "2608, Avenida Belgrano, Balvanera" (Nominatim, 2026-10-30).
    {
      names: ["Complejo Belgrano"],
      address: "Av. Belgrano 2608, Balvanera, CABA",
      streets: ["Av. Belgrano 2608"],
      point: { lat: -34.6146558, lng: -58.4032419 },
    },
    // Atroden Club: Maldita Milonga (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM amenity "Maldita Milonga, 571, Perú, Monserrat" (Nominatim, 2026-10-30).
    {
      names: ["Atroden Club"],
      address: "Perú 571, Montserrat, CABA",
      streets: ["Perú 571"],
      point: { lat: -34.6147015, lng: -58.3746945 },
    },
    // La Nacional: Milonga En Lo De Balmaceda (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "1465, Adolfo Alsina, Monserrat" (Nominatim, 2026-10-30).
    {
      names: ["La Nacional"],
      address: "Adolfo Alsina 1465, Montserrat, CABA",
      streets: ["Adolfo Alsina 1465"],
      point: { lat: -34.6110985, lng: -58.3870164 },
    },
    // Escuela Mundial De Tango: La Previa De Los Viernes (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM amenity "Mais Brazucas, 656, Florida, San Nicolás" (Nominatim, 2026-10-30).
    {
      names: ["Escuela Mundial De Tango"],
      address: "Florida 656, San Nicolas, CABA",
      streets: ["Florida 656"],
      point: { lat: -34.6005115, lng: -58.3753718 },
    },
    // Bar Notable Los Laureles: Milonga De Los Viernes, Milonga Esquina Arrabal (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM amenity "Bar Los Laureles, 2290, Avenida General Iriarte, Barracas" (Nominatim, 2026-10-30).
    {
      names: ["Bar Notable Los Laureles", "Los Laureles Bar Notable"],
      address: "Av. Gral T. De Iriarte 2290, Barracas, CABA",
      streets: ["Av. Gral T. De Iriarte 2290", "Av. Iriarte 2290"],
      point: { lat: -34.6495516, lng: -58.3794547 },
    },
    // Asociación Vecinal Saavedra Y Biblioteca 25 De Mayo: Floreal Milonga (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "4221, Avenida Doctor Ricardo Balbín, Saavedra" (Nominatim, 2026-10-30).
    {
      names: ["Asociación Vecinal Saavedra Y Biblioteca 25 De Mayo"],
      address: "Av. Balbín 4221, Saavedra, CABA",
      streets: ["Av. Balbín 4221"],
      point: { lat: -34.5549532, lng: -58.4908801 },
    },
    // Centro Cultura Waki Toki: Bilongon (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "905, Tacuarí, Constitución" (Nominatim, 2026-10-30).
    {
      names: ["Centro Cultura Waki Toki"],
      address: "Tacuari 905, Barracas, CABA",
      streets: ["Tacuari 905"],
      point: { lat: -34.6186258, lng: -58.3788065 },
    },
    // La Tierra Invisible Espacio Cultural: Milonga Cañon (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "1099, Del Barco Centenera, Parque Chacabuco" (Nominatim, 2026-10-30).
    {
      names: ["La Tierra Invisible Espacio Cultural"],
      address: "Del Barco Centenera 1099, Parque Chacabuco, CABA",
      streets: ["Del Barco Centenera 1099"],
      point: { lat: -34.632073, lng: -58.437553 },
    },
    // Unione E Benevolenza: Milonga La Discépolo (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "1362, Teniente General Juan Domingo Perón, San Nicolás" (Nominatim, 2026-10-30).
    {
      names: ["Unione E Benevolenza"],
      address: "Gral. J. D. Perón 1362, San Nicolás, CABA",
      streets: ["Gral. J. D. Perón 1362"],
      point: { lat: -34.6064474, lng: -58.3858562 },
    },
    // Salón Canning: Milonga De Buenos Aires &amp; Obelisco Tango (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM amenity "Salon Canning, 1331, Avenida Raúl Scalabrini Ortiz, Palermo" (Nominatim, 2026-10-30).
    {
      names: ["Salón Canning"],
      address: "Av. Scalabrini Ortiz 1331, Balvanera, CABA",
      streets: ["Av. Scalabrini Ortiz 1331"],
      point: { lat: -34.5928942, lng: -58.4274896 },
    },
    // Asociación Genovesa Carboneros Unidos: Zonatango (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "2941, Venezuela, Balvanera" (Nominatim, 2026-10-30).
    {
      names: ["Asociación Genovesa Carboneros Unidos"],
      address: "Venezuela 2941, Balvanera, CABA",
      streets: ["Venezuela 2941"],
      point: { lat: -34.6163551, lng: -58.4074744 },
    },
    // Club Fulgor: Si Sos Brujo (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM leisure "Club Fulgor, 828, Loyola, Villa Crespo" (Nominatim, 2026-10-30).
    {
      names: ["Club Fulgor"],
      address: "Loyola 828, Villa Crespo, CABA",
      streets: ["Loyola 828"],
      point: { lat: -34.5933957, lng: -58.4380657 },
    },
    // Social, Cultural Y Deportivo Flores Club: Milonga Gente Amiga (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "947, Quirno, Flores" (Nominatim, 2026-10-30).
    {
      names: ["Social, Cultural Y Deportivo Flores Club"],
      address: "Quirno 947, Flores, CABA",
      streets: ["Quirno 947"],
      point: { lat: -34.6426034, lng: -58.4642228 },
    },
    // Parque De La Ciudad: Milonga Techos Azules (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM park "Parque de la Ciudad, Villa Soldati" (the register gives the park's avenue address) (Nominatim, 2026-10-30).
    {
      names: ["Parque De La Ciudad"],
      address: "Av. Fernández De La Cruz 4000, Villa Soldati, CABA",
      streets: ["Av. Fernández De La Cruz 4000"],
      point: { lat: -34.6714146, lng: -58.4503187 },
    },
    // Salón Tuy Salceda: Milonga Sueño Porteño (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "457, Maza, Almagro" (Nominatim, 2026-10-30).
    {
      names: ["Salón Tuy Salceda"],
      address: "Maza 457, Almagro, CABA",
      streets: ["Maza 457"],
      point: { lat: -34.6165613, lng: -58.4157315 },
    },
    // Parque De La Estación: Los Sensibleros (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "3326, Teniente General Juan Domingo Perón, Balvanera" (Nominatim, 2026-10-30).
    {
      names: ["Parque De La Estación"],
      address: "Gral. J. D. Perón 3326, Balvanera, CABA",
      streets: ["Gral. J. D. Perón 3326"],
      point: { lat: -34.6075646, lng: -58.4133878 },
    },
    // La Fragua: Alsina Tango Club (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "4127, Avenida Rivadavia, Almagro" (Nominatim, 2026-10-30).
    {
      names: ["La Fragua"],
      address: "Av. Rivadavia 4127, Almagro, CABA",
      streets: ["Av. Rivadavia 4127"],
      point: { lat: -34.6126597, lng: -58.4240447 },
    },
    // Asociacion Helenica De Socorros Mutuos: Milonga Gente Amiga (Mapa Milonguero 2026, D-403;
    // unplaced in the full read of 2026-10-30). Point: OSM place "1339, Avenida Raúl Scalabrini Ortiz, Palermo" (Nominatim, 2026-10-30).
    {
      names: ["Asociacion Helenica De Socorros Mutuos"],
      address: "Av. Scalabrini Ortiz 1339, Palermo, CABA",
      streets: ["Av. Scalabrini Ortiz 1339"],
      point: { lat: -34.5927285, lng: -58.4274714 },
    },
    // La Salsera, Almagro: dancetomic names the venue by its address ("Yatay 961 ..."), salsavida as "La Salsera",
    // 15 m apart on two venue records, so one night stood twice (daily check 11-05, D-750).
    // Point: OSM node "La salsera", nightclub, 961 Yatay, Almagro, 1185 (Nominatim, 2026-11-05).
    {
      names: ["La Salsera", "Yatay 961"],
      address: "Yatay 961, Almagro, CABA",
      streets: ["Yatay 961"],
      point: { lat: -34.6003746, lng: -58.4281625 },
      canonical: true,
    },
    // La Práctica Folklórica, Nueva Pompeya: circuitopeñero writes "AV. SAENZ 459", which was geocoded to
    // Villa Crespo (-34.591,-58.435), 6 km off; ritmolibre had it right (daily check 11-05, D-750).
    // Point: OSM house 459, Avenida Sáenz, Nueva Pompeya, C1437 (Nominatim, 2026-11-05).
    {
      names: ["La Práctica Folklórica", "Peña Bailable La Práctica Folklórica"],
      address: "Av. Sáenz 459, Nueva Pompeya, CABA",
      streets: ["Sáenz 459", "Saenz 459"],
      point: { lat: -34.6448215, lng: -58.4162995 },
      canonical: true,
    },
  ],
  "hong-kong": [
    // Each address below is the source's own string, so the hand-checked point is used (the geocoder refused all
    // three on run 41172032324, 2026-10-31; their rows were "Location not listed").
    // Casual, Wan Chai: RA venue (7 nights in 14 on 10-31). Point: OSM building 中南大廈 Chung Nam Building,
    // 1 Lockhart Road (photon, 2026-10-31).
    {
      names: ["Casual"],
      address: "3rd Floor, 1 Lockhart Road, Wan Chai, Hong Kong Island",
      point: { lat: 22.2785656, lng: 114.1689344 },
    },
    // The Fringe Club, Central: our Fringe Club source's venue. Point: OSM building 藝穗會 Fringe Club, 2 Lower
    // Albert Road (photon, 2026-10-31).
    {
      names: ["The Fringe Club", "Fringe Club", "藝穗會", "Fringe Dairy"],
      address: "2 Lower Albert Road, Central, Hong Kong",
      streets: ["2 Lower Albert Road"],
      point: { lat: 22.2802533, lng: 114.1557449 },
    },
    // Hong Kong Observation Wheel & AIA Vitality Park, Central: RA venue; RA's own point is in Helsinki (60.17, 24.94).
    // Point: OSM park 香港摩天輪 The Hong Kong Observation Wheel (Nominatim, 2026-10-31).
    {
      names: [
        "Hong Kong Observation Wheel & AIA Vitality Park",
        "AIA Vitality Park",
        "Hong Kong Observation Wheel",
      ],
      address: "33 Man Kwong Street  Central, HKI",
      point: { lat: 22.2853165, lng: 114.1617716 },
    },
  ],
  "mexico-city": [
    // Salón Los Ángeles, Guerrero: dance hall since 1937; address from its own site's footer ("Lerdo 206 | Colonia
    // Guerrero | 06300 | CdMx", 2026-10-29). Point: where-to-dance-salsa's listing, checked by OSM reverse (Calle
    // Lerdo, Guerrero, 06300); its rows were unplaced on run 40951868631.
    {
      names: ["Salón Los Ángeles", "Salon Los Angeles", "Salón Los Angeles"],
      address: "Lerdo 206, Guerrero, 06300 Ciudad de México",
      streets: ["Lerdo 206"],
      point: { lat: 19.450503, lng: -99.141899 },
    },
    // Kartharsis Studio, Roma Norte: the Meetup foreigners-and-expats group's studio. Point from its Meetup venue,
    // checked by OSM reverse (Mérida at Chihuahua, Roma Norte, 06700), 2026-10-29.
    {
      names: ["Kartharsis Studio", "Kartharsis"],
      address: "Calle Mérida 124, Roma Norte, Cuauhtémoc, 06700 Ciudad de México",
      streets: ["Mérida 124"],
      point: { lat: 19.418144, lng: -99.157051 },
    },
    // Departamento (Roma Norte) and Cabaré-Tito Fusión (Zona Rosa): own-site weekly DJ nights (D-446). Points
    // from OSM (each tagged with the venue's name at that house number), 2026-10-30.
    {
      names: ["Departamento", "Departamento Bar"],
      address: "Av. Álvaro Obregón 154, Roma Norte, Cuauhtémoc, 06700 Ciudad de México",
      streets: ["Álvaro Obregón 154"],
      point: { lat: 19.417992, lng: -99.162206 },
    },
    {
      names: ["Cabaré-Tito Fusión", "Cabaretito Fusión", "Fusión"],
      address: "Londres 77, Juárez, Cuauhtémoc, 06600 Ciudad de México",
      streets: ["Londres 77"],
      point: { lat: 19.426572, lng: -99.162028 },
    },
    // La Flor del Son, Roma Norte (D-447): OSM node with its name at Puebla 52, 2026-10-30.
    {
      names: ["La Flor del Son", "La Flor del Son CDMX"],
      address: "Puebla 52, Roma Norte, Cuauhtémoc, 06700 Ciudad de México",
      streets: ["Puebla 52"],
      point: { lat: 19.423495, lng: -99.156844 },
    },
    // Ex Fábrica de Harina (Ex Fábrica MX), Ángel Zimbrón, Azcapotzalco: Pervert's CDMX venue (D-447). Point from
    // its Fever venue page, on OSM's Calle Primavera, 2026-10-30; the geocoder left it unplaced (run 41043406841).
    {
      names: [
        "Ex Fábrica de Harina",
        "Ex Fabrica de Harina",
        "Ex Fábrica MX",
        "Exfábrica de Harinas",
      ],
      address: "Primavera 106, Ángel Zimbrón, Azcapotzalco, 02099 Ciudad de México",
      streets: ["Primavera 106"],
      point: { lat: 19.464177, lng: -99.190468 },
    },
    // Tango México milonga venues the geocoder answers too vaguely (parks "s/n", D-260). Names, streets and
    // postcodes as the agendatangomx calendar writes them; points checked by hand, 2026-10-29.
    // Parque México, Hipódromo: OSM "Foro Lindbergh" (tagged dance), where the milonga is held.
    {
      names: ["Parque México", "Parque Mexico", "Foro Lindbergh"],
      address: "Av. México s/n, Hipódromo, Cuauhtémoc, 06100 Ciudad de México",
      streets: ["Parque México"],
      point: { lat: 19.41186, lng: -99.16981 },
    },
    // Alameda Central, Centro: OSM park centroid (the milonga is at the kiosk).
    {
      names: ["Alameda Central"],
      address: "Av. Hidalgo s/n, Centro, Cuauhtémoc, 06010 Ciudad de México",
      streets: ["Alameda Central"],
      point: { lat: 19.43572, lng: -99.14399 },
    },
    // Parque de los Venados (Parque Francisco Villa), Santa Cruz Atoyac: OSM leisure=park (not the Metro station).
    {
      names: [
        "Parque Francisco Villa (Parque de los Venados)",
        "Parque de los Venados",
        "Parque Francisco Villa",
      ],
      address:
        "Av. División del Norte y Dr. José María Vértiz, Santa Cruz Atoyac, Benito Juárez, 03310 Ciudad de México",
      streets: ["Parque de los Venados"],
      point: { lat: 19.37201, lng: -99.15596 },
    },
    // Asado Argentino, Juárez (El Arrabalero): OSM house number Dinamarca 72.
    {
      names: ["Asado Argentino"],
      address: "C. Dinamarca 72, Juárez, Cuauhtémoc, 06600 Ciudad de México",
      streets: ["Dinamarca 72"],
      point: { lat: 19.42605, lng: -99.15767 },
    },
    // Av. Víctor Hugo 178, Portales Norte (La Baraka, Garufita): Overture place "Chiwas Snacks", Av. Víctor Hugo 178,
    // between Overture's 177 and 172 (OSM has the street only).
    {
      names: ["Av. Víctor Hugo 178"],
      address: "Av. Víctor Hugo 178, Portales Norte, Benito Juárez, 03300 Ciudad de México",
      streets: ["Víctor Hugo 178", "Victor Hugo 178"],
      point: { lat: 19.37089, lng: -99.15212 },
    },
    // Parque de las Arboledas, Del Valle Centro (práctica "Parque Pilares"): OSM "Parque Arboledas", on Heriberto Frías.
    {
      names: ["Parque de Las Arboledas", "Parque Arboledas"],
      address: "Heriberto Frías 921, Del Valle Centro, Benito Juárez, 03100 Ciudad de México",
      streets: ["Heriberto Frías 921", "Parque de Las Arboledas"],
      point: { lat: 19.37826, lng: -99.16236 },
    },
    // Parque Alfonso Esparza Oteo, Nápoles: OSM "Jardín Esparza Oteo" (reverse: Ampliación Nápoles, 03810).
    {
      names: ["Parque Alfonso Esparza Oteo", "Jardín Esparza Oteo"],
      address: "Georgia, Nápoles, Benito Juárez, 03810 Ciudad de México",
      streets: ["Esparza Oteo"],
      point: { lat: 19.38962, lng: -99.1773 },
    },
    // Parque Moderna, Moderna: unnamed OSM park on Juana de Arco beside the Casa de la Cultura Moderna.
    {
      names: ["Parque Moderna"],
      address: "Juana de Arco, Moderna, Benito Juárez, 03510 Ciudad de México",
      streets: ["Parque Moderna"],
      point: { lat: 19.39508, lng: -99.13472 },
    },
  ],
  "rio-de-janeiro": [
    // Bip Bip, Copacabana (Roda do Bip, Thu + Sun; D-510): Mapa do Samba's JSON-LD geo (-22.95151, -43.186297) is
    // about 3 km off, in Botafogo (run 41175159358). Point and CEP from OpenStreetMap's "Bip Bip" pub on Rua
    // Almirante Gonçalves (amenity=pub), checked 2026-10-31 by Rio - 8.
    {
      names: ["Bip Bip"],
      address: "Rua Almirante Gonçalves, 50 - Copacabana, Rio de Janeiro - RJ, 22060-040",
      point: { lat: -22.979849, lng: -43.190506 },
    },
    // Clube dos Democráticos, Lapa (Forró no Clube dos Democráticos, Fri, Busca Dança; Forró do Demo, forrozinho):
    // the geocoder gives "Rua do Riachuelo, 91" only low confidence 0.67, so both were left unplaced (run
    // 41432938076). Address and CEP from Buser's "Clube dos Democráticos do Rio de Janeiro" page (Google place data,
    // 20230-010); Mediamatic writes 20230-013. Point from the same page, about 200 m east of OpenStreetMap's Rua do
    // Riachuelo bike station. Checked 2026-11-02 by Rio - 13. forrozinho gives no venue name, hence the street.
    {
      names: ["Clube dos Democráticos", "Democráticos"],
      address: "Rua do Riachuelo, 91 - Centro, Rio de Janeiro - RJ, 20230-010",
      streets: ["Rua do Riachuelo, 91"],
      point: { lat: -22.9144483, lng: -43.1832826 },
    },
  ],
  "san-juan": [
    // Rincón bar on Avenida Vistamar (Thursday salsa): outside the metro, so its point takes Viajando y Bailando's
    // "Rincón: Dugout Sport Bar" off the San Juan site instead of leaving it unplaced (its page gives only "Rincón,
    // PR"). Address from Platea PR's directory (Av. Vista Mar Suite #9); the point is OpenStreetMap's "Dugout" node
    // on Avenida Vistamar (Photon, 2026-10-31).
    {
      names: ["Dugout Sport Bar", "Dugout Bar & Rest"],
      address: "Av. Vista Mar Suite #9, Rincón, PR 00677",
      point: { lat: 18.3296353, lng: -67.2482977 },
    },
    // Salsa bar on the Marginal of Avenida Kennedy (Thursday live salsa); address from Viajando y Bailando's
    // event page, the building (771 Calle 1, Marginal Kennedy) confirmed by a Justia office listing
    // (2026-10-29). The geocoder refused the source's "771 C. 1, Marginal Kennedy" form. Viajando's RSS gives
    // only that address, no venue name (run 40952179002), hence the street.
    {
      names: ["Dizparate"],
      address: "771 Calle 1, San Juan, PR 00920",
      streets: ["Marginal Kennedy"],
    },
    // Hato Rey restaurant open 24 hours on Avenida Carlos E. Chardon (Friday live salsa); Uber Eats store page
    // and El Nuevo Dia (2026-10-29). Viajando y Bailando writes "9-15 Av. Carlos E. Chardon", with no venue
    // name in its RSS. The geocoder refused this checked address too (run 40956741763), so the point is
    // OpenStreetMap's "24 Market Place" node (Photon, 00918, 2026-10-29).
    {
      names: ["24 Market Place", "24 Marketplace"],
      address: "15 Av. Carlos E. Chardón, San Juan, PR 00918",
      point: { lat: 18.42478, lng: -66.06538 },
      streets: ["Av. Carlos E. Chardón", "Av. Carlos E. Chardon", "Avenida Carlos E. Chardón"],
    },
    // Cupey pizzeria and bar (Thursday free salsa class and live salsa); AAA TripCanvas listing (54 Av. Parana,
    // 00926) and En Mi Patio's event page, matching Viajando y Bailando's "#54 Ave. Parana" (2026-10-29). The
    // geocoder refused the source's form on run 40947386186. The point is En Mi Patio's map pin for the venue,
    // on OpenStreetMap's Avenida Parana (El Paraiso, 2026-10-29).
    {
      names: ["Downtown Cupey"],
      address: "54 Av. Paraná, San Juan, PR 00926",
      point: { lat: 18.384, lng: -66.0631 },
      streets: ["Ave. Paraná", "Av. Paraná", "Avenida Paraná"],
    },
    // Calle Loiza salsa bar, also called La Casa de los Bailadores (Wed-Sun salsa); Salsa Vida's venue listings
    // give 2500 Calle Loiza, 00913 (2026-10-29). Viajando y Bailando's event page names it "Musica Bar & Lounge"
    // at "Calle Loiza #2057, Pagan's Building Plaza, 00912", which the geocoder refused (run 40952179002).
    {
      names: [
        "Música Bar & Lounge",
        "Musica Bar & Lounge",
        "Música Bar",
        "La Casa de los Bailadores",
      ],
      address: "2500 Calle Loíza, San Juan, PR 00913",
      streets: ["Pagan's Building Plaza"],
    },
    // Cambio en Clave's monthly Wednesday salsa night, at San Patricio Plaza's Liberty Square, Guaynabo. Its
    // events page names the venue only; the point is OpenStreetMap's San Patricio Plaza (2026-10-30).
    {
      names: ["Liberty Square", "Noches de salsa en Liberty Square"],
      address: "100 Av. San Patricio, Guaynabo, PR 00968",
      point: { lat: 18.4091, lng: -66.105 },
    },
    // Cambio en Clave's monthly Saturday salsa night at the Bacardi distillery's visitor centre. Its own page gives
    // "Carretera 165, Km. 6.2, Cataño"; the point is OpenStreetMap's Bacardi exhibition (2026-10-30).
    {
      names: ["Casa BACARDÍ", "Casa Bacardi"],
      address: "Carretera 165, Km. 6.2, Cataño, PR 00962",
      point: { lat: 18.4579, lng: -66.1407 },
    },
    // El Boricua, Río Piedras: Monday plena (D-463). Platea and Discover Puerto Rico give 5 Calle Saldaña; the
    // point is OpenStreetMap's El Boricua bar node, at the Calle Rosales corner (2026-10-31).
    {
      names: ["El Boricua"],
      address: "5 Calle Saldaña, Río Piedras, San Juan, PR 00925",
      point: { lat: 18.40057, lng: -66.05175 },
      streets: ["Calle Saldaña", "Calle Saldana", "Calle Rosales"],
    },
    // La Terraza de Bonanza, Santurce: Monday bomba and plena (D-463). Discover Puerto Rico gives Ave. Eduardo Conde
    // 1751, 00912; the point is OpenStreetMap's 1751 Avenida Eduardo Conde (2026-10-31).
    {
      names: ["La Terraza de Bonanza", "Terraza de Bonanza", "El Bonanza"],
      address: "1751 Ave. Eduardo Conde, Santurce, San Juan, PR 00912",
      point: { lat: 18.44429, lng: -66.06235 },
      streets: ["Ave. Eduardo Conde", "Av. Eduardo Conde", "Avenida Eduardo Conde"],
    },
    // Los Almendros, Guaynabo: chinchorro with open-air live salsa. Viajando y Bailando's "Salsa en Vivo al Aire
    // Libre" page names it ("Los Almendros PR-169, Guaynabo, PR"), but its feed carries only "PR-169, Guaynabo, PR"
    // with no name and no ZIP (5 unplaced rows on run 41207121279), hence the street. No source gives a ZIP; the
    // point is Platea PR's directory map pin (Google place ChIJl77WDWZCA4wRh82choR5IWQ, 2026-10-31).
    {
      names: ["Los Almendros"],
      address: "PR-169, Guaynabo, PR",
      point: { lat: 18.3421385, lng: -66.1048292 },
      streets: ["PR-169, Guaynabo"],
    },
  ],
  raleigh: [
    // Raleigh Elks Lodge: Carolina Dance Club's socials (carolinadanceclub.com and its Meetup group give
    // 5538 Leadmine Rd, Raleigh, NC 27612; checked 2026-10-31).
    // Its Meetup listings carry only the source's label, "Carolina Dance Club", so that is a name here (10/31).
    {
      names: ["Raleigh Elks Lodge", "Elks Lodge Raleigh", "Carolina Dance Club"],
      canonical: true,
      address: "5538 Leadmine Rd, Raleigh, NC 27612",
      streets: ["Leadmine Rd", "Leadmine Road"],
    },
    // Brier Creek Community Center: the Raleigh Line Dance group's Wednesday classes. Its Meetup listings
    // name no place (10/31 run 41179583628 left both unplaced); Walter
    // magazine gives 10810 Globe Road, Morrisville (2026-10-31). The geocoder calls that address too vague
    // (run 41181212406, confidence 0.4); the point is OpenStreetMap's Brier Creek Park, which holds the centre.
    // The feed's events carry no LOCATION, so they take the source's venueAddress under its label: "Raleigh Line
    // Dance" is that label, the only name those listings have.
    {
      names: ["Brier Creek Community Center", "Brier Creek Community Centre", "Raleigh Line Dance"],
      canonical: true,
      address: "10810 Globe Rd, Morrisville, NC 27560",
      point: { lat: 35.90052, lng: -78.80675 },
    },
    // Komana Brewery, Cary: Salsa4Life's Wednesdays (salsa4life.com gives 1020 Ryan Rd, Cary; checked
    // 2026-10-31). Eventbrite writes "KōMANA Brewing Company", salsa4life.com "Komana Brewery" (live Nov 4).
    {
      names: ["Komana Brewery", "KoMANA Brewing Company", "Komana Brewing Company", "Komana"],
      canonical: true,
      address: "1020 Ryan Rd, Cary, NC 27511",
    },
    // PBR Cowboy Bar, Cary (pbrcowboybar.com/cary gives 301 Fenton Gateway Dr; checked 2026-10-31).
    // Salsa Vida writes "Pbr Cary".
    {
      names: ["PBR Cowboy Bar", "PBR Cowboy Bar Cary", "Pbr Cary", "PBR Cary"],
      canonical: true,
      address: "301 Fenton Gateway Dr, Cary, NC 27511",
    },
    // The Swing Space at Triangle Dance Studio, Durham (D-601): theswingspace.dance and its calendar give
    // 2603 S Miami Blvd, Durham, NC 27703; the Census geocoder matches it (2026-10-31). Its calendar listings carry
    // the source's label when an event has no LOCATION, so "The Swing Space" is a name here.
    {
      names: ["The Swing Space", "Swing Space", "Triangle Dance Studio"],
      canonical: true,
      address: "2603 S Miami Blvd, Durham, NC 27703",
      // Its calendar's LOCATION is the bare address, which became the venue's name (live 11/4, run 41216303640).
      streets: ["S Miami Blvd", "South Miami Boulevard", "S Miami Boulevard"],
      point: { lat: 35.93236, lng: -78.84285 },
    },
  ],
  "los-angeles": [
    // Crown City Dance's hall in Pasadena: its own Wix events name it "Crown Theatre", where-to-dance-salsa writes
    // "Crown City Dance (Crown Theatre)"; the same Monday social listed twice on 2026-11-07. Address from
    // crownpasadena.com's own listing (2026-11-07).
    {
      names: [
        "Crown Theatre",
        "Crown City Dance (Crown Theatre)",
        "Crown City Dance",
        "Crown Pasadena",
      ],
      address: "140 S Rosemead Blvd, Pasadena, CA 91107",
      canonical: true,
    },
    // Stevens Steakhouse, Commerce: its classes page states the Wednesday and Sunday bachata night; where-to-dance-salsa
    // writes "Steven's Steak & Seafood House" with only "Los Angeles". Address from its own site (2026-11-07).
    {
      names: [
        "Stevens Steakhouse",
        "Steven's Steak & Seafood House",
        "Stevens Steak & Seafood House",
        "Steven's Steakhouse",
      ],
      address: "5332 Stevens Pl, Commerce, CA 90040",
      // where-to-dance-salsa writes the town as "Los Angeles" for this Commerce address.
      areas: ["Los Angeles"],
      canonical: true,
    },
    // The Continental Club, DTLA (basement of the Hellman Building): Monday salsa and bachata; where-to-dance-salsa
    // gives only "Los Angeles". Address per where-to-dance-salsa's venue page and circa93.com (2026-11-07).
    {
      names: ["The Continental Club", "Continental Club"],
      address: "116 W 4th St, Los Angeles, CA 90013",
      canonical: true,
    },
  ],
  mumbai: [],
  // Delhi: RA writes Bianco's address as "D1/A, South Extension, Block M, New Delhi, Delhi 110049", which the geocoder
  // refused (low confidence 0.45) and whose rounded point RA's reader drops (read 42438657733, 2026-11-08).
  delhi: [
    // Bianco, M-4, 2nd floor, Block M, South Extension II, above the Ritu Kumar showroom (TicketFairy's venue page).
    // Point: Overture place "Ritu Kumar", Shop No M/4, South Extension Part 2 (release 2026-10-21.0), the same building.
    {
      names: ["Bianco", "Bianco Delhi"],
      address: "Bianco, M-4, 2nd Floor, Block M, South Extension Part 2, New Delhi, Delhi 110049",
      streets: ["D1/A, South Extension, Block M"],
      point: { lat: 28.5680656, lng: 77.2241058 },
    },
    // Zorba the Buddha, 7 Tropical Drive, Mehrauli-Gurgaon Road, Ghitorni (its own pages' address). Refused: "low
    // confidence 0.65 (building)" (read 42551085570, 2026-11-09). Point: OSM way 660896495 "Zorba the Buddha",
    // meditation centre (Nominatim, 2026-11-09), beside Overture's "Zorba Buddha" place (release 2026-10-21.0).
    {
      names: ["Zorba the Buddha", "Zorba the Buddha (Circle of Mystical Dances)"],
      address: "7, Tropical Drive, Mehrauli-Gurgaon Road, Ghitorni, New Delhi 110030",
      streets: ["7, Tropical Drive, Mehrauli-Gurgaon Road"],
      point: { lat: 28.4981141, lng: 77.1480479 },
      // One venue record named "Zorba the Buddha": the Circle's rows were stored under the old seed label (D-265).
      canonical: true,
    },
  ],
  // Pune: RA writes Antisocial's address as "Unit No. 101, Mezz & 1st Floor, Cello Platina, C.T.S No. 1183, Fergusson
  // College Rd, Shivajinagar, Pune, Maharashtra 411005", which the geocoder refused (low confidence 0.06, building), and
  // its rounded point (18.53, 73.84) RA's reader drops (read 42739417593, 2026-11-10).
  pune: [
    // Antisocial Pune, Cello Platina, Fergusson College Road, Shivajinagar (RA club 306542). Cello Platina is not in OSM.
    // Point: Square Yards' GeoCoordinates for the Cello Platina project (squareyards.com project 139953, 2026-11-10);
    // Nominatim reverse puts it on Gopal Krushna Gokhale Path (FC Road), Shivajinagar 411005 (2026-11-10).
    {
      names: ["Antisocial Pune", "Anti Social Pune", "antiSOCIAL Pune"],
      address:
        "Antisocial, Cello Platina, Fergusson College Road, Shivajinagar, Pune, Maharashtra 411005",
      streets: ["Cello Platina"],
      point: { lat: 18.529, lng: 73.84362 },
    },
  ],
  // Dubai (D-1061): the UAE has no postcodes and the geocoder answers hotel venues too vaguely, so each entry carries a
  // hand-checked point. "streets" holds a phrase of the address the venue's own seed (config/sources/dubai.ts) or RA
  // writes, so its rows are matched whatever venue name the page gives. Refusals from read 42336307211 (2026-11-07).
  dubai: [
    // The Penthouse, FIVE Palm Jumeirah: its own calendar's "Penthouse Dubai" and RA's "The Penthouse" were two venue
    // rows about 3 km apart, so "HITTY | MASH-UP FRIDAYS" showed twice (weekly review 2026-11-23, D-889). Point: OSM
    // hotel "FIVE Palm Jumeirah Dubai, No 1, West Beach Palm Jumeirah" (Nominatim, 2026-11-23). No streets: Bohemia
    // shares the hotel's address.
    {
      names: [
        "Penthouse Dubai",
        "The Penthouse",
        "The Penthouse Dubai",
        "The Penthouse FIVE Palm Jumeirah",
      ],
      address: "FIVE Palm Jumeirah Hotel, No 1 The Palm Jumeirah, Palm Jumeirah, Dubai",
      point: { lat: 25.1040786, lng: 55.1490731 },
      canonical: true,
    },
    // Bâoli Dubai, J1 Beach, Jumeira First (its own calendar page). Point: Google Maps pin for "Bâoli Dubai", plus
    // code 67G4+CG (Chrome audit, 2026-11-11; the J1 Beach complex pin is about 200 m away). OSM has no node.
    // All 5 rows unplaced on read 42956111758.
    {
      names: ["Bâoli Dubai", "Baoli Dubai", "Bâoli", "Baoli"],
      address: "Bâoli Dubai, J1 Beach, 2A St, Jumeira First, Jumeirah, Dubai",
      streets: ["Bâoli Dubai, J1 Beach"],
      point: { lat: 25.2261207, lng: 55.2563254 },
    },
    // Secret Lounge & Club, Montreal Barsha Hotel, first floor (its Instagram bio and 11-05 post). Point: Google Maps
    // pin for "Montreal Barsha Hotel", 23rd St, Al Barsha 1 (Chrome audit, 2026-11-09). Refused on read 42752775134:
    // "too vague (street, confidence 0.08)".
    {
      names: ["Secret Lounge & Club", "Secret Lounge"],
      address:
        "Secret Lounge & Club, Montreal Barsha Hotel, First Floor, 23rd St, Al Barsha 1, Dubai",
      streets: ["Secret Lounge & Club, Montreal Hotel"],
      point: { lat: 25.1087933, lng: 55.2038869 },
    },
    // Avenue Club, Shangri-La Hotel Sheikh Zayed Road, 42nd floor (its own /nights page). Point: OSM way 125848292
    // "Shangri La", hotel, 108-110 Sheikh Zayed Road (Nominatim, 2026-11-09). Refused on read 42559170000: "low
    // confidence 0.5 (amenity)".
    {
      names: ["Avenue Club", "Avenue Club Dubai"],
      address: "Avenue Club, Shangri-La Hotel, Sheikh Zayed Road, 42nd Floor, Dubai",
      streets: ["Avenue Club, Shangri-La Hotel"],
      point: { lat: 25.2081439, lng: 55.2719792 },
    },
    // TJ's, Taj Jumeirah Lakes Towers (Latin Crazy Tribe's Wednesday). Point: OSM way 709674070 "Taj Jumeirah Lakes
    // Towers", hotel (Nominatim, 2026-11-09).
    {
      names: ["TJ's Dubai", "TJ's Taj JLT"],
      address: "TJ's, Taj Jumeirah Lakes Towers Hotel, JLT, Dubai",
      streets: ["Taj Jumeirah Lakes Towers"],
      point: { lat: 25.0803893, lng: 55.1541773 },
    },
    // Le Piaf, Jumeirah Emirates Towers (its Instagram: "Emirates Towers Hotel, 1st floor, Trade Centre 2"). Point: OSM
    // way 393391115, hotel, Trade Centre 2 (Nominatim "Emirates Towers Hotel, Dubai", 2026-11-09).
    {
      names: ["Le Piaf", "Le Piaf Dubai"],
      address: "Le Piaf, Jumeirah Emirates Towers Hotel, 1st floor, Trade Centre 2, Dubai",
      streets: ["Jumeirah Emirates Towers Hotel"],
      point: { lat: 25.2175468, lng: 55.2836335 },
    },
    // Little Havana, Sofitel Dubai Jumeirah Beach (JBR). Point: OSM way 47808238 "Sofitel Dubai Jumeirah Beach"
    // (Nominatim, 2026-11-07). Refused: "low confidence 0.41 (amenity)".
    {
      names: ["Little Havana", "Little Havana Dubai"],
      address: "Little Havana, Sofitel Dubai Jumeirah Beach Hotel, The Walk, JBR, Dubai",
      streets: ["Sofitel Dubai Jumeirah Beach"],
      point: { lat: 25.0752952, lng: 55.1322303 },
    },
    // Bohemia, FIVE Palm Jumeirah. Point: OSM node 13227155502 "Bohemian", nightclub, FIVE Palm (Overpass,
    // 2026-11-07). Refused: "too vague (street, confidence 0)".
    {
      names: ["Bohemia", "Bohemia Dubai", "Bohemia Beach Club", "Bohemian"],
      address: "Bohemia, FIVE Palm Jumeirah Hotel, No 1 The Palm Jumeirah, Palm Jumeirah, Dubai",
      streets: ["Bohemia, FIVE Palm Jumeirah Hotel"],
      point: { lat: 25.1036823, lng: 55.1474466 },
    },
    // Lucky Voice, Grand Millennium Dubai (Barsha Heights). Point: the Google Maps link on luckyvoice.ae's own page
    // (3d25.1014495 4d55.1776637), the same building as OSM way 495933873 (2026-11-07). Refused: "low confidence 0.48".
    {
      names: ["Lucky Voice", "Lucky Voice Dubai"],
      address: "Lucky Voice, Grand Millennium Hotel, Barsha Heights, Dubai",
      streets: ["Lucky Voice, Grand Millennium Hotel"],
      point: { lat: 25.1014495, lng: 55.1776637 },
    },
    // Surf Club, West Beach, Palm Jumeirah. Point: the latitude/longitude on surfclubdubai.com/contact-us (2026-11-07).
    // Refused: "low confidence 0.06 (amenity)".
    {
      names: ["Surf Club", "Surf Club Dubai"],
      address: "Surf Club Dubai, West Beach, Palm Jumeirah, Dubai",
      streets: ["Surf Club Dubai, West Beach"],
      point: { lat: 25.1065625, lng: 55.1434375 },
    },
    // The Phoenix Dubai - Lounge & Club, Mezzanine Floor, Media Rotana (its own events page writes this address; weekly
    // club nights Monday to Sunday). Point: OSM way 495875994 "Media Rotana", hotel (Nominatim, 2026-11-07).
    // Refused: "low confidence 0.07 (amenity)".
    {
      names: ["The Phoenix Dubai", "The Phoenix", "The Phoenix Dubai - Lounge & Club"],
      address: "Mezzanine Floor, Media Rotana Hotel, Barsha Heights (TECOM), Dubai, U.A.E",
      streets: ["Media Rotana Hotel"],
      point: { lat: 25.0997602, lng: 55.1796406 },
    },
    // Coya Club, Restaurant Village, Four Seasons Resort Dubai at Jumeirah Beach (RA writes the address below).
    // Point: OSM node 5526220328, the Four Seasons Resort Dubai at Jumeirah Beach (Nominatim, 2026-11-07).
    {
      names: ["Coya Club", "Coya Dubai", "Coya"],
      address:
        "Restaurant Village Four Seasons Resort - Jumeirah Beach Road - Jumeirah 2 - Jumeirah - Dubai",
      streets: ["Restaurant Village Four Seasons Resort"],
      point: { lat: 25.202165, lng: 55.2396872 },
    },
    // Reunion DXB, Radisson Blu Hotel, Dubai Waterfront (RA writes the address below). Point: OSM node 5543614221
    // "Radisson Blu Hotel, Dubai Waterfront" (Nominatim, 2026-11-07).
    {
      names: ["Reunion DXB", "Reunion"],
      address: "Radisson Blu Hotel, Marasi Dr, Business Bay, Dubai Waterfront, UAE",
      streets: ["Radisson Blu Hotel, Marasi Dr"],
      point: { lat: 25.1867554, lng: 55.2679284 },
    },
  ],
  medellin: [
    // Open-air club in Manila, El Poblado. RA writes "Cr48#10-70 El Poblado, (Manila) - Medellin" with a rounded
    // point (6.21, -75.58) and the geocoder refused it (10/31 run 41174267336); point from OSM "Rama Soundgarden",
    // 10-70 Avenida Industriales, Manila (2026-10-31).
    {
      names: ["Rama Soundgarden", "Rama Sound Garden"],
      address: "Carrera 48 #10-70, Manila, El Poblado, Medellín",
      point: { lat: 6.2137467, lng: -75.5756732 },
    },
  ],
  berlin: [
    // Soda Club, Kulturbrauerei: its own events page names it "Soda Club Berlin", Salsa Vida and RA "Soda Social
    // Club", on two venue records, so one Thursday social stood twice (first read 42184314532, coverage-107).
    // Point: OSM node 1165008486 "Soda Club", nightclub, Knaackstraße 97 (Nominatim, 2026-11-06).
    {
      names: ["Soda Club Berlin", "Soda Social Club", "Soda Club"],
      address: "Schönhauser Allee 36, 10435 Berlin",
      streets: ["Schönhauser Allee 36", "Knaackstraße 97"],
      point: { lat: 52.5395232, lng: 13.4142448 },
      canonical: true,
    },
    // Havanna, Schöneberg: Salsa Vida names it "Havanna" with only "Berlin, Germany", so its nights stood apart from
    // the club's own weekly grid (read 2026-11-08). Address: the club's own site (config/sources/berlin.ts).
    {
      names: ["Havanna Berlin", "Havanna", "HAVANNA Berlin"],
      address: "Hauptstraße 30, 10827 Berlin",
      streets: ["Hauptstraße 30"],
      canonical: true,
    },
    // Eierschale Dahlem: the berlin.de page's venue came out as its event title "FrühTanz in der Eierschale Dahlem"
    // (read 2026-11-08). Address: the berlin.de page (config/sources/berlin.ts).
    {
      // The model copies the page title "... (berlin.de)" as the venue name (read 2026-11-09).
      names: [
        "Eierschale Dahlem",
        "FrühTanz in der Eierschale Dahlem",
        "FrühTanz in der Eierschale Dahlem (berlin.de)",
        "Eierschale",
      ],
      address: "Podbielskiallee 50, 14195 Berlin",
      streets: ["Podbielskiallee 50"],
      canonical: true,
    },
    // Tanzschule Traumtänzer's three branches: its /tanzparty/ grid writes "Tanzschule Traumtänzer -
    // <branch>, <street>" with no postcode, so only Tempelhof was placed and the Mariendorf and Kurfürstendamm nights
    // stood unplaced (read 2026-11-11, coverage-143). Großbeerenstraße 46 also exists in Kreuzberg (10965), hence the
    // points. Points: OSM nodes "Tanzschule Traumtänzer" 1471338897, 2705653990, 988072702 (Nominatim, 2026-11-11).
    {
      names: [
        "Tanzschule Traumtänzer - Flughafen Tempelhof",
        "Tanzschule Traumtänzer Flughafen Tempelhof",
        "Traumtänzer Flughafen Tempelhof",
      ],
      address: "Columbiadamm 8, 12101 Berlin",
      streets: ["Columbiadamm 8"],
      point: { lat: 52.4839693, lng: 13.3904579 },
      canonical: true,
    },
    {
      names: [
        "Tanzschule Traumtänzer - Mariendorf",
        "Tanzschule Traumtänzer Mariendorf",
        "Traumtänzer Mariendorf",
      ],
      address: "Großbeerenstraße 46-52, 12107 Berlin",
      point: { lat: 52.4352355, lng: 13.3778659 },
      canonical: true,
    },
    {
      names: [
        "Tanzschule Traumtänzer - Kurfürstendamm",
        "Tanzschule Traumtänzer Kurfürstendamm",
        "Traumtänzer Kurfürstendamm",
      ],
      address: "Westfälische Straße 49, 10711 Berlin",
      streets: ["Westfälische Straße 49"],
      point: { lat: 52.4966563, lng: 13.291545 },
      canonical: true,
    },
  ],
  // Beirut (D-1000; no postcodes; addresses have no house numbers, so the geocoder answers them too vaguely): each entry
  // carries a hand-checked point. Refusals from the first read 42338571510 (2026-11-07).
  beirut: [
    // Metro al Madina, Aresco Center, Clemenceau (address from metromadina.com/contact-us, 2026-11-07). Point: OSM way
    // 144079884 "Tour Aresco" (Nominatim, 2026-11-07); Overture place 6f4d7ce3 is 50 m away. Refused: "too vague
    // (suburb, confidence 0.25)".
    {
      names: [
        "Metro al Madina",
        "Metro Al Madina",
        "Metro al Madina (Midnight Metro)",
        "مترو المدينة",
      ],
      address: "Aresco Center, Justinian Street, Clemenceau, Hamra, Beirut",
      streets: ["Aresco Center"],
      point: { lat: 33.8956529, lng: 35.4913418 },
    },
    // B018, La Quarantaine (Karantina); RA club 3945 gives "lot # 371, La Quarantaine, Medwar Beirut, Lebanon". Point:
    // OSM node 5492486021, nightclub (Nominatim, 2026-11-07); Overture place a580ca72 agrees. Unplaced on read 42338571510.
    {
      names: ["B018", "B 018", "B-018"],
      address: "B018, lot # 371, La Quarantaine, Medwar, Beirut",
      streets: ["lot # 371, La Quarantaine"],
      point: { lat: 33.8985227, lng: 35.5342198 },
    },
  ],
  // Marrakesh (D-1100): the geocoder answers Marrakech addresses only to the postcode (40000 covers the city), so each
  // venue a source names carries a hand-checked point. Refusals from the first read 42463050305 (2026-11-08).
  marrakesh: [
    // Theatro (Es Saadi resort, Hivernage). Point: OSM node 3266218588 "TheatrO", nightclub (Overpass, 2026-11-08).
    // Refused: "too vague (postcode, confidence 1)".
    {
      names: ["Theatro", "Theatro Marrakech", "TheatrO", "Le Theatro"],
      address: "Theatro, Rue Ibrahim El Mazini, Hivernage, 40000 Marrakech",
      point: { lat: 31.6216164, lng: -8.0048713 },
    },
    // Babouchka, 10 Rue Haroun Errachid (babouchka-marrakech.com). Not in OSM; point: the street, OSM way 15164194
    // (Nominatim, 2026-11-08), a short Hivernage street. Refused: "low confidence 0.5 (building)".
    {
      names: ["Babouchka", "Babouchka Marrakech"],
      address: "Babouchka, 10 Rue Haroun Errachid, Hivernage, 40000 Marrakech",
      point: { lat: 31.6219019, lng: -8.0006309 },
    },
    // Comptoir Darna and its first-floor club Souktronic. Point: OSM node 3264548126 "Comptoir Darna", nightclub
    // (Overpass, 2026-11-08). Refused: "too vague (postcode, confidence 1)".
    {
      names: ["Comptoir Darna", "Le Comptoir Darna", "Souktronic", "Souktronic at Comptoir Darna"],
      address: "Comptoir Darna, Avenue Echouhada, Hivernage, 40000 Marrakech",
      point: { lat: 31.6237194, lng: -8.0031039 },
    },
    // El Fenn (hotel and rooftop, Bab El Ksour). Point: OSM node 8571226317 "El Fenn", hotel (Nominatim, 2026-11-08).
    // Refused: "too vague (postcode, confidence 1)" and "El Fenn Hotel and Rooftop Bar: low confidence 0 (amenity)";
    // RA's point for it is a placeholder (32, -8).
    {
      // Its own page's rows carry the source's label as the venue name; RA writes the address "El Fenn Hotel and
      // Rooftop Bar" (read 42586138898 left both unplaced). Canonical (D-855): the page's label made its own venue
      // beside Tidar's "El Fenn Hotel", and 11-22 showed twice; every name now lands on El Fenn Hotel.
      names: [
        "El Fenn Hotel",
        "El Fenn",
        "El Fenn Hotel and Rooftop Bar",
        "El Fenn Marrakech",
        "Sol Sundays at El Fenn",
      ],
      address: "El Fenn, Derb Moulay Abdellah Ben Hezzian, Bab El Ksour, Medina, 40000 Marrakech",
      areas: ["El Fenn Hotel and Rooftop Bar", "Bab El Ksour"],
      point: { lat: 31.6269841, lng: -7.9932304 },
      canonical: true,
    },
    // M Rooftop by Medina Heritage, 58 rue El Ksour (Raíces, hellobeldi.com/raices). Point: OSM node 10777027005,
    // restaurant (Nominatim, 2026-11-08).
    {
      names: ["M Rooftop by Medina Heritage", "M Rooftop", "Medina Heritage"],
      address: "M Rooftop by Medina Heritage, 58 Rue El Ksour, Medina, 40000 Marrakech",
      point: { lat: 31.6275773, lng: -7.991812 },
    },
    // 555 Famous Club (Hotel Clubbing, Bd Mohammed VI, Agdal). Not in OSM; point: Alotea's schema.org geo for it
    // (alotea.com/marrakech/nightclubs/555-famous-club), which OSM reverse-geocodes to Bd Mohammed VI, Agdal (2026-11-08).
    {
      names: ["555 Famous Club", "555 Famous NightClub", "555 Famous", "Club 555", "555 Marrakech"],
      address: "555 Famous Club, Hotel Clubbing, 555 Boulevard Mohammed VI, Agdal, 40000 Marrakech",
      point: { lat: 31.592144, lng: -7.9899048 },
    },
    // Secret Room (Avenue Echouhada, Hivernage). Not in OSM; point: Alotea's schema.org geo for it, which OSM
    // reverse-geocodes to Hivernage, 90 m from Comptoir Darna on the same avenue (2026-11-08).
    {
      names: ["Secret Room", "Secret Room Marrakech"],
      address: "Secret Room, Avenue Echouhada, Hivernage, 40000 Marrakech",
      point: { lat: 31.6241679, lng: -8.003255 },
    },
    // Leone Discoteca (Tidar: "Rue Abdelaziz Ettaalibi"). Not in OSM; point: the street, OSM way 15164207 (Nominatim,
    // 2026-11-08), Hivernage.
    {
      names: ["Leone Discoteca", "Leone Discoteca Marrakech", "Leone", "LEONE"],
      address: "Leone Discoteca, Rue Abdelaziz Ettaalibi, Hivernage, 40000 Marrakech",
      point: { lat: 31.6256505, lng: -8.0051038 },
    },
  ],
  // Paris (D-1040): none yet.
  paris: [],
  // Tulum (D-1080): none yet.
  tulum: [
    // Grupo Mandala's clubs (D-1082): each address is the one its own MandalaTickets page writes (JSON-LD
    // PostalAddress, 2026-11-07), the seed's venueAddress, so the seed's rows take the point. The pages' own map
    // pins are generic (all Playa clubs at 10 Av / Calle 10 per OSM reverse, 2026-11-08), so points are from OSM.
    // Their rows were "Location not listed" on run 42492351731.
    // La Vaquita, Calle 12 Norte, Playa del Carmen: OSM node "La Vaquita", Calle 12 Norte, Centro (2026-11-08).
    {
      names: ["La Vaquita Playa del Carmen", "La Vaquita"],
      address: "Calle 12 Nte, Centro, 77720 Playa del Carmen, Q.R.",
      point: { lat: 20.6271044, lng: -87.0707806 },
    },
    // Rakata, Calle 12 Norte, Playa del Carmen: not in OSM (2026-11-08); street-level point at the Calle 12 Norte /
    // 1 Avenida Norte block it shares with Mandala (OSM "Mandala", 1 Avenida Norte).
    {
      names: ["Rakata Playa del Carmen", "Rakata"],
      address: "Calle 12 Nte, Gonzalo Guerrero, 77710 Playa del Carmen, Q.R.",
      point: { lat: 20.6271883, lng: -87.0711791 },
    },
    // Santito Tun Tun, Playa del Carmen: not in OSM by that name (2026-11-08); same street-level point as Rakata.
    {
      names: ["Santito Tun Tun", "Santito Tun - Tun"],
      address: "Avenida 12 con, Calle 1 Nte., 77710 Playa del Carmen, Q.R.",
      point: { lat: 20.6271883, lng: -87.0711791 },
    },
    // Vagalume, Tulum beach road: OSM "Vagalume Tulum", Carretera Ramal a Punta Allen (2026-11-08); its own page's
    // pin (20.1516094, -87.4577342) agrees within 40 m.
    {
      names: ["Vagalume Tulum", "Vagalume"],
      address: "QROO 15, Tulum Beach, 77776 Q.R.",
      point: { lat: 20.1512863, lng: -87.4577539 },
    },
    // Aloft Playa del Carmen (hotel; Let's Dance Mexico's LUSH Fridays, D-802): OSM "aloft Playa del Carmen", Calle 34
    // Norte, Gonzalo Guerrero (2026-11-09).
    {
      names: ["Aloft Playa del Carmen", "Aloft Hotel Playa del Carmen"],
      address: "Calle 34 Norte, Gonzalo Guerrero, 77720 Playa del Carmen, Q.R.",
      point: { lat: 20.6347832, lng: -87.0682782 },
    },
    // Casa Jaguar, Tulum beach road km 7.5 (its own dated club nights): the geocoder refused the seed address
    // (confidence 0, run 42639809098), so its 2026-11-12 night was unplaced. Point: OSM "Casa Jaguar", restaurant,
    // Carretera Ramal a Punta Allen (the beach road), Nominatim 2026-11-09. Address = the seed's, so its rows match.
    {
      names: ["Casa Jaguar", "Casa Jaguar Tulum"],
      address: "Carretera Tulum-Boca Paila km 7.5, Tulum, Q.R.",
      point: { lat: 20.1517219, lng: -87.4583791 },
    },
    // Hotel Fiesta Inn Playa del Carmen (Let's Dance Mexico's Latin Sunset Sundays, D-802): OSM "Fiesta Inn",
    // 10 Avenida Norte, Gonzalo Guerrero (2026-11-09).
    {
      names: ["Fiesta Inn Playa del Carmen", "Hotel Fiesta Inn Playa del Carmen"],
      address: "10 Avenida Norte, Gonzalo Guerrero, 77720 Playa del Carmen, Q.R.",
      point: { lat: 20.6330453, lng: -87.0693367 },
    },
    // El Barrio Tulum (Tulum Salsa Academy's Wednesday Latin nights, D-802): Google Maps pin read in the owner's Chrome
    // (2026-11-09), "Av. Tulum, Tulum Centro", matching the academy's "Avenida Tulum" (its own site footer says
    // "Av. Kukulcan"; not the closed "BARRIO" restaurant on Pino Suarez). Not in OSM.
    {
      names: ["El Barrio Tulum"],
      address: "Av. Tulum, Tulum Centro, Col. Huracanes, 77760 Tulum, Q.R.",
      point: { lat: 20.2131139, lng: -87.4560911 },
    },
    // The Space Tulum, La Veleta (Rendez-Vous Bachata Thursdays, D-802): Google Maps pin read in the owner's Chrome
    // (2026-11-09); the listing's address and site match thespacetulum.mx. Not in OSM.
    {
      names: ["The Space Tulum", "The Space La Veleta"],
      address: "C. Tulum Manzana 33 Lote 002, La Veleta, 77760 Tulum, Q.R.",
      point: { lat: 20.2056019, lng: -87.4782665 },
    },
    // Bonbonniere, Tulum beach road (Parcela 1744-A): not in OSM (2026-11-08); point from its own page's map pin,
    // which OSM reverse puts on the Tulum beach road about 350 m from Vagalume.
    {
      names: ["Bonbonniere Tulum", "Bonbonniere"],
      address:
        "Carretera estatal Tulum - Boca Paila, Parcela 1744-A NCPE José María Pino Suárez, 77760 Tulum, Q.R.",
      point: { lat: 20.1533505, lng: -87.460312 },
    },
  ],
  // Nashville (D-1200): none yet.
  nashville: [],
  // Tokyo (D-1221): no known venues yet.
  // Tokyo (D-1234): the geocoder answers Japanese addresses with "no answer" or "low confidence 0 (building)", so each
  // entry carries a hand-checked point (OSM or the venue's own map link). Refusals from read 42420733466 (2026-11-07).
  tokyo: [
    // ---- Our own venue sources (config/sources/tokyo.ts). "address" is the seed's venueAddress exactly, so a row
    // carrying it takes the point at once; "streets" is the 東京都 phrase of that address, so a row under any name is
    // matched too. Read 42420733466 (2026-11-07) left every row of these sources unplaced.
    // Studio Pepe, Roppongi 7-chome. Address: the seed (studio-pepe.com's own map link names 〒106-0032
    // 港区六本木7丁目17−12). Point: OSM node 12827713193 "Studio PePe", leisure=dance, 六本木七丁目 (Nominatim, 2026-11-07), 11 m
    // from the address pin on studio-pepe.com's own Google Maps link. Refused: "no answer".
    {
      names: ["Studio Pepe", "スタジオペペ", "Studio Pepe 2"],
      address: "〒106-0032 東京都港区六本木7-17-12",
      streets: ["東京都港区六本木7-17-12"],
      point: { lat: 35.6627765, lng: 139.7296556 },
      canonical: true,
    },
    // Club Salud!, Nippori Ekimae Bldg 3F, Higashi-Nippori 6-chome. Address: the seed (club-salud.com writes
    // 〒116-0014 東京都荒川区東日暮里6丁目60−9 3F). Point: OSM node 1936321389 "Salud!", bar, 東日暮里六丁目 (Nominatim, 2026-11-07); the
    // Meetup venue "日暮里駅前ビル" pin is 7 m away. Refused: "no answer"; Meetup rows: "with no postcode; left unplaced".
    {
      names: [
        "Club Salud",
        "Club Salud!",
        "Salud!",
        "Salsa Club Nippori Salud",
        "Latin Bar Salud",
        "日暮里駅前ビル",
      ],
      address: "〒116-0014 東京都荒川区東日暮里6-60-9 日暮里駅前ビル3F",
      streets: ["東京都荒川区東日暮里6-60-9", "6-chōme−60−９ 日暮里駅前ビル"],
      point: { lat: 35.7286826, lng: 139.7723193 },
      canonical: true,
    },
    // Latin Club Leon, B1F On Leon Bldg, Shinjuku 5-chome. Address: the seed (Salsa Vida writes the same). Point: OSM
    // node 12555765785 "Leon", bar, 新宿五丁目 (Nominatim, 2026-11-07), 16 m from OSM node 13430529744 at 新宿5-17-6; OSM
    // node 12555605669 "スタジオLeon" is 6 m away. Refused: "low confidence 0 (building)".
    {
      names: [
        "Latin Club Leon",
        "Leon",
        "Studio Leon",
        "スタジオLeon",
        "Shinjuku Leon",
        "Latin Club Leon Shinjuku",
      ],
      address: "〒160-0022 東京都新宿区新宿5-17-6 B1",
      streets: ["東京都新宿区新宿5-17-6"],
      point: { lat: 35.6930589, lng: 139.7057478 },
      canonical: true,
    },
    // Latin Bar Las Risas, Onosho Bldg B1F, Ginza 8-chome. Address: the seed (lasrisas.com writes the same). Point:
    // OSM way 159947187 "Latin Bar Las Risas", tagged 銀座8丁目12-6 Onosho Bldg (Nominatim, 2026-11-07). Refused: "no
    // answer".
    {
      names: [
        "Las Risas",
        "Las Risas calendar",
        "Latin Bar Las Risas",
        "ラス・リサス",
        "銀座ラス・リサス",
      ],
      address: "〒104-0061 東京都中央区銀座8-12-6 小野商ビルB1F",
      streets: ["東京都中央区銀座8-12-6"],
      point: { lat: 35.6673581, lng: 139.7629052 },
      canonical: true,
    },
    // Studio JBA, HAT Bldg B1F, Nihonbashi-Odenmacho. Address: the seed (its own site; Salsa Vida agrees). Point: OSM
    // node 12587286817 "Studio JBA", leisure=dance (Nominatim, 2026-11-07): 24 m from OSM node 1420781074 at
    // 大伝馬町12-1, and between 大伝馬町8-1 and 12-1 in OSM's block order (Overpass). Nominatim's area polygon names 堀留町二丁目
    // (the town line is a street away). The 2019 Google embed on studiojba.com/access is 200 m west, by 大伝馬町4-5; not
    // used. Refused: "no answer".
    {
      names: ["Studio JBA", "スタジオJBA", "JBA"],
      address: "〒103-0011 東京都中央区日本橋大伝馬町11-8 HATビルB1F",
      streets: ["東京都中央区日本橋大伝馬町11-8"],
      point: { lat: 35.6900086, lng: 139.7806742 },
    },
    // Dance Hall Shinseiki, Negishi 1-chome (Uguisudani). Address: the seed. Point: OSM node 5149554431 "ダンスホール新世紀",
    // 根岸一丁目 (Nominatim, 2026-11-07). Silent source on read 42420733466 (no rows yet), so no refusal.
    {
      names: ["Dance Hall Shinseiki", "ダンスホール新世紀", "新世紀"],
      address: "〒110-0003 東京都台東区根岸1-1-14",
      streets: ["東京都台東区根岸1-1-14"],
      point: { lat: 35.7207553, lng: 139.7801819 },
    },
    // Fiesta Latin Spot Bar, Dai-21 Tokyo Bldg 3F, Kabukicho 1-chome. Address: the seed (its own page). Point: OSM
    // node 12566753781 "Fiesta", bar, 歌舞伎町一丁目 (Nominatim, 2026-11-07), 7 m from OSM node 10736188267 at 歌舞伎町1-14-5
    // (Overpass). Silent source on read 42420733466, so no refusal.
    {
      names: ["Fiesta Latin Spot Bar", "Fiesta", "Fiesta Latin Bar"],
      address: "〒160-0021 東京都新宿区歌舞伎町1-14-6 第21東京ビル3F",
      streets: ["東京都新宿区歌舞伎町1-14-6"],
      point: { lat: 35.6946781, lng: 139.7020737 },
    },
    // ---- Latin venues named by Salsa Vida and Meetup rows.
    // El Café Latino, WIN Roppongi 1F, Roppongi 3-chome. Address: the Meetup venue (東京都港区六本木3-15-24 WIN六本木１階); Salsa
    // Vida writes 106-0032. Point: OSM node 13031097141 "El Cafe Latino", bar, 六本木三丁目 (Nominatim, 2026-11-07), 12 m
    // from OSM way 161725069 at 六本木3-15-24 (Overpass). Report: "no building-level answer for WIN ROPPONGI 1F,
    // 3-15-24"; its Meetup rows were also taken off as "in 京都" (see the notes: 東京都 contains 京都).
    {
      names: [
        "El Cafe Latino",
        "El Café Latino",
        "EL Cafe Latino in Roppongi",
        "El Cafe Latino Roppongi",
        "El Café Latino Roppongi",
      ],
      address: "〒106-0032 東京都港区六本木3-15-24 WIN六本木1F",
      streets: [
        "東京都港区六本木3-15-24",
        "3-15-24, ROPPONGI",
        "3chome-15-24, Roppongi",
        "3 Chome-15-24 Roppongi",
      ],
      point: { lat: 35.6625625, lng: 139.7354892 },
      canonical: true,
    },
    // Egoland Tokyo, Kanda-Sakumacho 4-chome (Akihabara). Address: Salsa Vida ("4 7－3 2F Kanda Sakuma-chō"), the same
    // as OSM's tags. Point: OSM node 10587971360 "Egoland Tokyo", tagged 神田佐久間町四丁目7-3, 101-0025 (Nominatim,
    // 2026-11-07).
    {
      names: ["Egoland", "Egoland Tokyo", "Egoland Akihabara"],
      address: "〒101-0025 東京都千代田区神田佐久間町4-7-3 2F",
      streets: ["4 7－3 2F Kanda Sakuma-chō"],
      point: { lat: 35.6975001, lng: 139.7793631 },
    },
    // Havana 1950, Taiseikouki Bldg B1F, Hiroo 5-chome. Address: the Meetup venue ("Taiseikouki Bldg. B1F, 5-4-12
    // Hiroo"); postcode of 広尾 (zipcloud, 2026-11-07). Point: OSM way 218254447, building tagged 4-12, 広尾五丁目
    // (Nominatim reverse, 2026-11-07), 6 m from the Meetup pin. Unplaced on read 42420733466.
    {
      names: ["HAVANA 1950"],
      address: "〒150-0012 東京都渋谷区広尾5-4-12 Taiseikouki Bldg. B1F",
      streets: ["5-4-12 Hiroo"],
      point: { lat: 35.651089, lng: 139.7219965 },
    },
    // Bar Quest, Dai-2 Reine Bldg, Roppongi 5-chome. Address: OSM way 161728035 "川崎定徳第２レーヌビル" is 六本木5-3-1 (the Meetup
    // venue writes "5 Chome−5−3−1 第2レーヌビル"). Point: OSM node 12560969036 "Quest", bar, 六本木五丁目 (Nominatim,
    // 2026-11-07), 6 m inside that building. Report: "no building-level answer".
    {
      names: ["Bar Quest", "Quest", "Quest Roppongi"],
      address: "〒106-0032 東京都港区六本木5-3-1 第2レーヌビル",
      streets: ["5 Chome−5−3−1 第2レーヌビル"],
      point: { lat: 35.6621327, lng: 139.7333108 },
    },
    // SHIBUYA AXSH (渋谷アクシュ), Shibuya 2-chome. Address: OSM way 1031373713, tagged 渋谷二丁目17-1, 150-0002 (Meetup writes
    // "2-chōme-17-1 Shibuya, Tokyo 150-0002"). Point: that building (Nominatim, 2026-11-07). Report: "no
    // building-level answer".
    {
      names: ["SHIBUYA AXSH", "渋谷アクシュ", "CERVEZA Shibuya AXSH"],
      address: "〒150-0002 東京都渋谷区渋谷2-17-1 渋谷アクシュ",
      point: { lat: 35.6590598, lng: 139.7044775 },
    },
    // Studio G-BOX, Taiko Bldg B1, Ebisu 4-chome. Address: the Meetup venue and the TokyoTango row (渋谷区恵比寿4-4-11
    // B1階). Point: OSM node 12825547865 "Studio G-BOX", leisure=dance, 恵比寿四丁目 (Nominatim, 2026-11-07), 4 m from the
    // Meetup pin and 2 m from the TokyoTango row's Google Maps link. Its Meetup rows were taken off as "in 京都" (see
    // the notes).
    {
      names: ["スタジオG-BOX", "Studio G-BOX", "G-BOX"],
      address: "〒150-0013 東京都渋谷区恵比寿4-4-11 太興ビルB1",
      streets: ["東京都渋谷区恵比寿４－４－１１太興ビルB-1", "渋谷区恵比寿4-4-11 B1階"],
      point: { lat: 35.6451785, lng: 139.7115826 },
      canonical: true,
    },
    // ---- Tango venues (TokyoTango sheet; names are the 場所 column as written, streets the 東京都 address the adapter
    // takes from the 情報 text, whole, so the row's own address matches).
    // Zita Argentine Tango Studio, Tsukahara Bldg 4F/5F, Kamiosaki 2-chome (Meguro). Address: the sheet's 情報 text;
    // postcode from its Google Maps link (〒141-0021 品川区上大崎2丁目27−2 塚原ビル). Point: OSM node 12581616162 "Zita",
    // leisure=dance, 上大崎二丁目 (Nominatim, 2026-11-07), 3 m from that link's pin. Refused: "東京都品川区上大崎2-27-2塚原ビル4F: low
    // confidence 0 (building)".
    {
      names: [
        "Zitaアルゼンチンタンゴスタジオ",
        "Zita 4F/5F",
        "Zita",
        "ZITA アルゼンチンタンゴ",
        "Zita 5F",
        "Zita 4F",
      ],
      address: "〒141-0021 東京都品川区上大崎2-27-2 塚原ビル4F",
      streets: ["東京都品川区上大崎2-27-2塚原ビル4F", "2-27-2 Kamiosaki"],
      point: { lat: 35.6343718, lng: 139.7150034 },
      canonical: true,
    },
    // Studio-J (JoeTango), Ogura Bldg B1, Higashi 3-chome (Shibuya). Address: the sheet's 情報 text; postcode from its
    // Google Maps link (〒150-0011 渋谷区東3丁目22−9 小倉ビル). Point: OSM node 12865892816 "Studio-J", leisure=dance, 東三丁目
    // (Nominatim, 2026-11-07), 5 m from both of the sheet's Google Maps links. Refused: "東京都渋谷区東3-22-9 小倉ビルB1: no
    // answer".
    {
      names: ["Studio-J", "Studio J", "JoeTango"],
      address: "〒150-0011 東京都渋谷区東3-22-9 小倉ビルB1",
      streets: ["東京都渋谷区東3-22-9"],
      point: { lat: 35.649574, lng: 139.7089207 },
    },
    // Chiqué (アルゼンチンタンゴ・ダンス チケ), Wakaba 1-chome (Yotsuya). Address: the sheet's 情報 text; postcode from its Google
    // Maps link (〒160-0011 新宿区若葉1丁目1−1 2F). Point: the Google Maps link on the sheet's Chique rows (3d35.6873605
    // 4d139.7230165), in 若葉一丁目 (Nominatim reverse, 2026-11-07). Refused: "東京都新宿区若葉1-1-1 2F: no answer".
    {
      names: [
        "Chique",
        "Chiqué",
        "Studio Chiqué",
        "Studio Chique",
        "Studio Chiqué スタジオ　チケ",
        "Chiqué Yotsuya",
      ],
      address: "〒160-0011 東京都新宿区若葉1-1-1 2F",
      streets: ["東京都新宿区若葉1-1-1", "東京都新宿区若葉1丁目1−1-2F"],
      point: { lat: 35.6873605, lng: 139.7230165 },
      canonical: true,
    },
    // Argentine Tango Association (アルゼンチンタンゴ協会), Kyoei Ginza 7-chome Bldg. Address: the sheet's 情報 text (住所:
    // 東京都中央区銀座7丁目14−7共栄銀座7丁目ビル); postcode of 銀座 (OSM tags on Las Risas). Point: the sheet's Google Maps link
    // (3d35.6672646 4d139.7648953), in 銀座七丁目 (Nominatim reverse, 2026-11-07). Unplaced on read 42420733466.
    {
      names: [
        "アルゼンチンタンゴ協会",
        "Argentine Tango Association",
        "Argentine Tango Association Ginza",
      ],
      address: "〒104-0061 東京都中央区銀座7-14-7 共栄銀座7丁目ビル",
      streets: ["東京都中央区銀座7丁目14−7共栄銀座7丁目ビル"],
      point: { lat: 35.6672646, lng: 139.7648953 },
    },
    // Toyosu Civic Center (豊洲シビックセンター, 豊洲文化センター inside), Toyosu 2-chome. Address: the sheet's 情報 text (住所:
    // 東京都江東区豊洲2丁目2; no house number given); postcode from OSM node 11436145839. Point: the sheet's Google Maps link
    // "豊洲文化センター" (3d35.6542678 4d139.7953648), 5 m from OSM node 1420787710 江東区立豊洲図書館 (in the same building) and 30 m
    // from OSM node 11436145839 "豊洲シビックセンター", 豊洲二丁目 (Nominatim, 2026-11-07). Refused: "no answer".
    {
      names: ["豊洲シビックセンター", "豊洲文化センター", "Toyosu Civic Center"],
      address: "〒135-0061 東京都江東区豊洲2丁目2 豊洲シビックセンター",
      streets: ["東京都江東区豊洲2丁目2"],
      point: { lat: 35.6542678, lng: 139.7953648 },
    },
    // ORE Hiroo Bldg 2F, Minami-Azabu 5-chome: the sheet names the venue "ファミリーマート広尾駅前" (a studio on the 2nd floor
    // above that FamilyMart; 情報: "Venue: 東京都港区南麻布5-10-26 ORE広尾ビル2F"). Point: OSM node 3340940536 "ファミリーマート", 南麻布五丁目,
    // 106-0047 (Nominatim, 2026-11-07), 5 m from the sheet's Google Maps link. Refused: "low confidence 0
    // (building)". Stored under "ORE広尾ビル 2F" (canonical): the FamilyMart is the ground-floor shop, not the hall
    // (coverage 11-10 daily check; D-1242).
    {
      names: ["ORE広尾ビル 2F", "ファミリーマート広尾駅前", "ORE広尾ビル"],
      address: "〒106-0047 東京都港区南麻布5-10-26 ORE広尾ビル2F",
      streets: ["東京都港区南麻布5-10-26"],
      point: { lat: 35.6528393, lng: 139.7223769 },
      canonical: true,
    },
    // Diego y Aldana Studio (EL TANGO), ESPACE2 B1, Yutenji 2-chome (Meguro). Address: the sheet's 情報 text (目黒区祐天寺2丁目
    // 15番16号B1); postcode from its Google Maps link (〒153-0052 目黒区祐天寺2丁目15−16 ESPACE2). Point: that link's pin
    // (3d35.6359589 4d139.6900008), in 祐天寺二丁目 (Nominatim reverse, 2026-11-07). Unplaced on read 42420733466.
    {
      names: ["Diego y Aldana Studio", "Diego & Aldana Studio", "EL TANGO Diego y Aldana"],
      address: "〒153-0052 東京都目黒区祐天寺2-15-16 ESPACE2 B1",
      point: { lat: 35.6359589, lng: 139.6900008 },
    },
    // Caminito Sangenjaya (CAMINITO SANCHA), Station Plaza Royal 5F, Sangenjaya 1-chome. Address: the sheet's 情報
    // text. Point: the sheet's Google Maps link (3d35.6434425 4d139.6713758), 9 m from OSM node 1984756240, tagged
    // 三軒茶屋一丁目 38-8, 154-0024 (Nominatim, 2026-11-07). Refused: "low confidence 0.01 (amenity)".
    {
      names: [
        "カミニート三軒茶屋スタジオ",
        "CAMINITO SANCHA",
        "Caminito Sangenjaya",
        "Studio Caminito Sangenjaya",
      ],
      address: "〒154-0024 東京都世田谷区三軒茶屋1-38-8 ステーションプラザロイヤル5F",
      streets: ["東京都世田谷区三軒茶屋1-38-8ステーションプラザロイヤル5 F"],
      point: { lat: 35.6434425, lng: 139.6713758 },
    },
    // STUDIO ICA plus, Legatos Bunkyo B1F, Sengoku 4-chome. Address: the sheet's 情報 text; postcode from Nominatim.
    // Point: the sheet's Google Maps link (3d35.7288073 4d139.7384984), in 千石四丁目, 112-0011 (Nominatim reverse,
    // 2026-11-07). Refused: "too vague (postcode, confidence 0)".
    {
      names: ["STUDIO ICA plus", "ICA plus"],
      address: "〒112-0011 東京都文京区千石4-7-2 レガトス文京104 B1F",
      streets: ["東京都文京区千石4-7-2"],
      point: { lat: 35.7288073, lng: 139.7384984 },
    },
    // ---- RA clubs (RA venue address, as written in the report). Rows with an RA postcode match by it; the rest by
    // "streets".
    // T2 Shinjuku, Shinjuku Kaleido Bldg 7F, Nishi-Shinjuku 7-chome. Address: RA ("7F, 7-1-1 Nishi-Shinjuku");
    // building and postcode from OSM way 154291617 "新宿カレイドビル", tagged 西新宿7丁目1-1, 160-0023. Point: that building
    // (Overpass, 2026-11-07); RA's point is rounded (35.7, 139.7). Refused: "too vague (suburb, confidence 0.11)".
    {
      names: ["T2 Shinjuku", "T2"],
      address: "〒160-0023 東京都新宿区西新宿7-1-1 新宿カレイドビル7F",
      streets: ["7-1-1 Nishi-Shinjuku"],
      point: { lat: 35.6941022, lng: 139.6992649 },
    },
    // Enter Shibuya, GEMS Jingumae 6F, Jingumae 6-chome. Address: RA; OSM agrees. Point: OSM node 13108533376
    // "Enter", nightclub, tagged 神宮前六丁目19-17, 150-0001 (Nominatim, 2026-11-07). Refused: "too vague (postcode,
    // confidence 1)".
    {
      names: ["Enter Shibuya", "Enter"],
      address: "〒150-0001 東京都渋谷区神宮前6-19-17 GEMS神宮前6F",
      point: { lat: 35.6636995, lng: 139.7023743 },
    },
    // Numm, AiiA Annex Bldg B1F, Shibuya 2-chome. Address: RA; OSM agrees. Point: OSM node 5350345208 "Numm",
    // nightclub, tagged 渋谷2-9-13 Aiia Annex Bldg B1F, 150-0002 (Nominatim, 2026-11-07). Refused: "too vague (suburb,
    // confidence 0.67)".
    {
      names: ["Numm"],
      address: "〒150-0002 東京都渋谷区渋谷2-9-13 AiiA ANEX B1F",
      point: { lat: 35.6608618, lng: 139.7076404 },
    },
    // ZEROTOKYO, Tokyu Kabukicho Tower B1-B4, Kabukicho 1-chome. Address: RA; postcode from OSM. Point: OSM way
    // 852000385 "東急歌舞伎町タワー", tagged 歌舞伎町一丁目29-1, 160-0021 (Nominatim, 2026-11-07). Refused: "low confidence 0
    // (building)".
    {
      names: ["ZEROTOKYO", "ZERO TOKYO"],
      address: "〒160-0021 東京都新宿区歌舞伎町1-29-1 東急歌舞伎町タワーB1-B4",
      streets: ["B1-B4 Tokyu Kabukicho Tower"],
      point: { lat: 35.6959352, lng: 139.7006566 },
    },
    // Dogenzaka Church (道玄坂教会 The Church), Central Kyoritsu Bldg 1F, Dogenzaka 2-chome. Address: RA. Point: OSM way
    // 627697960 "道玄坂教会 The Church", building:name セントラル共立ビル, 道玄坂二丁目 (Nominatim, 2026-11-07). Refused: "no answer".
    {
      names: ["Dogenzaka Church", "道玄坂教会", "The Church"],
      address: "〒150-0043 東京都渋谷区道玄坂2-16-5 セントラル共立ビル1F",
      point: { lat: 35.6586321, lng: 139.6968638 },
    },
    // Yodo Groove, Yodobashi HD Ikebukuro Bldg (rooftop), Minami-Ikebukuro 1-chome. Address: RA; OSM agrees. Point:
    // OSM relation 4853211 "ヨドバシHD池袋ビル", tagged 南池袋一丁目28-1, 171-8569 (Overpass, 2026-11-07). Refused: "low confidence
    // 0 (building)".
    {
      names: ["Yodo Groove (Yodobashi Ikebukuro)", "Yodo Groove"],
      address: "〒171-8569 東京都豊島区南池袋1-28-1 ヨドバシHD池袋ビル",
      point: { lat: 35.72894, lng: 139.7116998 },
    },
    // Wild Side Tokyo, Kaizuka Bldg B1, Shinjuku 1-chome. Address: RA. Point: OSM node 10600540874 "Wild Side",
    // tagged 新宿1丁目34-13, 160-0022 (Overpass, 2026-11-07). Refused: "low confidence 0 (building)".
    {
      names: ["Wildsidetokyo", "Wild Side", "Wild Side Tokyo"],
      address: "〒160-0022 東京都新宿区新宿1-34-13 貝塚ビルB1",
      streets: ["東京都新宿区新宿1-34-13"],
      point: { lat: 35.6913277, lng: 139.7108677 },
    },
    // TK NIGHTCLUB SHIBUYA, Chitose Kaikan B1F, Udagawacho. Address: RA. Point: OSM node 5066862922 "TK NIGHTCLUB
    // SHIBUYA", nightclub, 宇田川町 (Nominatim, 2026-11-07). Refused: "low confidence 0 (amenity)".
    {
      names: ["TK Nightclub", "TK NIGHTCLUB SHIBUYA"],
      address: "〒150-0042 東京都渋谷区宇田川町13-8 Chitosekaikan B1F",
      point: { lat: 35.6610263, lng: 139.6985692 },
    },
    // PBOX STND, Shibuya PARCO 10F rooftop, Udagawacho. Address: RA ("東京都渋谷区宇田川町15-1-10F ROOFTOP"). Point: OSM way
    // 451564412 "渋谷Parco", tagged 宇田川町15-1, 150-8377 (Overpass, 2026-11-07). Refused: "no answer".
    {
      names: ["PBOX STND", "PBOX"],
      address: "〒150-8377 東京都渋谷区宇田川町15-1 渋谷PARCO 10F",
      streets: ["東京都渋谷区宇田川町15-1-10F ROOFTOP"],
      point: { lat: 35.6619509, lng: 139.6987706 },
    },
    // ---- RA clubs placed at RA's own point on read 42420733466 ("no building-level answer ... the listed point is
    // used"): a checked point instead.
    // WOMB, Maruyamacho. Address: RA. Point: OSM node 1773640267 "Womb", tagged 円山町2-16, 150-0044 (Nominatim,
    // 2026-11-07).
    {
      names: ["WOMB", "WOMB Tokyo"],
      address: "〒150-0044 東京都渋谷区円山町2-16",
      point: { lat: 35.6584259, lng: 139.6950494 },
    },
    // Circus Tokyo, Shibuya 3-chome. Address: RA. Point: OSM node 5323416499 "Circus Tokyo", tagged 渋谷3-26-16,
    // 150-0002 (Nominatim, 2026-11-07).
    {
      names: ["Circus Tokyo", "Circus"],
      address: "〒150-0002 東京都渋谷区渋谷3-26-16 1F・B1F",
      point: { lat: 35.6541103, lng: 139.7055564 },
    },
    // club asia, Maruyamacho. Address: RA ("1-8 Maruyamacho"). Point: OSM node 11909862962 "club asia", nightclub,
    // 円山町 (Nominatim, 2026-11-07).
    {
      names: ["club asia", "clubasia"],
      address: "〒150-0044 東京都渋谷区円山町1-8",
      point: { lat: 35.6590126, lng: 139.695328 },
    },
    // SEL OCTAGON TOKYO, Axall Roppongi B1F, Roppongi 7-chome. Address: RA. Point: OSM node 12959652901 "Sel Octagon
    // Tokyo night club", 六本木七丁目 (Nominatim, 2026-11-07).
    {
      names: ["SEL OCTAGON TOKYO", "SEL OCTAGON"],
      address: "〒106-0032 東京都港区六本木7-8-6 Axall Roppongi B1F",
      point: { lat: 35.6649473, lng: 139.7298302 },
    },
    // Nakano Heavysick Zero, Carsk Nakano B1, Nakano 5-chome. Address: RA ("5Chome-41-8,Nakano"); postcode of 中野
    // (zipcloud, 2026-11-07). Point: OSM node 13112623600 "heavysick ZERO", tagged 中野五丁目41-8 (Nominatim, 2026-11-07).
    {
      names: ["Nakano Heavysick Zero", "heavysick ZERO"],
      address: "〒164-0001 東京都中野区中野5-41-8 カースク中野B1",
      streets: ["5Chome-41-8,Nakano"],
      point: { lat: 35.709808, lng: 139.6678684 },
    },
    // VENT, Festae Omotesando Bldg B1F, Minami-Aoyama 3-chome. Address: RA; OSM agrees. Point: OSM node 5323594668
    // "Vent", tagged 南青山三丁目18-19, 107-0062 (Nominatim, 2026-11-07).
    {
      names: ["VENT", "VENT Tokyo"],
      address: "〒107-0062 東京都港区南青山3-18-19 Festae Omotesando Building B1F",
      point: { lat: 35.6651742, lng: 139.7128558 },
    },
    // Koenji Cave (DJ's bar Koenji Cave), Koenji-Minami 4-chome. Address: RA (4-23-5 Koenjiminami). Point: OSM node
    // 10833072805 "DJ's bar Koenji Cave", 高円寺南四丁目 (Nominatim, 2026-11-07).
    {
      names: ["Koenji Cave", "DJ's bar Koenji Cave"],
      address: "〒166-0003 東京都杉並区高円寺南4-23-5",
      point: { lat: 35.7036943, lng: 139.6497578 },
    },
    // Koara, Jinnan 1-chome. Address: RA. Point: OSM node 5044923323 "Koara", tagged 神南一丁目13-15 (Overpass,
    // 2026-11-07).
    {
      names: ["Koara"],
      address: "〒150-0041 東京都渋谷区神南1-13-15",
      point: { lat: 35.6639409, lng: 139.7001216 },
    },
    // White Space Lab, Maruyamacho. Address: RA. Point: OSM node 10976009506 "White Space Lab", tagged 円山町2-20
    // (Overpass, 2026-11-07).
    {
      names: ["White Space Lab"],
      address: "〒150-0044 東京都渋谷区円山町2-20",
      point: { lat: 35.6587483, lng: 139.6949062 },
    },
    // Warp Shinjuku, Kabukicho 1-chome. Address: RA (1-21-1 Kabukicho). Point: OSM node 6908654985 "Warp", nightclub,
    // 歌舞伎町一丁目 (Nominatim, 2026-11-07).
    {
      names: ["Warp Shinjuku", "Warp"],
      address: "〒160-0021 東京都新宿区歌舞伎町1-21-1",
      point: { lat: 35.695048, lng: 139.7012728 },
    },
    // ---- Batch 2 (2026-11-07): venues left out of batch 1, now checked on their own sites.
    // BRAND SHIBUYA, Shibuya Deli Tower B1F, Dogenzaka 2-chome. Address: RA (brand-club-bar.com/access.php writes the
    // same, 〒150-0043 東京都渋谷区道玄坂2丁目23-13 渋谷デリタワー B1F). Point: the Google Maps place link on its own access page
    // (BRAND SHIBUYA, 3d35.6601085 4d139.6961331), in 道玄坂二丁目 (Nominatim reverse: OSM node 6918877485, 2026-11-07). No OSM
    // building with 23-13. Refused: RA's point is 36,140 (rounded); 13 rows unplaced.
    {
      names: ["BRAND SHIBUYA", "BRAND", "ブランド渋谷"],
      address: "〒150-0043 東京都渋谷区道玄坂2-23-13 渋谷デリタワービルB1F",
      streets: ["東京都渋谷区道玄坂2-23-13", "2 Chome−23−13 渋谷デリタワービル"],
      point: { lat: 35.6601085, lng: 139.6961331 },
    },
    // ZUBAR (頭バー), ZU Bldg 1F, Kitamagome 2-chome (moved from Shibuya in 2025). Address: RA (zubar.jp/contact-us writes
    // 〒143-0021 東京都大田区北馬込2-54-4 ZU Bldg. 1F). Point: the Google Maps place link on zubar.jp (頭バー, 3d35.6002151
    // 4d139.7124236), in 北馬込二丁目 (Overpass is_in, 2026-11-07). Not in OSM. Refused: RA's point is 0,0; 9 rows unplaced.
    {
      names: ["ZUBAR", "頭バー", "ZU BAR", "Zu-Bar"],
      address: "〒143-0021 東京都大田区北馬込2-54-4 ZU Bldg 1F",
      streets: ["東京都大田区北馬込2-54-4", " 2-54-4 Kitamagome"],
      point: { lat: 35.6002151, lng: 139.7124236 },
    },
    // Z MARUYAMA (by WOMB), Dr. Jeekahn's Bldg 1F, Maruyamacho. Address: RA (z-maruyama.jp/ja/night/access writes
    // 〒150-0044 東京都渋谷区円山町2-4 ドクタージーカンズビル1F). Point: the Google Maps link on its own access page (address
    // pin, 3d35.6583056 4d139.6952744; its map embed for "Z MARUYAMA" is centred on the same point), in 円山町 (Nominatim
    // reverse: OSM way 136558435, 2026-11-07). Refused: RA's point is 35.66,139.7 (rounded); 7 rows unplaced.
    {
      names: ["Z Maruyama", "Z MARUYAMA", "ゼットマルヤマ"],
      address: "〒150-0044 東京都渋谷区円山町2-4 ドクタージーカンズビル1F",
      streets: ["東京都渋谷区円山町2-4", " 2-4 Maruyamacho"],
      point: { lat: 35.6583056, lng: 139.6952744 },
    },
    // Ritmo (Tango Studio Ritmo, リトゥモ), Wasō Gakuin Bldg 1F, Nakazato 1-chome. Address: tangoritmo.com (東京都 北区中里
    // 1-9-7 和装学院ビル1F); postcode from zipcloud. Point: the sheet's Google Maps link (Tango Studio Ritmo, 3d35.7371086
    // 4d139.7502946), in 中里一丁目 (Overpass is_in, 2026-11-07), 30 m from OSM node 4101393853 at 中里1-7-1. 12 rows on
    // the sheet (8 unplaced on read 42420733466).
    {
      names: ["リトゥモ", "Ritmo", "Tango Studio Ritmo", "タンゴスタジオ リトゥモ"],
      address: "〒114-0015 東京都北区中里1-9-7 和装学院ビル1F",
      streets: ["東京都北区中里1-9-7"],
      point: { lat: 35.7371086, lng: 139.7502946 },
    },
    // SinRumbo (ARGENTINA BAR シンルンボ / Corazón de Tango), Villa Art Yotsuya 2F, Yotsuya-San'eicho. Address:
    // corazon-de-tango.com (〒160-0008 東京都新宿区四谷三栄町15番3号ヴィラアート四谷2階, written here as 15-3). Point: the
    // sheet's Google Maps link on the シンルンボ rows (ARGENTINA BAR SinRumbo, 3d35.687968 4d139.7268242). The map embed on
    // corazon-de-tango.com/access.html is the same point (q=35.687967,139.726819, under 1 m away), and OSM node 12619468729
    // "Sin Rumbo" is 5 m away. Overpass is_in puts the point inside the 四谷三栄町 polygon; Nominatim's "四谷二丁目" is
    // its nearest neighbourhood node. So the batch-1 conflict is settled for the venue's own site; Tokyo Gig Guide agrees
    // (三栄町15-3). Tabelog's "三栄町7" is not used. The "SinRumbo" rows' link (…k2f77) is dead (no redirect); the
    // シンルンボ rows' link (…k2f7) works.
    {
      names: ["SinRumbo", "シンルンボ", "Sin Rumbo", "ARGENTINA BAR SinRumbo", "シン・ルンボ"],
      address: "〒160-0008 東京都新宿区四谷三栄町15-3 ヴィラアート四谷2F",
      streets: ["東京都新宿区四谷三栄町15-3"],
      point: { lat: 35.687968, lng: 139.7268242 },
    },
    // PARA DOS TANGO STUDIO, J Akasaka Bldg 301, Akasaka 6-chome. Address: paradostango.jp (〒107-0052 東京都港区赤坂6-3-15
    // J赤坂ビル301; its map embed is a text query for 赤坂6-3-15, so it has no coordinates). Point: the sheet's Google Maps link
    // (Tango Studio Para Dos, 3d35.6710511 4d139.7352305), in 赤坂六丁目 (Overpass is_in, 2026-11-07), 31 m from OSM way
    // 146277353 at 赤坂6-3-17 (the next house number). The 15th-anniversary milonga (MARRYGRANT AKASAKA, 赤坂2-14-5) is
    // a different venue, not this entry. 9 sheet rows.
    {
      names: [
        "PARA DOS TANGO STUDIO",
        "Para Dos",
        "Para Dos Tango Studio",
        "Tango Studio Para Dos",
        "パラドス",
      ],
      address: "〒107-0052 東京都港区赤坂6-3-15 J赤坂ビル301",
      streets: ["東京都港区赤坂6-3-15"],
      point: { lat: 35.6710511, lng: 139.7352305 },
    },
    // studio RADA, Nihonbashi Bldg 4F, Nihonbashi-Muromachi 1-chome. Address: studiorada.com/access.php (〒103-0022
    // 東京都中央区日本橋室町1-1-5 日本橋ビル4F); zipcloud agrees on the postcode. Point: the sheet's Google Maps link (studio RADA,
    // 3d35.684432 4d139.7738019), in 日本橋室町一丁目 (Overpass is_in, 2026-11-07). The site's own Google link is only a
    // chōme pin (1-chōme-1, 3d35.6846086 4d139.7731316, 64 m west), so it is not used. No OSM building with 1-1-5. 7 sheet rows.
    {
      names: ["studio RADA", "Studio RADA", "スタジオラダ"],
      address: "〒103-0022 東京都中央区日本橋室町1-1-5 日本橋ビル4F",
      streets: ["東京都中央区日本橋室町1-1-5"],
      point: { lat: 35.684432, lng: 139.7738019 },
    },
    // Efecto Tango (EFECTO TANGO studio), Sky Palace Bldg, Takadanobaba 1-chome. Address: efectotango.net (〒169-0075
    // 東京都新宿区高田馬場1-29-7, スカイパレスビル on its own Google link). Point: the sheet's Google Maps link (EFECTO TANGO,
    // 3d35.7106825 4d139.7042606), in 高田馬場一丁目 (Overpass is_in, 2026-11-07). The address pin on efectotango.net's own
    // Google link (3d35.7106962 4d139.7041609) is 9 m away, and OSM node 1655929300 at 高田馬場1-29-20 is 17 m away. 9 sheet
    // rows over 3 spellings.
    {
      names: [
        "Efecto Tango Studio",
        "Efecto Tango",
        "Efecto tango",
        "EFECTO TANGO",
        "Effect Tango",
        "エフェクトタンゴ",
      ],
      address: "〒169-0075 東京都新宿区高田馬場1-29-7 スカイパレスビル",
      streets: ["東京都新宿区高田馬場1-29-7"],
      point: { lat: 35.7106825, lng: 139.7042606 },
    },
    // Gotanda SoyLatte Studio (SoyLatte STUDIO BASE), Kanno Bldg 3F, Nishi-Gotanda 2-chome. Address: soylatte-studio.net
    // and /base/ (〒141-0031 東京都品川区西五反田2-17-8 管野ビル3F; Meetup writes "Sugano building"). Point: the map marker
    // in the site's own script (assets/js/common.js, #studio_base LatLng 35.62645409520181,139.72125734240132), in
    // 西五反田二丁目 (Overpass is_in; Nominatim reverse: OSM way 208046353, 2026-11-07). No OSM building with 17-8.
    // Refused (Meetup): "with no postcode; left unplaced".
    {
      names: [
        "Gotanda SoyLatte Studio",
        "SoyLatte Studio",
        "SoyLatte STUDIO",
        "Soylatte STUDIO BASE",
        "ソイラテスタジオ",
      ],
      address: "〒141-0031 東京都品川区西五反田2-17-8 管野ビル3F",
      streets: ["東京都品川区西五反田2-17-8", " 2-17-8 Nishigotanda"],
      point: { lat: 35.6264541, lng: 139.7212573 },
    },
    // La Rumba (Ikebukuro Latin Club La Rumba, ラ・ルンバ), Chante Bldg B1, Ikebukuro 2-chome. Address: its own site
    // salsalarumba.web.fc2.com/access.html (〒171-0014 東京都豊島区池袋2丁目23−2 シャンテビルB1; one line there writes 〒163-0000, a
    // typo). Point: the marker in the site's own map script (hpbmapscript2.js, lat 35.732745 lng 139.704597, 2015), in
    // 池袋二丁目 (Overpass is_in, 2026-11-07; Nominatim reverse names the nearest road, 西池袋五丁目). Not in OSM.
    {
      names: [
        "La Rumba",
        "Ikebukuro Latin Club La Rumba",
        "La Rumba Ikebukuro",
        "池袋la Rumba",
        "ラ・ルンバ",
      ],
      address: "〒171-0014 東京都豊島区池袋2-23-2 シャンテビルB1",
      streets: ["東京都豊島区池袋2-23-2", " 2-23-2 Ikebukuro"],
      point: { lat: 35.732745, lng: 139.704597 },
    },
    // Dance Studio Linda, ASA Higashiyama Bldg 1F B-1, Higashiyama 1-chome (Nakameguro). Address: dancestudio-linda.com/
    // access (〒153-0043 東京都目黒区東山1-4-13 ASA東山ビル1F B-1); zipcloud agrees on the postcode. Point: the centre of the
    // site's own Google map embed for the place "Dance Studio Linda" (3d35.6471 2d139.6945215; lat only to 4 decimals,
    // about 10 m), in 東山一丁目 (Overpass is_in, 2026-11-07). Not in OSM. Meetup rows: "taken off the site" by the 京都 bug
    // (see batch-1 notes); this entry does not fix that.
    {
      names: ["Dance Studio Linda", "Dance Studio Linda 中目黒", "ダンススタジオリンダ"],
      address: "〒153-0043 東京都目黒区東山1-4-13 ASA東山ビル1F",
      streets: ["東京都目黒区東山1-4-13"],
      point: { lat: 35.6471, lng: 139.6945215 },
    },
    // OATH, B1F, Dogenzaka 1-chome (moved from Shibuya 4-chome). Address: RA's venue text "1-6-5-B1F Dogenzaka,
    // Shibuya-ku, Tokyo, 150-0043" (2024-2026 events). Point: the GSI address geocoder (msearch.gsi.go.jp) for
    // 東京都渋谷区道玄坂一丁目6番5号, house-number level (2026-11-10). OSM's "Oath" node 4752151825 is the old Shibuya
    // 4-chome site: not used. 3 RA rows unplaced on read 42712117628 (D-1240).
    {
      names: ["OATH", "Oath", "オース"],
      address: "〒150-0043 東京都渋谷区道玄坂1-6-5 B1F",
      streets: ["東京都渋谷区道玄坂1-6-5", "1-6-5 Dogenzaka"],
      point: { lat: 35.657711, lng: 139.699249 },
    },
  ],
  austin: [],
};
