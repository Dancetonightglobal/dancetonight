// Every UI string, English only in v1 (SPEC section 2). Plain, sentence case, from the
// dancer's point of view (CLAUDE.md): "Not listed", never "N/A"; buttons say what they do.
// This file is the single source of dancer-facing copy: the domain layer (src/domain/tonight.ts,
// src/domain/time.ts) composes its status lines, day labels and time ranges through t() from here.
//
// Rules the strings follow (tests/unit/i18n.test.ts enforces them):
// - Keys are dot-namespaced by screen, then element (home.header.tonight, card.status.onNow).
// - `{name}` is a placeholder filled by `t()`; values arrive already formatted (times, prices,
//   distances and durations go through Intl in the caller, so a string never assumes a unit).
// - A leaf is either a string or a plural set { zero?, one, other } chosen by `{count}`.
// - Every string starts with a capital letter, a digit or a placeholder. The two exceptions
//   (`detail.sources.checked`, `detail.sources.updated`) are fragments printed after a source name
//   on the same line, exactly as the detail wireframe draws them (DESIGN.md section 7).
// - A string ends with a full stop only when it is a sentence of at least three words.
//   Labels, headings, values and buttons never end with punctuation.
// - Display uppercase ("WHEN", "MIDTOWN SUNDAY HOP") is CSS `text-transform`; the DOM and these
//   strings keep sentence case (DESIGN.md section 11).

export const en = {
  common: {
    siteName: "DanceTonight",
    // Every page title: "{page}" is the page's own title (D-069). The home page fills it itself,
    // because the layout's template does not reach a page in the layout's own segment (D-076).
    titleTemplate: "{page} · {site}",
    tagline: "Where can I dance tonight, near me?",
    notListed: "Not listed",
    free: "Free",
    back: "Back",
    close: "Close",
    cancel: "Cancel",
    save: "Save changes",
    loading: "Loading",
    optional: "Optional",
  },

  home: {
    loading: "Loading",
    header: {
      tonight: "Tonight near {place}",
      tomorrow: "Tomorrow near {place}",
      day: "{day} near {place}",
      count: {
        zero: "No places to dance",
        one: "1 place to dance",
        other: "{count} places to dance",
      },
      menu: "Menu",
      // A city read on demand (D-899): what the line under the count says while its read runs.
      refresh: {
        updated: "Last updated {ago}",
        updating: "Last updated {ago}; updating now",
        updatingFirst: "Updating now",
        ready: "Updated just now",
        reload: "Show the new listings",
      },
      city: {
        // Heard, never seen: the button's accessible name, the city then what tapping does.
        button: "{place}, change city",
        choose: "Choose a city",
        current: "Showing now",
        comingSoon: "Coming soon",
      },
    },
    location: {
      useExact: "Use my exact location",
      searchLabel: "Search events, venues and dance styles",
      searchPlaceholder: "Event, venue or style",
      searchButton: "Search",
      clearButton: "Clear",
      locating: "Finding your location",
      approximate: "Showing places near {place}. Use your exact location for better distances.",
      denied: "Location access was declined. Search for a place instead.",
      unavailable: "We couldn't get your location. Search for a place instead.",
      noMetro: "We don't list places here yet",
      noMetroLink: "Show places near {place}",
      usingYours: "Showing places near you",
      remembered: "Last time you looked near {place}",
      noResults: "We can't look up {query} yet. Showing places near {place}.",
      noResultsOutside: "We can't look up {query} yet.",
    },
    day: {
      label: "Which night",
      tonight: "Tonight",
      tomorrow: "Tomorrow",
      // The night still in progress before 06:00, once the calendar has moved on (D-518).
      lastNight: "Last night",
      // Heard, never seen: the link's accessible name. It keeps the comma after a date's own
      // ("Wed, Sep 30, 7 places"): a screen reader pauses at a comma, and is not sure to at a
      // middle dot, which would run "Sep 30" into "7 places" (D-072).
      option: {
        one: "{day}, 1 place",
        other: "{day}, {count} places",
      },
      // A link to a night the page does not open: it shows tonight and says why (audit F16).
      unopened: {
        over: "{day} is over. Showing tonight.",
        notYet: "We don't list {day} yet. Showing tonight.",
        notADate: "We can't read the night in this link. Showing tonight.",
      },
    },
    theme: {
      label: "Theme",
      system: "Match my device",
      light: "Light",
      dark: "Dark",
    },
    segments: {
      label: "Kind of dancing",
      all: { full: "All", short: "All" },
      social: { full: "Social dancing", short: "Social" },
      clubs: { full: "Clubs and DJ nights", short: "Clubs" },
      classes: { full: "Classes", short: "Classes" },
      other: { full: "Other", short: "Other" },
    },
    styles: {
      label: "Styles",
      chip: {
        one: "{family}, 1 place",
        other: "{family}, {count} places",
      },
      chipSelected: {
        one: "{family}, 1 place, selected",
        other: "{family}, {count} places, selected",
      },
      more: {
        one: "1 more style",
        other: "{count} more styles",
      },
      showAll: "Show all styles",
      clear: "Clear styles",
    },
    filters: {
      open: "More filters",
      title: "Filters",
      radius: "Distance",
      radiusWithin: "Within {distance}",
      price: "Price",
      anyPrice: "Any price",
      free: "Free",
      under: "Under {price}",
      beginnerFriendly: "Beginner friendly",
      lessonIncluded: "Lesson included",
      noPartnerNeeded: "No partner needed",
      age: "Age",
      anyAge: "Any age",
      ageAll: "All ages",
      age18: "18+",
      age21: "21+",
      liveMusic: "Live music",
      onNow: "On now",
      // Keeps exactly the cards whose line starts with one of these two places (D-072).
      confirmedOnly: "On the organizer's or ticket page",
      applyPlain: "Show places",
      clear: "Clear filters",
      clearSearch: "Clear search",
      // Back to the metro's whole reach, where listings with no location are listed (D-082).
      clearDistance: "Clear distance",
      close: "Close filters",
      active: {
        one: "1 filter on",
        other: "{count} filters on",
      },
    },
    sort: {
      label: "Sort",
      startTime: "Start time",
      distance: "Distance",
      byStartTime: "Sort: start time",
      byDistance: "Sort: distance",
    },
    view: {
      label: "List or map",
      list: "List",
      map: "Map",
    },
    now: {
      marker: "Now {time}",
      sticky: "Now {time}",
      backToNow: "Back to now",
      jumpToNow: "Jump to now",
    },
    empty: {
      quietAfter: "Quiet after {time}. Showing tomorrow too, and places within {distance}.",
      widened: "Nothing within {from}. Showing places within {to} instead.",
      widenedAndTomorrow:
        "Nothing within {from} tonight. Showing tomorrow too, and places within {to}.",
      nothingTonight: "Nothing on tonight near {place}.",
      nothingOn: "Nothing on {day} near {place}.",
      noMatch: {
        one: "1 place is on, but not with these filters.",
        other: "{count} places are on, but none with these filters.",
      },
      // The search box hid every listing on the night: said with the words typed, and the way
      // out clears the search alone, leaving the filters as they were.
      noSearchMatch: {
        one: "Nothing matches “{query}”. 1 place is on this night.",
        other: "Nothing matches “{query}”. {count} places are on this night.",
      },
      // A night with nothing within the distance the dancer chose, and listings with no location,
      // which no distance can claim (D-082): said in place of "Nothing on", which would be untrue.
      unplacedHidden: {
        one: "1 more has no location listed.",
        other: "{count} more have no location listed.",
      },
      showingTomorrow: "Showing tomorrow too.",
      tomorrowHeading: "Tomorrow",
      addIt: "Know a night we missed? Add it.",
      addLink: "Add it",
    },
    // The group after the last hour on the start-time bill (DESIGN.md section 5, D-060).
    untimed: {
      heading: "Time not listed",
    },
  },

  card: {
    // The live status line, composed by liveStatus() in src/domain/tonight.ts. {time} is always
    // the start clock time, {until} the end clock time and {duration} a countdown.
    status: {
      startsIn: "Starts in {duration}, until {until}",
      startsInEndNotListed: "Starts in {duration}",
      startsAt: "Starts at {time}",
      startsAtUntil: "Starts at {time}, until {until}",
      onNow: "On now until {until}",
      onNowEndNotListed: "On now",
      endsIn: "Ends in {duration}",
      ended: "Ended",
      cancelled: "Cancelled tonight",
      cancelledOtherNight: "Cancelled",
      endNotListed: "End not listed",
      // A listing whose source gives a date and no time (D-060). Never a countdown.
      timeNotListed: "Time not listed",
      timeNotListedUntil: "Time not listed, until {until}",
    },
    // The stamped-time slot of a card whose time is not listed (D-060).
    stamp: {
      timeNotListed: "Time not listed",
    },
    lesson: {
      both: "Lesson {lesson}, dancing {dancing}",
      lessonOnly: "Lesson {lesson}",
      dancingOnly: "Dancing {dancing}",
      doorsOnly: "Doors {doors}",
    },
    price: {
      door: "{price} door",
      advance: "{price} advance",
      from: "From {price}",
      flat: "{price}",
      lessonOnly: "{price} lesson only",
      free: "Free",
      freeLesson: "Free lesson",
    },
    // The confirmation line says where the listing was checked (D-072): the organizer's own page
    // or a ticket seller's page confirms tonight (a ticket seller is not the organizer); any
    // other source only says when it was read.
    flags: {
      onOrganizerPage: "On the organizer's page, checked {ago}",
      onTicketPage: "On the ticket page, checked {ago}",
      listingChecked: "Listing checked {ago}",
      checkBeforeYouGo: "Check before you go",
      noPartnerNeeded: "No partner needed",
      recurringUnconfirmed: "Not confirmed for tonight",
      sourcesDisagree: "Sources disagree on the times",
      beginnerFriendly: "Beginner friendly",
      lessonIncluded: "Lesson included",
      liveMusic: "Live music",
      outdoor: "Outdoors",
      venueOpenNight: "Open tonight, no set event",
    },
    place: {
      venueAndNeighborhood: "{venue}, {neighborhood}",
      // A listing whose venue could not be placed on the map (D-082): no pin, no distance.
      locationNotListed: "Location not listed",
      distance: "{distance} away",
    },
    // Short chip labels, one per key in src/domain/listing-types.ts (camelCased). config/styles.ts
    // reads these; detail.types holds the long forms for the detail title block.
    types: {
      social: "Social",
      class: "Class",
      clubNight: "Club or DJ night",
      practica: "Práctica",
      liveMusicWithDancing: "Live music with dancing",
      festivalSession: "Festival session",
      outdoorPublic: "Outdoors",
      jam: "Jam",
      venueOpenNight: "Open night",
      other: "Other",
    },
  },

  detail: {
    // The link at the top left, back to the night the listing is on (D-069).
    back: {
      tonight: "Back to tonight",
      tomorrow: "Back to tomorrow",
      day: "Back to {day}",
    },
    // The date line under the title (D-069). {date} is formatCalendarDate's "Sat, Oct 3"; {day} is
    // the whole line before the flag ("Tonight · Mon, Sep 28" or "Thu, Oct 1"). A date carries its
    // own comma in US order, so what joins it to a word is a middle dot, never a second comma
    // (D-072): "Tonight · Mon, Sep 28", "Thu, Oct 1 · Cancelled".
    date: {
      tonight: "Tonight · {date}",
      tomorrow: "Tomorrow · {date}",
      cancelled: "{day} · Cancelled",
      ended: "{day} · Ended",
    },
    // The tab title and the share sheet's title: dated, so a bookmark or a shared link names the
    // night rather than saying "tonight" on the wrong day (D-069). Joined like the date line, so
    // the tab reads "Tango Cafe · Wed, Sep 30 · DanceTonight" (D-072).
    pageTitle: "{title} · {date}",
    // Long listing-type labels for the title block (DESIGN.md section 7), one per key in
    // src/domain/listing-types.ts (camelCased), matching card.types key for key.
    types: {
      social: "Social dance",
      class: "Class",
      clubNight: "Club or DJ night",
      practica: "Práctica",
      liveMusicWithDancing: "Live music with dancing",
      festivalSession: "Festival session",
      outdoorPublic: "Outdoor public dance",
      jam: "Jam",
      venueOpenNight: "Venue open night",
      other: "Other",
    },
    recurrence: {
      every: "Every {day}",
      everyOther: "Every other {day}",
      monthly: "{ordinal} {day} of the month",
      oneOff: "One night only",
    },
    when: {
      heading: "When",
      doors: "Doors",
      lesson: "Lesson",
      lessonBeginnerFriendly: "Lesson, beginner friendly",
      dancingStarts: "Dancing starts",
      ends: "Ends",
      endNotListed: "End not listed",
      timeNotListed: "Time not listed",
      range: "{from} to {to}",
      rangeEndNotListed: "{from}, end not listed",
      timesInZone: "Times are in {zone}",
      cancelled: "Cancelled",
    },
    cost: {
      heading: "Cost",
      door: "Door",
      advance: "Advance",
      lessonOnly: "Lesson only",
      lessonPlusSocial: "Lesson plus social",
      socialOnly: "Social only",
      free: "Free",
      includes: "Includes {what}",
      // A tier and who it is for, when a source put the audience where "includes" belongs.
      tierFor: "{tier}, {who}",
      rsvpAt: "RSVP at {site}",
      paymentNotes: "Payment",
      notListed: "Cover not listed",
    },
    where: {
      heading: "Where",
      loadMap: "Show the map",
      address: "Address",
      parking: "Parking",
      indoor: "Indoor",
      outdoor: "Outdoor",
      openIn: "Open in",
      googleMaps: "Google Maps",
      appleMaps: "Apple Maps",
    },
    expect: {
      heading: "What to expect",
      level: "Level",
      levelAll: "All levels",
      levelBeginner: "Beginner",
      levelBeginnerFriendly: "Beginner friendly",
      levelIntermediate: "Intermediate",
      levelAdvanced: "Advanced",
      partner: "Partner",
      partnerNotNeeded: "Not needed",
      partnerNotNeededRotates: "Not needed; class rotates",
      partnerNeeded: "Bring a partner",
      age: "Age",
      ageAll: "All ages",
      ageMin: "{age}+",
      floor: "Floor",
      floorIndoor: "{floor}, indoor",
      floorOutdoor: "{floor}, outdoor",
      music: "Music",
      musicDj: "DJ",
      musicBand: "Live band",
      musicDjAndBand: "DJ and live band",
      musicWithMix: "{who}; {mix}",
      dressCode: "Dress code",
      crowd: "Crowd",
      crowdAbout: "About {count} people",
      crowdSmall: "Small",
      crowdMedium: "Medium",
      crowdLarge: "Large",
      notListedFields: "Not listed: {fields}.",
    },
    who: {
      heading: "Who",
      organiser: "Organizer",
      website: "Website",
      instagram: "Instagram",
      facebook: "Facebook",
      otherLinks: "More links",
    },
    summary: {
      heading: "In short",
      note: "Written by us from the listed facts",
    },
    sources: {
      heading: "Sources",
      checked: "checked {ago}",
      updated: "updated {ago}",
      conflict: "Ends {a} ({sourceA}), {b} ({sourceB})",
      conflictNote: "Sources disagree; both values are shown",
      value: "{field} {value}",
      viewSource: "Open {source}",
    },
    actions: {
      getDirections: "Get directions",
      getTickets: "Get tickets",
      rsvp: "RSVP",
      addToCalendar: "Add to calendar",
      share: "Share",
      copyLink: "Copy link",
      linkCopied: "Link copied",
      reportProblem: "Report a problem",
      suggestCorrection: "Suggest a correction",
    },
    live: {
      startsIn: "Starts in {duration}",
      onNow: "On now",
      ended: "Ended {ago}",
      cancelled: "Cancelled tonight",
    },
  },

  // The one link out a listing shows, on its card, the map's card and its page (D-073).
  links: {
    ticketsAt: "Tickets at {site}",
    eventPageAt: "Event page at {site}",
    listedOn: "Listed on {site}",
    // D-768: the card's own link failed the daily check; the card stays listed.
    notWorkingToday: "Link not working (checked today)",
    notWorkingOn: "Link not working (checked {date})",
  },
  submit: {
    title: "Add a night",
    intro: "Paste a link or the text of a listing. We draft it, you check it, then we review it.",
    url: "Link to the listing",
    urlHelp: "The organizer's page, a ticket page or a social post",
    text: "Or paste the text",
    textHelp: "The announcement, the flyer text or the post",
    noFlyer: "Flyer images can't be uploaded yet. Paste the text from the flyer instead.",
    draft: "Draft the listing",
    drafting: "Reading the listing",
    review: "Check the draft",
    reviewHelp: "Fix anything we got wrong. Leave a field as Not listed if you don't know.",
    contact: "Your email",
    contactHelp: "Only used if we have a question about this listing",
    rights: "I have the right to share this information",
    confirm: "Send for review",
    sent: "Thanks. We check every submission and it appears once approved.",
    couldNotRead: "We couldn't read that link. Paste the text instead.",
    invalidUrl: "That doesn't look like a web address",
    nothingFound: "We couldn't find a dance event in that text",
    tooLong: "That text is too long. Paste the part about the event.",
  },

  report: {
    title: "Report a problem",
    intro: "Tell us what's wrong with this listing",
    kind: "What's wrong",
    kinds: {
      problem: "Something is wrong",
      notDancing: "There's no dancing here",
      cancelled: "It's cancelled",
      duplicate: "It's listed twice",
      other: "Something else",
    },
    message: "Tell us more",
    send: "Send report",
    sending: "Sending",
    sent: "Thanks. We'll look into it.",
    failed: "We couldn't send that. Try again.",
  },

  correction: {
    title: "Suggest a correction",
    intro: "Tell us the right value and where you saw it",
    field: "What needs correcting",
    current: "Listed now",
    proposed: "Correct value",
    source: "Where you saw it",
    sourceHelp: "A link helps us check it faster",
    send: "Send correction",
    sent: "Thanks. We'll check it against the source.",
    failed: "We couldn't send that. Try again.",
  },

  remove: {
    title: "Remove your listings",
    intro: "If you run a site or an event and don't want it listed here, tell us.",
    site: "Site or page address",
    reason: "Why",
    contact: "Your email",
    send: "Ask for removal",
    sent: "Thanks. We'll remove it within a day and confirm by email.",
  },

  // The /bot page the crawler's User-Agent links to (D-021, D-069). Every sentence here is a rule
  // the crawler keeps in code: src/pipeline/http.ts (robots.txt, CRAWL_INTERVAL_MS raised by a
  // Crawl-delay, and If-None-Match / If-Modified-Since only when a stored ETag or Last-Modified
  // exists, so it never claims to skip unchanged pages) and CLAUDE.md's "facts and our own
  // summaries only". `how` is a plural leaf: its count is the interval in seconds.
  bot: {
    title: "About DanceTonightBot",
    what: "DanceTonightBot reads public dance listings so dancers can find where to dance tonight.",
    fetches:
      "It reads the public event pages, calendars and feeds that dance organizers, venues and listings sites publish. It never logs in.",
    how: {
      one: "It obeys robots.txt and makes at most one request a second to each site, or fewer when your robots.txt sets a longer Crawl-delay. When an earlier visit gave it a page's ETag or Last-Modified date, it sends them back, so your server can answer an unchanged page with a short 304 Not Modified.",
      other:
        "It obeys robots.txt and makes at most one request every {count} seconds to each site, or fewer when your robots.txt sets a longer Crawl-delay. When an earlier visit gave it a page's ETag or Last-Modified date, it sends them back, so your server can answer an unchanged page with a short 304 Not Modified.",
    },
    stores:
      "It keeps facts: names, times, places and prices, with a link back to your page. It never copies descriptions or images.",
    optOut: "To opt out, block DanceTonightBot in your robots.txt.",
    contactLead: "Questions, or want your listings removed?",
    email: "Email {email}",
    userAgent: "User agent",
  },

  footer: {
    about: "About",
    privacy: "Privacy",
    terms: "Terms",
    bot: "For site owners",
    submit: "Add a night",
    remove: "Remove a listing",
    draftNotice: "Draft, not yet reviewed",
    attribution:
      "Map by OpenFreeMap and OpenStreetMap contributors. Places from Overture Maps and GeoNames, neighborhoods from Who's On First, Pediacities, Azavea, the City of New Orleans, Quattroshapes, the City of Buenos Aires, the Ajuntament de Barcelona and ICGC, the City of Rio de Janeiro (IPP) and the Direção-Geral do Território and the US Census Bureau, Colombia's Centro Nacional de Memoria Histórica and DANE. Japanese addresses located with the GSI address search (出典：国土地理院).",
    madeFor: "Made for dancers",
  },

  admin: {
    title: "Admin",
    signIn: "Sign in",
    signInHelp: "We'll email you a sign-in link",
    signInSent: "Check your email for the link",
    signOut: "Sign out",
    notAllowed: "This email can't sign in here",
    nav: {
      metros: "Metros",
      sources: "Sources",
      moderation: "Moderation",
      flags: "Feature flags",
      budgets: "Budgets",
      blocklist: "Blocklist",
      evals: "Evals",
      costs: "Costs",
    },
    actions: {
      approve: "Approve",
      reject: "Reject",
      edit: "Edit",
      merge: "Merge",
      keepSeparate: "Keep separate",
      enable: "Enable",
      disable: "Disable",
      runNow: "Run now",
      addToBlocklist: "Add to blocklist",
    },
    queue: {
      empty: "Nothing to review",
      count: {
        zero: "Nothing waiting",
        one: "1 item waiting",
        other: "{count} items waiting",
      },
    },
    status: {
      healthy: "Healthy",
      failing: "Failing",
      disabled: "Off",
      lastRun: "Last run {ago}",
      spend: "{amount} spent today",
      overBudget: "Over budget, paused",
    },
  },

  errors: {
    notFound: "We can't find that page.",
    listingNotFound: "That listing isn't here anymore.",
    listingRemoved: "That listing was removed at the organizer's request.",
    nightPassed: "This night has passed.",
    seeTonight: "See what's on tonight",
    generic: "Something went wrong. Try again.",
    tryAgain: "Try again",
    goHome: "Back to tonight",
    rateLimited: "Too many requests. Wait a minute and try again.",
  },

  offline: {
    title: "You're offline",
    showingSaved: "Showing the places we had {ago}.",
    nothingSaved: "Nothing saved yet. Connect and try again.",
    retry: "Try again",
  },

  // The map on the home page and in WHERE (DESIGN.md sections 5 to 7, D-068).
  map: {
    loading: "Loading the map",
    // An empty map: nothing within reach, or (noMatch) places the filters hide.
    noPlaces: "No places to show",
    noMatch: "No places to show for these filters",
    // Every place on the list has no location listed, so none has a pin (D-082).
    unplacedOnly: {
      one: "1 place has no location listed. It's in the list.",
      other: "{count} places have no location listed. They're in the list.",
    },
    failed: "The map didn't load. The list still has every place.",
    retry: "Load the map again",
    showAll: "Show all",
    credits: "Map credits",
    closeCredits: "Hide map credits",
    // The slim strip across the top of the phone's map view, which is also the way back.
    strip: {
      summary: "{where} · {places}",
      // The strip when some of the list's places have no pin (D-082): "· 6 places · 1 not on the map".
      summaryUnplaced: "{where} · {places} · {unplaced}",
      notOnMap: {
        one: "1 not on the map",
        other: "{count} not on the map",
      },
      // The strip when none of the list's places has a pin (D-082): never "No places · 1 not on
      // the map", which says there is nothing and then counts it.
      allUnplaced: {
        one: "{where} · 1 not on the map",
        other: "{where} · {count} not on the map",
      },
      places: {
        zero: "No places",
        one: "1 place",
        other: "{count} places",
      },
      toList: "Show the list",
    },
    // A cluster prints the list numbers it holds: "2·3", "2–5", "1·4–6"; past seven characters,
    // the first of them and how many more it holds, "1·3·6 +4" (src/ui/map/labels.ts).
    cluster: {
      run: "{first}–{last}",
      join: "{before}·{after}",
      more: "{shown} +{count}",
    },
    // MapLibre's own words when one finger or a bare scroll wheel meets the detail page's map.
    gestures: {
      mobile: "Use two fingers to move the map",
      windows: "Hold Ctrl and scroll to zoom the map",
      mac: "Hold Command and scroll to zoom the map",
    },
  },

  a11y: {
    nowMarker: "Now, {time}",
    map: "Map of places to dance",
    mapWithCount: {
      zero: "Map, no places to show",
      one: "Map with 1 place",
      other: "Map with {count} places",
    },
    pin: "{time}, {title}",
    pinSelected: "{time}, {title}, selected",
    pinNoTime: "{title}",
    pinNoTimeSelected: "{title}, selected",
    pinCluster: {
      one: "1 place, {venues}",
      other: "{count} places, {venues}",
    },
    pinClusterNoVenue: {
      one: "1 place",
      other: "{count} places",
    },
    card: "{time}, {title}, {status}",
    cardCancelled: "{time}, {title}, cancelled",
    cardNoStatus: "{time}, {title}",
    onNowCount: {
      zero: "Nothing on right now",
      one: "1 place on now",
      other: "{count} places on now",
    },
    skipToList: "Skip to the list",
    skipToFilters: "Skip to the filters",
    selected: "{label}, selected",
    externalLink: "{label}, opens in a new tab",
    // The link beside a card: its words, then which night it is for (WCAG 2.4.4).
    eventLinkFor: "{link}, {title}",
    closeSheet: "Close",
    menu: "Menu",
  },
} as const;

export type Strings = typeof en;
