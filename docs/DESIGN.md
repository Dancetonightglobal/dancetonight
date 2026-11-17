# DanceTonight: design tokens

## 0. Look "C", 2026-10-15 (D-147): read this first

The owner found the D-036 photocopy look "vibe coded rather than professional", asked for "clean
and calm", and chose mockup C ("quiet timeline") of three, then approved its event page and kept
dark mode following the phone. Where this section and the sections below disagree, this section
wins; sections 1-13 are kept for their accessibility work and history and are rewritten piece by
piece as screens move over.

1. **Page.** Warm off-white paper (`#fbfaf7`), near-black ink, one grey (`toner`, 5.5:1) for
   secondary text. No filled blocks of colour. Sections and rows are separated by 1px `halftone`
   hairlines, not boxes.
2. **Type.** Inter (OFL, self-hosted), sentence case everywhere. Titles 600, listing names 500,
   body 400. The only capitals are the small section heads and hour markers (`type-marker`,
   12px, tracked). No condensed widths.
3. **Families.** A family is its name in its colour (`text-stock-<family>`, `type-label`) above the
   listing's name, plus a 3px bar of the same colour on the left of the listing
   (`border-stock-<family>`). Never a tinted chip. The word is never left out, so colour is still
   never the only carrier (section 11).
4. **List.** Time in a left rail (`type-stamp`), printed once per group of listings that start
   together. Under the name: venue · distance · price or type, in toner. Empty hours are not drawn.
   The provenance ("checked 9h ago") moves to the event page; the card keeps one link.
5. **Live.** "On now" is spot-coloured text with a small dot, not a red block. The now rule is a
   1px spot line with a small "Now 9:41pm" label.
6. **Event page.** Back link "‹ Friday night" and Share at the top; family line, title, date and
   time, venue and distance beside the family bar; two buttons side by side (Directions filled
   ink, Add to calendar outlined); then When, Where (map with rounded corners), Cost, What to
   expect, Who, Sources as hairline-separated sections under small-capital heads. Unknown "What to
   expect" fields collapse into one line: "Not listed: level, partner, age, ...".
7. **Filters (the owner, 2026-10-15: "filter by type, as in current and B").** Both filter rows
   stay: dance style (family chips with counts) and kind of night (Social, Clubs, Classes,
   Other). Each is one horizontally scrolling row of pills under the day picker, as in mockup B,
   never a wrapped block; the selected pill is ink-edged with a check. "More filters" and Sort
   sit at the end of the second row.
8. **Controls.** 12px radius on buttons, inputs and the map; pills (`radius-pill`) for day and
   filter chips. 44px minimum targets stand.
9. **Dark.** Same layout on warm near-black (`#151412`); family colours are lighter tints that
   clear 7:1.


Status (sections 1-13): approved by the owner on 2026-09-22 (D-036), superseded in look by section 0 (D-147), with all three open choices settled (section 12). This document is no longer a proposal: it is the specification the Phase 1 interface is built to, and `tests/e2e` is the proof it was (SPEC section 10, PLAN section 11). Every contrast ratio below was computed with the WCAG 2.x relative-luminance formula (a script that lands in `scripts/contrast.ts` in Phase 1 so the tokens stay checked), not estimated; an independent checker recomputed all 25 hex values and every stated pair and found no mismatch. The direction is "Lamppost" (the winning token plan) with the pieces the judges asked for grafted in from the other three.

## 1. The idea

The page is the gig flyer stapled to a lamppost: warm paper, one heavy toner ink, one loud spot colour, condensed capitals for the headline, and tonight's times stamped down the left edge in reading order. You read it standing up, in one pass, and the only things that matter are the name, the time, the price and the door. The evening is a bill of times with a "now" stamped across it, so what is on now sits above the line and what is coming sits below. The dark theme is the same flyer printed on navy stock, not a black screen with a glow.

## 2. Colours

Six roles. Tokens are CSS variables on `:root`, redefined under `[data-theme="dark"]`, and exposed to Tailwind as `paper`, `ink`, `spot`, `toner`, `halftone`, `imprint` (so `bg-paper`, `text-ink`, `text-spot`, `border-toner`, `bg-halftone`, `text-imprint` never change between themes; the last one is not called `print` because that is Tailwind's print-media variant).

| Token | Name | Role | Light | Dark | Verified contrast on its surface (light / dark) |
|---|---|---|---|---|---|
| `paper` | Paper | Page and card background. Light: photocopy off-white. Dark: navy poster stock, blue on purpose. Also the label colour on spot fills (buttons, the now tab, the on-now stamp). | `#F2EDE3` | `#141E33` | Paper as text on spot 5.88 / 7.15 |
| `ink` | Ink | Primary text, event names, hour markers, chip borders in light, selected pin fill. Dark ink is the paper colour, so dark mode is the negative print. | `#17161A` | `#F2EDE3` | On paper 15.43 / 14.25. On halftone 13.32 / 12.04. Never on spot (2.62 / 1.99, forbidden) |
| `spot` | Spot | The one loud colour: the now rule and its tab, the on-now stamp, primary buttons, links, focus ring, map pins. Light: poster red. Dark: hi-vis orange sticker. | `#AE2410` | `#FF8A5B` | As text on paper 5.88 / 7.15. As text on halftone 5.08 / 6.05. As a rule or focus ring vs paper 5.88 / 7.15 (needs 3:1). Vs toner 1.03 / 1.12 (forbidden pairing, see section 11) |
| `toner` | Toner | Secondary text (venue, neighbourhood, distance, last checked), hairline rules, the faded photocopy grey. Never carries meaning by colour. The status line is never toner: it is always ink (or paper on the spot stamp), because it is the first line a dancer reads. | `#5B5852` | `#AEB4C2` | On paper 6.08 / 8.00. On halftone 5.24 / 6.76. As a 1px rule vs paper 6.08 / 8.00 (needs 3:1) |
| `halftone` | Halftone | Second surface: segmented-control track, the more-filters sheet, source rows, the map placeholder. A greyer sheet laid on the paper, always bounded by a toner hairline, never by its own tone. Dark halftone is a lighter navy (elevation goes lighter). | `#E4DDCE` | `#1F2B47` | Surface only: 1.16 / 1.18 vs paper (decorative; the toner hairline at 5.24 / 6.76 is the boundary). Text on it: ink 13.32 / 12.04, toner 5.24 / 6.76, spot 5.08 / 6.05 |
| `imprint` | Imprint | The ink printed on the coloured paper stocks: family chip labels, chip borders in light, the selected chip's 2px border and check mark. The one text colour that does not change with theme, because the stocks do not. | `#17161A` | `#17161A` | On the weakest stock (cherry) 8.78 in both themes; on plain-paper stock 15.43. Never on the dark page (1.08); it exists only on a stock |

Why no second alert red: "Cancelled", "Sources disagree" and form errors are words in ink (cancelled times are struck through). A second red would compete with spot and with the salsa and kizomba stocks, and colour is never the carrier anyway.

## 3. Style-family colours

Scheme: copy-shop paper stocks. When you photocopy a flyer you pick a coloured stock (goldenrod, canary, salmon, cherry), and that is what each family is: a small rectangle of tinted paper with the family name printed on it in `imprint`. The label is part of the chip, always: the tint never appears without its text, not on cards, not in chips, not in the detail header. The same thirteen hex values serve both themes: on the light page they are coloured paper on paper with a 1px `imprint` border; on the dark page they are flyers pinned to a navy wall and need no border.

Tailwind: `bg-stock-salsa` etc., keyed from `config/styles.ts` so the taxonomy and the palette cannot drift apart.

| Token | Label text that always appears with the colour | Stock | Hex (light and dark) | Imprint on tint | Tint vs dark page | Tint vs dark halftone | Tint vs light page |
|---|---|---|---|---|---|---|---|
| `stock-salsa` | Salsa and Latin | salmon | `#F7A98A` | 9.43 | 8.71 | 7.36 | 1.64 |
| `stock-kizomba` | Kizomba, zouk and Afro-Latin | cherry | `#F29BC1` | 8.78 | 8.10 | 6.85 | 1.76 |
| `stock-swing` | Swing | goldenrod | `#F0BE4A` | 10.44 | 9.63 | 8.14 | 1.48 |
| `stock-tango` | Tango | lilac | `#C9B3E6` | 9.50 | 8.77 | 7.41 | 1.63 |
| `stock-ballroom` | Ballroom and Latin ballroom | ivory | `#EADFB4` | 13.47 | 12.44 | 10.51 | 1.15 |
| `stock-country` | Country and line dance | kraft | `#D8B78C` | 9.49 | 8.76 | 7.41 | 1.63 |
| `stock-folk` | Folk, contra and ceilidh | green | `#B3D89C` | 11.34 | 10.46 | 8.84 | 1.36 |
| `stock-ecstatic` | Ecstatic and conscious dance | aqua | `#A3DAD3` | 11.60 | 10.71 | 9.05 | 1.33 |
| `stock-club` | Clubs and DJ nights | canary | `#F3E24D` | 13.55 | 12.50 | 10.57 | 1.14 |
| `stock-hiphop` | Hip-hop, street and breaking | sky | `#A6C6EC` | 10.21 | 9.43 | 7.97 | 1.51 |
| `stock-kpop` | K-pop random play | orchid | `#E3A3DE` | 9.06 | 8.36 | 7.06 | 1.70 |
| `stock-silent` | Silent disco | grey | `#C8C8CC` | 10.80 | 9.97 | 8.42 | 1.43 |
| `stock-other` | Other social dancing | plain paper | `#F2EDE3` | 15.43 | 14.25 | 12.04 | 1.00 |

Contrast rule they meet: the label (`imprint` on the tint) is at least 8.78:1 in both themes, well past 4.5:1; on the dark page and the dark halftone sheet the tint itself is at least 6.85:1 as a chip edge, past 3:1. On the light page the tints are 1.00 to 1.76:1 against paper, so the chip edge there is the 1px `imprint` border (15.43:1 vs paper, 13.32:1 vs halftone). That border is a component invariant of the chip, not a style option: the chip component renders it whenever the theme is light.

Where the colour appears, always with its words: the chip on a card (one chip, the primary family; extra styles as plain text after it), the chip in the filter row with its count ("Salsa and Latin 5"), and the chip above the title on the detail page. Map pins do not carry family colour; the highlighted card does. Thirteen tints are not distinguishable by colour alone (cherry, orchid and lilac are neighbours, as are green and aqua), which is exactly why the label is structural.

## 4. Type

One font file. The performance budget allows two; the second slot stays empty (no italic file, no second face).

| | |
|---|---|
| Family | Archivo, variable (wght 100 to 900, wdth 62 to 125) |
| Licence | SIL Open Font License 1.1 (Omnibus-Type, distributed through Google Fonts). `OFL.txt` ships beside the file in `public/fonts/`; the repo has no font files yet, this is the first |
| File | `public/fonts/Archivo[wdth,wght]-latin.woff2`, one file, built in Phase 1 (not yet in the repo) with pyftsubset from the Google Fonts variable TTF: unicode range `U+0020-007E, U+00A0-024F, U+2013-2026, U+20AC, U+20BF` (Latin, Latin-1 and Latin Extended for French, German, Spanish and Portuguese names, dashes and quotes, euro), layout features `kern, liga, tnum, lnum, pnum, case, frac`, flavor woff2. A trial build during the design pass measured 113,468 bytes and fontTools confirmed fvar wght 100 to 900 and wdth 62 to 125 with `tnum`, `lnum`, `case` and `frac` kept, so tabular figures are real. `OFL.txt` ships beside it |
| Loading | Preloaded, `font-display: swap`, one `@font-face` with `font-stretch: 62% 125%` and `font-weight: 100 900`; fallback `system-ui` with `size-adjust` tuned to Archivo so the LCP layout holds |

Scale (all Archivo; uppercase is applied by CSS `text-transform`, so the DOM keeps sentence case):

| Role | Size / line | Width | Weight | Notes |
|---|---|---|---|---|
| Detail title | 32px / 1.05 | 62 | 800 | Uppercase, letter-spacing -0.01em, wraps to two lines, never ellipsis |
| Card name | 24px / 1.1 | 62 | 800 | Uppercase, wraps to two lines, never ellipsis |
| Stamped time (rail, now tab, when list) | 24px / 1 (rail), 16px (when list) | 75 | 700 | `font-variant-numeric: tabular-nums`; the first and largest thing on a card, with the name |
| Hour marker, section head | 16px / 1 | 62 | 800 | Uppercase ("8PM", "When" rendered WHEN), ink |
| Status line | 16px / 1.3 | 100 | 600, 700 when under an hour away | Always ink, always carries the end: "Starts in 18 min, until 12:30am", "Ends in 20 min"; the on-now stamp is paper on spot, "On now until 11pm". The card link's accessible name is the stamped time, the name and this line |
| Body | 16px / 1.45 | 100 | 400 | Summary, what to expect values |
| Secondary | 14px / 1.4 | 100 | 400 | Venue, neighbourhood, distance, last checked, in toner |
| Label, chip, segment | 14px / 1 | 88 | 600 | Sentence case, letter-spacing 0 |
| Button | 16px / 1 | 88 | 700 | Paper on spot (primary) or ink with a 1px ink border (secondary) |
| Sticky now strip | 14px / 1 | 88 | 700 | Spot on paper |

## 5. Layout tokens

- Spacing: 4px base. `1` 4, `2` 8, `3` 12, `4` 16, `6` 24, `8` 32, `11` 44. Page gutter 16px. List max width 640px; split view from 1024px with the list at 440px and the map beside it. The phone's map never gets less than 176px, its attribution included (`min-h-map`, the detail map's height; D-068).
- Radius: 0 on cards, sheets, chips and the now tab (a flyer is cut, not rounded); 2px on buttons and inputs; map pins are round (a sticker).
- Borders: `hairline` 1px toner (rules between cards, under hour markers, around halftone sheets); `edge` 1px imprint (chips in light theme, secondary buttons in ink); `now` 3px spot; `strip` 2px spot (sticky strip's bottom edge). No shadows anywhere.
- Elevation: a second surface is a halftone sheet bounded by a hairline. In dark theme the sheet is lighter than the page (a sheet catching the light), in light theme greyer (a sheet in shadow).
- Cards: no box. A card is a grid `[rail 58px] [12px gap] [content]` separated from the next by a hairline, at least 88px tall, the whole card one link to the listing's own page, followed by its event line (D-073). Reading order: stamped time, name, family chip and type, status line, lesson line, price and venue and distance, confirmation flag; then, outside the card's link, the event line.
- Event line (D-073): every card is followed by one link out to the night itself, chosen in one place (`eventLink()` in `src/ui/links.ts`) so the card, the phone map's card and the event page never disagree. It reads "Tickets at eventbrite.com" when a page sells tonight's night and the night is not over; else "Event page at theronda.us" for the event's own page (on the organiser's site, a listings site or, once the night is cancelled or over, its ticket page); else "Listed on steppingoutstudios.com" for the page the listing was read from, opened scrolled to its title with a text fragment (`#:~:text=`; Chrome 80, Safari 16.1, Firefox 131; a browser that cannot find the words opens the page at its top); a listing with no source draws no line. A site's home page, a list of its nights, a venue, tag or author page or a ticket seller's organiser page is never "Tickets" and never "Event page" (`looksLikeEventPage` in `src/domain/event-links.ts`). The line is a second link after the card's link, never inside it (an `<a>` may not hold another), in its own `<div>` beside the card link within the card's wrapper: `type-secondary`, ink with an ink underline (spot stays on the time and the way in, section 9), `inline-flex min-h-11`, wrapping anywhere so a long host never pushes the page sideways, and set in the name's column, on the rail and off it. The card link keeps its 88px; its bottom padding drops to 4px when a line follows, and the line's row has 8px under it. The confirmation flag above it is unchanged: "On the ticket page, checked 2h ago" says where the night was checked, the line says where to go.
- Dates (D-072): US order, as `Intl` writes en-US: "Tue, Sep 29" (`formatCalendarDate`). The words "Tonight" and "Tomorrow" name those two nights in the day picker and the headline, as before. Where a date meets a word on one line, the joint is a middle dot, never a second comma: "Tonight · Tue, Sep 29" and "Thu, Oct 1 · Cancelled" on the detail page's date line, "Tango Cafe · Wed, Sep 30 · DanceTonight" in the tab and the share sheet, the same dot the map strip already uses. The home header prints tonight's or tomorrow's date on its own, at the end of the count line; a later night is named by its date in the headline, "Wed, Sep 30 near Williamsburg". A name that is only heard keeps its comma, a pause for a screen reader: the day picker's "Wed, Sep 30, 7 places".
- Day picker (D-075): seven nights, tonight and the next six, so every night of the week is one tap away (Sunday included on a Monday). A link can open a later night the ingest has read, up to twelve nights on (a shared link, the event page's way back); the picker then marks none of its seven (no `aria-current`, no underline), is not scrolled, and the headline and the tab name the night by its date, "Wed, Oct 7 near New York". A night that is over or further on opens tonight and says so under the count line, and on the phone map's strip: "Sun, Sep 27 is over. Showing tonight.", "We don't list Mon, Oct 12 yet. Showing tonight." or "We can't read the night in this link. Showing tonight." (a date in another year carries its year). Every link and form on that page, the location button included, carries tonight; the address bar keeps the link as it was (D-113).
- Confirmation flag (D-072): the card's last line says where the listing was checked. "On the organizer's page, checked 2h ago" when the organiser's own site or feed confirms tonight; "On the ticket page, checked 2h ago" when only a ticket seller's page does (Ticketmaster, Eventbrite, TicketWeb: a ticket seller is not the organiser); otherwise "Listing checked 2h ago", when we last read it. The organiser's page is named first when both confirm. "Sources disagree on the times", "Not confirmed for tonight" and, for a listing whose time is not listed, "Check before you go" are unchanged. The filter that keeps only the first two reads "On the organizer's or ticket page".
- Timeline rail: the rail column is 58px (`grid-cols-rail`, the `5ch` of the stamped-time size at 24px, wdth 75, written once as a token so the card and the hour marker cannot drift) so "10:00" and "12AM" fit. Hour markers run every hour from the earliest start to the latest start (D-067: to the latest end, a 4am close drew four empty hours below the last card), each an `h2` in condensed caps with a hairline running right across the page; an hour with nothing starting still renders its marker and a 32px empty row, so a gap reads as time passing. Under distance sort the rail, the markers and the now rule are removed and cards become a plain hairline-separated list, because a timeline that is not in time order would lie; the stamped time stays as the first element of each card. Time format, one rule: every time goes through the `Intl` formatter for the visitor's locale (a 24-hour locale renders 19:42 everywhere); in a 12-hour locale a stamp on the rail never carries the meridiem, because its hour marker, which always does, says which half of the day it is ("10:00" under "10PM", "12:30" under "12AM"; D-067: the rail used to switch to "12:30am" after midnight, and a 9am event read "9:00" among pm stamps). Off the rail (distance sort, a card with no marker above it) a stamp drops the meridiem while it is on the same side of noon as the now marker, or as 8pm on a night that is not tonight, and carries it otherwise, so a time reads the same whatever the filter or sort. The now tab and the sticky strip both read "Now 7:42pm".
- Time not listed (D-060): a listing whose source gives its night and no time has no place on the rail, and is never given one. Under start sort, the night's timed bill ends as usual (its hour markers run from the earliest start to the latest end of the timed listings only), and then a section head "Time not listed" (the hour marker's style, `SectionHead`, an `h2` whose visible text is its accessible text) opens a group of those listings, in distance order. Their cards drop the rail exactly as a distance-sort card does, and do not print the phrase again, because the heading above them says it (D-067: the owner saw it twice); it stays first in each card's accessible name. The now rule is placed among the timed rows only and never below the heading; a night whose listings all lack a time has no hour markers, no now rule and no sticky strip, just the heading and its cards. Under distance sort there is no group: these cards sit in distance order with the phrase "Time not listed" in the stamp slot, the first inline element in the stamped-time style at the small size. The status line is omitted on these cards, because the stamp already carries the flag; "Cancelled tonight" still shows, and nothing is struck through because there is no time to strike. They never name a page that confirmed the night ("On the organizer's page", "On the ticket page"); they show "Check before you go".
- Location not listed (D-082, the owner's choice of 2026-09-29): a listing whose venue could not be placed on the map is still on its night. Its card keeps its shape and reading order; the venue slot reads "Location not listed", toner like any venue, with no distance after it; its event line is unchanged and is where a dancer finds the place. Under distance sort these cards follow every card with a distance; under start sort they keep their place in time. They have no pin and print no pin number. They are listed when the dancer has not narrowed the distance (a query in their metro at its default reach): a listing with no location cannot be said to be within 3 miles.
- Now marker: a full-width 3px spot rule placed between the last event that has started and the first that has not, with a spot tab in the rail column, 24px tall, paper text "Now 7:42pm" in the stamped-time style at 14px. The rule sits on paper with 8px of paper above and below; no chip, stock or toner rule ever touches it. Recomputed once a minute, real DOM, accessible name "Now, 7:42pm". Rendered only for tonight; the day picker relabels the header ("Tomorrow near Williamsburg") and drops the marker, because there is no now on a future night.
- First paint: the server-rendered page scrolls (inline script before hydration, no visible jump) so the now rule sits a third of the way down the viewport, whenever at least one card is above it. If nothing has started yet the rule is already at the top of the bill and the page starts at the top.
- Sticky strip: once the now rule scrolls off the top, a 32px strip in paper with a 2px spot bottom edge sticks at the top reading "Now 7:42pm" in spot, with a "Back to now" link at the right. It disappears when the rule scrolls back into view. The link fills the strip's height and its hit area runs 14px below the strip, over the top of the list, so it is a 44px target in a 32px strip (D-067).
- Targets: chips, segments, cards, event lines, buttons, pins, source rows and the list/map toggle are at least 44px tall; chips have 8px between them and scroll horizontally.
- Map pins: spot circle, 28px, paper number, 2px paper halo (a ring, which stays round where an outline would be drawn square); the selected pin becomes ink with a paper number. A pin's accessible name is the start time it prints and its night: "9pm, Milonga la Nacional", or the night alone when its time is not listed (D-170). The number is the card's position in the current list order among the cards that have a pin (a listing whose location is not listed has none, so the numbers run 1 to n without a gap, D-082) (start time, or distance under distance sort; under start sort the "Time not listed" group is numbered after the timed cards) and is printed in the rail under the stamped time, 12px toner (the `type-pin` role: 12px / 1, width 75, weight 700, tabular figures), only when a map is on screen (split view, or the selected card in the phone's map view); under distance sort, and on a card whose time is not listed, where there is no rail, it is printed before the stamped time as the card's first inline element, 12px toner. The number is drawn on the card link's first cell only (`& > a:first-child > :first-child` in `app/globals.css`), never on the event line that follows the card link (D-073).
- Clusters (D-068, amending "spot with the count", which was written before the pins were numbered and made a cluster of two read as pin 2): a cluster is the negative of a pin, a paper sticker with a 2px spot edge and spot numbers, and it prints the list numbers it holds, never a count: "2·3", a run of three or more as "2–5", "1·4–6". Its accessible name is the count it prints (D-149) and its venues: "2 places, Stepping Out Studios" (D-170). Markers whose drawn targets would overlap are one cluster, drawn at its lowest-numbered place, so no marker ever covers another: a pin's target is 44 by 44, and a cluster's is 44 tall and as wide as its sticker, which is measured in the page's own type (review, 2026-09-28). A cluster prints at most nine characters: past that, the first of its numbers and how many more it holds, "1·3·6 +4", while its accessible name still lists every number. Tapping a cluster zooms in while zooming can pull its places apart (to zoom 17 at most); a cluster whose places share one spot (two nights at one studio), or that no further zoom separates, selects its first place instead, and the places crowding the selected pin are laid out in a row beside it, 44px apart, each with its own target; a marker the row would overlap joins the row.
- The map and the list (D-068): the selected card is laid on the halftone sheet, the design's second surface, and a pin picked on the map scrolls its card into view once the list is on screen; hovering or focusing a card selects its pin. The map draws no popup of its own: on a phone the pin's card in the sheet is its blurb, and in the split view (from 1024px, which has no sheet) the lit list card is, event line included; the sheet covers card and line together, and focusing the line selects its pin as the card does (D-073). The map opens framed on its pins, and draws them as soon as its style is in, saying "Loading the map" until its tiles are; with no pins it opens on the search centre at a city's width and says "No places to show", or "No places to show for these filters" when the night has places the filters hide; if it fails, whether its code or its style did not arrive, it says so, that the list still has every place, and offers "Load the map again", and the rest of the page is untouched. The phone map's strip counts its pins and says how many of the list's places are not on the map ("Tonight near New York · 6 places · 1 not on the map"); with no pin at all it says only that ("Thu, Oct 1 near New York · 1 not on the map"), never "No places · 1 not on the map". At 320px the strip wraps to two lines inside its 44px, as a night named by its date already does, and is never truncated. A map whose list has places but none with a location says "1 place has no location listed. It's in the list." in place of "No places to show". Hovering or focusing a card with no pin lights the card and no pin, and the phone's sheet under the map stays closed: it holds a picked pin's card (D-082). When the view no longer holds every pin, a "Show all" control (spot, underlined, on a paper tab bounded by a hairline) sits at its top right and frames them again.

Sticky stamp (the owner, 2026-10-17, D-151): on the rail, cards that share a start time are one group, and the group's stamp is drawn once more in an aria-hidden overlay (`data-sticky-stamp`) that sticks 32px below the top of the viewport, under the sticky now strip, until its group scrolls away. Whatever card is at the top of the screen always shows its time. Each card keeps its own stamp in its text and accessible name (transparent from 320px, where the overlay draws it); below 320px there is no overlay. The overlay stamp is struck through only when every card in its group is cancelled.

## 6. Home wireframe

Phone width, 40 columns. First paint at 7:42pm on a Sunday, scrolled so the now rule sits a third down.

```
+--------------------------------------+
| Tonight near Williamsburg        [=] |
| 14 places to dance      Sun, Sep 20  |
| [Use my exact location]  [Search...] |
|                                      |
| |All| Social | Clubs | Classes |Other|
| [Salsa and Latin 5] [Swing 3]        |
| [Clubs and DJ nights 4] [Tango 1]    |
| [+3]                                 |
| Sort: start time v      More filters |
|======================================|
| 6PM ________________________________ |
| 6:30 SALSA SUNDAYS AT SOB'S          |
|      [Salsa and Latin]  Social       |
|      |On now until 11pm|             |
|      Lesson 6:30, dancing 7:30       |
|      $15 door  SOB's, SoHo    1.2 mi |
|      On the organizer's page,        |
|      checked 2h ago                  |
|      Tickets at sobs.com             |
| 7PM ________________________________ |
|                                      |
|>NOW 7:42<============================|
|                                      |
| 8PM ________________________________ |
| 8:00 MIDTOWN SUNDAY HOP              |
|      [Swing]  Social                 |
|      Starts in 18 min, until 12:30am |
|      Lesson 8:00, dancing 9:00       |
|      $12 door  You Should Be Dancing,|
|      Midtown    2.4 mi               |
|      Listing checked 2h ago          |
|      Event page at ysbd.nyc          |
| 8:30 MILONGA LA NACIONAL             |
|      [Tango]  Social  No partner     |
|      needed                          |
|      Starts in 48 min, until 1am     |
|      $20 door  14th St        0.9 mi |
|      Listed on lanacional.org        |
| 9PM ________________________________ |
|                                      |
| 10PM _______________________________ |
|10:00 MISTER SUNDAY                   |
|      [Clubs and DJ nights]  21+      |
|      Starts in 2h 18m, until 4am     |
|      $25 advance  Nowadays,          |
|      Ridgewood  5.1 mi               |
|      Tickets at dice.fm              |
|                                      |
| TIME NOT LISTED ____________________ |
| BROOKLYN SOCIAL                      |
| [Folk, contra and ceilidh]  Social   |
| Free  Brooklyn Commons        3.0 mi |
| Check before you go                  |
| Listed on brooklyncontra.org         |
|                                      |
| Quiet after 1am. Showing tomorrow    |
| too, and places within 15 miles.     |
+--------------------------------------+
|          ( List | Map )              |
+--------------------------------------+
```

After the now rule scrolls off the top:

```
+--------------------------------------+
| Now 7:42pm               Back to now |
|______________________________________|
| 8:30 MILONGA LA NACIONAL             |
```

Segment labels: the row shows the short forms ("Social", "Clubs") at every width, and each link's accessible name is the spec's full label ("Social dancing", "Clubs and DJ nights"), which begins with the short one. The full labels used to appear from 1024px, where the list is the 440px column beside the map and five of them do not fit ("Other" was cut to "Oth"; D-067). On a card the type word is dropped when it would repeat the family chip (Mister Sunday shows "21+" alone after its chip), and "Other" is never printed after a chip, because it tells a dancer nothing.

Filters under the wireframe (D-067, the owner's review of 2026-09-28): every number is what its tap gives. A chip's count is the listings its tap would show with every other filter that is on (the segment, the other filters, not the other chips), so it reads the same on or off; a chip that is on stays in the row with its 0 so it can be tapped off; the header counts the list; each day counts its list under the filters its link carries. A selected chip is one rectangle: its own stock with a 2px imprint border in place of the 1px edge and the check mark inside it. "Clear styles" sits beside the sort once a family or style is on. The chosen day and the first chosen chip are scrolled into their row before paint. An empty list says which of two things happened: "Nothing on tonight near New York" when the night has nothing within reach, or "7 places are on, but none with these filters." with "Clear filters". A night with nothing within a distance the dancer narrowed that has listings with no location says "1 more has no location listed." with "Clear distance", which drops the distance and keeps the filters, and never "Nothing on", since no distance can be claimed for them (D-082). "Know a night we missed? Add it." waits for the suggest page (`/submit`); until then it is not drawn. The distance choices are round in the reader's unit (3, 5, 10 and 25 miles; 5, 8, 16 and 40 km).

Key: `>NOW 7:42<====` is the 3px spot rule with its paper-text tab (which reads "Now 7:42pm" on the page); `|On now until 11pm|` is the on-now stamp (spot fill, paper text); `6PM ____` rows are hour markers (h2, condensed caps) with a toner hairline, and `7PM` and `9PM` are empty hours drawn as 32px rows; the left five columns are the stamped-time rail in tabular figures; `[Salsa and Latin]` is a paper-stock chip with its label; `|All|` is the selected segment; the bottom bar is the list/map toggle. The sticky strip is paper with a 2px spot bottom edge. `TIME NOT LISTED ____` is the section head that follows the last hour group (D-060); its cards have no rail and do not repeat the phrase (D-067), so the name is their first line, and they carry no status line and no pin number in the rail (the number, when a map is on screen, is printed before the name). The underlined last line of each card ("Tickets at sobs.com", "Event page at ysbd.nyc", "Listed on lanacional.org") is its event line (D-073): a second link, after the card's link and outside it, in ink, set in the name's column; it opens the page in a new tab.

The phone's map view (D-068; the design had no wireframe for it, and the owner found it with no way to tell which night the pins were for), after tapping pin 3:

```
+--------------------------------------+
| Tonight near Williamsburg ·   Show   |
| 14 places                   the list |
|______________________________________|
|                           [Show all] |
|       (1)       (2·4)                |
|                         (6)          |
|             ((3))                    |
|   (5)                    (7–9)       |
|______________________________________|
| Map by OpenFreeMap and OpenStreetMap |
| contributors. Places from Overture   |
| Maps and GeoNames.                   |
|______________________________________|
| 8:00 MIDTOWN SUNDAY HOP              |
|    3 [Swing]  Social                 |
|      Starts in 18 min, until 12:30am |
|      $12 door  You Should Be Dancing |
|      Event page at ysbd.nyc          |
+--------------------------------------+
|          ( List | Map )              |
+--------------------------------------+
```

Key: the strip across the top is paper with a toner hairline under it, the night and place in ink (`type-strip`) and "Show the list" in spot; the whole strip is a link back to the list, where the day and the filters are. `(1)` is a pin, `((3))` the selected pin in ink, `(2·4)` and `(7–9)` clusters printing the numbers they hold. The map runs from the strip to its attribution line, which sits above the toggle and is never under it. The selected card is the card exactly as the list draws it, with its pin number in the rail and its event line under it (D-073), in a paper sheet between the attribution and the toggle; the map gives up the room for it, down to 176px (`min-h-map`) with its attribution, below which the card's sheet scrolls instead (a phone held landscape, where the event line is below the sheet's fold and one scroll away: accepted, D-073), keeping its top edge where it was, and eases the pin into view if the card would have hidden it, once, when the pin is picked; tapping the map away from a pin clears it. The map is laid over the list, not swapped for it: the list underneath keeps its place and is inert while the map is up, with its skip links and its sticky now strip, so nothing hidden under the map takes focus; and the map, once built, is kept. Each half of the toggle is a link (`?view=map`, or the page without it), so a tap before the page has loaded its script still gets there; every other link on the page is built without `view`, because a day or a filter is chosen from the list.

## 7. Detail wireframe

```
+--------------------------------------+
| < Back to tonight             Share  |
|                                      |
| [Swing]  Social dance                |
| MIDTOWN SUNDAY HOP                   |
| Tonight · Sun, Sep 20                |
| Every Sunday                         |
| Starts in 18 min                     |
|                                      |
| [Get directions]  [Get tickets]      |
| [Event page at midtownhop.com]       |
| [Add to calendar]                    |
|                                      |
| WHEN ________________________________|
| 7:30pm  Doors                        |
|>NOW 7:42<  Starts in 18 min =========|
| 8:00pm  Lesson, beginner friendly    |
| 9:00pm  Dancing starts               |
|12:30am  Ends                         |
|                                      |
| COST ________________________________|
| $12   Social only                    |
| $18   Lesson plus social             |
| Cash or card at the door             |
| Tickets at midtownhop.com            |
|                                      |
| WHERE _______________________________|
| +----------------------------------+ |
| |  map, drawn when WHERE comes near| |
| |               (1)                | |
| +----------------------------------+ |
| Map by OpenFreeMap and OpenStreetMap |
| You Should Be Dancing, 3rd floor     |
| 412 8th Ave, Midtown   2.4 mi        |
| Transit: A, C, E to 34th St          |
| [Google Maps]  [Apple Maps]          |
|                                      |
| WHAT TO EXPECT ______________________|
| Level       All levels               |
| Partner     Not needed; class rotates|
| Age         All ages                 |
| Floor       Wood, indoor             |
| Music       DJ; 70% lindy, 30% blues |
| Dress code  Not listed               |
| Crowd       About 150 people         |
|                                      |
| WHO _________________________________|
| Midtown Hop   midtownhop.com         |
| Instagram   Facebook                 |
|                                      |
| Weekly lindy hop social with a       |
| beginner lesson first. No partner    |
| needed. Pay at the door.             |
|                                      |
| SOURCES _____________________________|
| midtownhop.com      checked 2h ago   |
|   Ends 12:30am                       |
| facebook.com/...    checked 1d ago   |
|   Ends 1:00am                        |
|                                      |
| [Share]                              |
| Report a problem                     |
| Suggest a correction                 |
+--------------------------------------+
```

Key: the title block is the flyer headline (family chip with its label, then display caps, then the recurrence line and the live status); WHEN is the same stamped-time rail as home with the now rule inserted at 7:42 between Doors and Lesson, so you can see whether you are late for the lesson; section heads are condensed caps with hairlines; the map loads by itself once WHERE comes within about 300px of the screen (a halftone sheet saying "Loading the map" holds its place until then, so a visitor who never scrolls there never fetches MapLibre), fills the whole 176px sheet with its attribution below it (the frame and the attribution are drawn from first paint, so nothing below WHERE moves when the map arrives), moves with two fingers while one finger scrolls the page, and shows the venue's numbered pin as the spot sticker rather than as a selection (D-068, at the owner's request: a map that loaded only on a tap was "a problem"); "Get directions" opens a two-choice sheet (Google Maps, Apple Maps); when two sources disagree, each source row shows its own value beneath it ("Ends 12:30am" under midtownhop.com, "Ends 1:00am" under facebook.com), so the source name is the label; primary actions (Get directions, Get tickets) are spot buttons; the event's own page ("Event page at midtownhop.com") and "Add to calendar" are secondary buttons, ink in a 1px ink border; "Listed on {site}", drawn only when the listing has no ticket page and no event page, is an ink underlined text link under the row (D-073).

A listing whose time is not listed (D-060) keeps the same page. The title block's status line reads "Time not listed" ("Time not listed, until 2am" when an end is listed; a cancelled night says so on the date line instead, D-069). WHEN opens with a row whose rail cell is empty and whose label is "Time not listed", followed by "Ends" only when an end is listed; there is no now rule, because there is no stamped row to place it between, and the "Times are in" line appears only when a time is stamped. "Add to calendar" makes an all-day entry for the night.

```
| WHEN ________________________________|
|         Time not listed              |
| 2:00am  Ends                         |
```

A listing whose location is not listed (D-082) keeps the same page. WHERE is its section head and one line, "Location not listed", in the body role: no map sheet, no address, no Google Maps or Apple Maps links. The action row has no "Get directions"; its link out ("Get tickets", "Event page at {site}", or "Listed on {site}" under the row) is unchanged and is where the place is found. "Add to calendar" writes no location and says "Location not listed" in the notes. The page carries no Event JSON-LD, since Google requires a location. A venue whose name is its street address (a listing that gave only an address) prints it once.

```
| WHERE ______________________________|
| Location not listed                 |
```

Amended 2026-09-28 (D-069), after the owner's audit of the live site on his iPhone ("the UI looks terrible when clicked"). Each point closes a gap the wireframe left open, and none changes a token, a colour or a type role:

- **The date line.** Under the title, in the status role (ink): "Tonight · Sun, Sep 20", "Tomorrow · Mon, Sep 21", or the plain date ("Sat, Oct 3"), read from the listing's night against the current night in its own zone. The wireframe was drawn for tonight, so a Saturday listing opened on Monday read exactly like tonight's and a "Time not listed" page never stated its night at all. A cancelled or ended night reads "Thu, Oct 1 · Cancelled" or "Sun, Sep 27 · Ended" on this line, and the status line below is left out, since it would repeat the word without the date. The tab and share titles carry the plain date, never "Tonight": "Midtown Sunday Hop · Sun, Sep 20 · DanceTonight". Dates are in US order, as Intl writes en-US, and a date meets a word with a middle dot, never a second comma (D-072).
- **The recurrence line** shows only a recurrence a source states. It used to fall back to "One night only", which no source had said.
- **The type word** beside the chip is left out when the chip already says it (the card's rule, now shared through `src/ui/stocks.ts`) and when it is "Other".
- **The back link** names the night it returns to ("Back to tonight", "Back to tomorrow", "Back to Sat, Oct 3") and links to `/?day=` that night, for any night the home page opens, tonight through twelve nights on (the day picker's seven and the six after them, D-075); a night that is over, or the ingest's last night, goes back to tonight, the night the home page will open. When the page behind this one in the tab's history is the home page, it steps back through history instead, so the dancer's filters and scroll come back with them.
- **The action row once a night is over.** A cancelled or ended night has no "Get tickets" (and no "Tickets at" under COST); "Get directions" and "Add to calendar" are both secondary buttons, so the loudest thing on a cancelled page is not an invitation to go. "Add to calendar" is a plain link to the night's `.ics` file, which iOS opens in Calendar.
- **An event's own page** is never "Get tickets": a listings site's page for an event sells nothing. Amended 2026-09-29 (D-073): the page's links out are the card's, from `outboundLinks()` and `eventLink()` in `src/ui/links.ts`, in the card's words. The action row is [Get directions] [Get tickets, primary, while a page sells the night and it is not over] [Event page at {site}, a secondary button that wraps a long host] then [Add to calendar]. A listing known only from a page that lists it among others gets "Listed on {site}" under the row, an ink underlined `type-body` text link, 44px tall, opening that page scrolled to the title; there is then no "Event page" anywhere on the page. COST's ticket line reads "Tickets at {site}", the card's own words (`links.ticketsAt`). A cancelled or ended night keeps its ticket page as "Event page at {site}", since the page may say why, and has no "Get tickets".
- **WHEN.** Rows at the same instant merge: doors at the lesson's or the dancing's time are left out, and a lesson at the dancing's time keeps the lesson ("3pm Doors, 3pm Lesson, 3pm Dancing starts" read as a contradiction). The rail is its own width token, `grid-cols-rail-detail` (4rem) in `app/globals.css`, because the detail stamps carry am/pm and the home rail's 5ch does not hold them: measured on an iPhone 13, "12:30am" is 53.8px and "10:30pm" 54.0px in the 64px column, where 5ch gave 46px and "10:30pm" ran into its label. The home rail stays 5ch.
- **COST.** A label that only repeats the amount is dropped ("$11  $11"), "door" and "advance" read "Door" and "Advance", every other label starts with a capital, and a value that names who the price is for moves from "Includes" to the tier's name ("Door, general public"), since "Includes" is only what the price covers. Labels share their amount's baseline, as the What to expect labels share their values'.
- **SOURCES.** A label longer than 40 characters is cut back at a "/" and marked "…" ("axs.com/events/1566230/…"), or shown as the host alone; never cut mid-word. Only the source's name is a link (a 44px target); its checked time and, when sources disagree, its own value sit beside it as text, because a link's accessible name ("Open X, opens in a new tab") is all a screen reader says of it.
- **The footer** ("Report a problem", "Suggest a correction") is hidden until those pages exist; a link to a 404 on every event page was worse than none.
- **Pages on the same paper.** An address we do not have shows the not-found page of a removed listing: the message in the card-name role and one secondary button, "Back to tonight". Both are in the HTML itself, so the page reads the same before any script runs. `/bot`, the page the crawler's User-Agent links to, is set like this page: the back link, a detail-title heading, body paragraphs, a "User agent" section head and the User-Agent on a halftone sheet.
- **The app icon** is the now rule between two hour lines: a spot tab and rule on paper with two ink lines, square because a flyer is cut, in the dark print run when the device is dark (`app/icon.svg`, with a PNG for iOS and an ICO rendered from it).

## 8. Dark and light, each designed

Light is the photocopy. Paper `#F2EDE3` is warm off-white, ink `#17161A` is toner black, spot `#AE2410` is a poster red chosen to hold 4.5:1 as text on both paper and the halftone sheet (5.88 and 5.08), toner `#5B5852` is the faded grey of a third-generation copy, halftone `#E4DDCE` is a greyer sheet laid on top and bounded by a hairline. Family stocks are coloured paper on paper with a 1px imprint border. The manifest and `theme-color` are set to paper so the browser bar matches.

Dark is a second print run, not an inversion. The stock is navy `#141E33`, blue on purpose so the page is never near-black-with-a-glow; the ink is the paper colour `#F2EDE3` rather than white, which keeps the warmth and stops halation on an OLED phone in a dark hall; the spot becomes a hi-vis orange sticker `#FF8A5B`, because the same red would fail on navy and because an orange sticker on a dark poster is the street reference; toner shifts cool to `#AEB4C2` to sit in the navy; halftone `#1F2B47` is a lighter navy, so elevation goes lighter, a sheet catching the light. The family stocks do not change: the same thirteen tints with the same imprint label, now flyers pinned to a navy wall with no border needed (every tint is at least 8.10:1 against the page and 6.85:1 against the sheet).

What stays the same in both: the stocks and their imprint, the now rule as the single loudest thing on the page (spot fill, paper text), the type, the layout and the copy. What changes: the five page tokens, the chip border (light only), and the map tile style (a light and a dark OpenFreeMap style). Theme follows `prefers-color-scheme` with a manual toggle stored in `localStorage` as `data-theme` on `html`; its visible words are "Theme: Match my device, Light, Dark" (D-067: "Print run, Paper, Navy" was this document's metaphor, not a dancer's words). A chosen theme also sets the browser bar's colour, with one more `theme-color` meta first in the head, so Dark on a light phone does not leave a paper bar above a navy page. OG images always render in the light theme so shared cards read in feeds.

## 9. What makes it specific to dancing

- Rail of stamped times: dance nights are a sequence (doors, lesson, social, end) and dancers plan by "what is on at 9"; the rail is that sequence per card and per detail, where a generic list collapses it to one start time.
- Now rule as a bill of times: the evening reads as set times on a poster; "On now until 11pm" and "Starts in 18 min" are the primary line of every card, above price, and the on-now stamp is the same rubber stamp as the now tab.
- Lesson line: "Lesson 8:00, dancing 9:00" is its own line, because for social dancers the lesson time decides whether you leave now or after dinner. It prints only a time the stamp does not already say: a lesson at another time than the dancing, else doors that open before the start, else nothing (D-067: it repeated the start on 21 of 24 live cards).
- Price on a card: the door or advance price; else the general price, or the one price when every tier costs the same, printed bare; "From" only over a real range (D-067: "From $15" was a students' tier under a $25 general price).
- Family stocks: the thirteen families are literally coloured paper, the copy-shop trick that lets a salsa flyer and a swing flyer differ across a room; the label is printed on the stock, so the code and the colour are one object, and the flyer is the one vernacular every family shares, from a salsa social to a contra to a techno night.
- Condensed caps for names: the gig-poster headline, and the narrow width earns room for "Kizomba, zouk and Afro-Latin" on a phone.
- Card fields are the dancer's questions written as phrases, never icons: no partner needed, lesson included, 21+, wood floor, on the organizer's page.
- Spot is spent only on the things a dancer scans a flyer for, the time and the way in (now, on now, tickets, directions), never decoration.
- "Not listed" is a plain value in the What to expect table rather than a hidden row, because a missing dress code or floor type is itself information.
- The detail When list carries the now rule at the right row, so you can see whether you are late for the lesson.
- Empty state: "Quiet after 1am. Showing tomorrow too, and places within 15 miles. Know a night we missed? Add it." is what you would do on the street; the radius goes through the same `Intl` distance formatter as the cards (miles in a US locale, km elsewhere) and the last line links to `/submit` once that page exists (until then it is not drawn, D-067).
- Dark theme is the poster on navy stock under a streetlight, not a nightclub UI.

## 10. The generic-events-site check

| A generic events site would | This does |
|---|---|
| White or near-black page with one neon or brand-blue accent | Warm paper or navy stock, toner ink, one poster-red or hi-vis-orange spot |
| Rounded 16px cards with a soft shadow and a 16:9 image each | No box, no image, no shadow: cards separated by hairlines and a time rail, one continuous bill |
| A date header ("Today") and a plain list, start time in grey metadata | The evening as a timeline: hourly markers, empty hours drawn, a now rule between what has started and what has not, a sticky "Now 7:42pm" strip |
| Category in a pastel pill, sometimes just a coloured dot | Family as a coloured paper stock with its name printed on it, one chip per card |
| Status as a badge ("Live") or nothing | Status as a sentence in the first line after the name, always with the end: "On now until 11pm", "Starts in 18 min, until 12:30am", "Ends in 20 min" |
| Inter or the system font, one weight | One variable Archivo file: condensed 800 caps for names, tabular condensed figures for times, normal width for body |
| Detail page led by a cover photo, then the organiser's description | Detail led by the When rail and Cost; our own two-sentence summary below the facts; sources with last-checked times and both values when they disagree |
| Map pins coloured by category | Numbered spot stickers matching the number in the card's rail; family shown in the highlighted card |
| "No events found" | "Quiet after 1am. Showing tomorrow too, and places within 15 miles. Know a night we missed? Add it." |
| N/A, "View details", "Learn more" | "Not listed", "Get directions", "Suggest a correction" |

Honestly still generic, and kept so because they are controls and a flyer has no controls: the segmented control, the multi-select chip row, the sort dropdown, the bottom list/map toggle, the What to expect key-value table, the map itself, and the primary-button-plus-text-link action row.

Revised after this check:

- Two-hourly hour markers read like the date headers of any grouped list; changed to hourly markers with empty hours drawn, so the spine is a timetable.
- "On now" as coloured text with an outline read like any status badge; changed to a filled spot stamp with paper text, the same object as the now tab, so the page has one stamp vocabulary.
- Map pins with a two-letter code were a category-pin variant; changed to numbered stickers matching the bill.
- Scrolling to the now rule only when more than three events were on now left the first paint looking like a plain list at 7pm; changed to always scrolling the rule a third down when anything is above it.
- Chips with a 2px radius and no border in light theme looked like any pill; changed to square, with the 1px imprint border as an invariant.
- A second red for cancelled and errors would have been the usual alert colour; dropped, words in ink instead.

## 11. Accessibility

Contrast, light / dark, all computed (targets: 4.5:1 text, 3:1 large text and UI):

| Pair | Light | Dark | Use |
|---|---|---|---|
| Ink on paper | 15.43 | 14.25 | All primary text |
| Ink on halftone | 13.32 | 12.04 | Text on sheets |
| Toner on paper | 6.08 | 8.00 | Secondary text, hairlines (needs 3:1) |
| Toner on halftone | 5.24 | 6.76 | Secondary text on sheets, sheet boundary |
| Spot on paper | 5.88 | 7.15 | Links, status text, now rule, focus ring |
| Spot on halftone | 5.08 | 6.05 | Links and focus ring on sheets |
| Paper on spot | 5.88 | 7.15 | Button labels, now tab, on-now stamp, pin numbers |
| Imprint on cherry stock (weakest) | 8.78 | 8.78 | Chip labels; every other stock is higher, up to 15.43 |
| Stock vs dark page (weakest, cherry) | n/a | 8.10 | Chip edge in dark; light uses the imprint border at 15.43 |
| Stock vs dark halftone (weakest, cherry) | n/a | 6.85 | Chip edge in the filters sheet |
| Paper on ink (selected pin) | 15.43 | 14.25 | Selected pin number |

Forbidden pairs, written into the component notes: ink on spot (2.62 / 1.99), spot against toner (1.03 / 1.12, so no spot mark ever sits on a toner rule and the now rule sits on paper with an 8px gap), imprint on the dark page (1.08, imprint exists only on a stock), a stock chip touching the now rule or the on-now stamp (spot vs the stocks is 3.34 to 5.88 in light but 1.13 to 1.99 in dark; the 8px paper gap and the words carry it), halftone as an edge on its own (1.16 / 1.18).

Focus: a 3px spot outline offset 2px on every interactive element (5.88 / 7.15 vs paper, 5.08 / 6.05 vs halftone), `:focus-visible`, never removed; text links also keep an ink underline. Focus is never obscured (WCAG 2.2, 2.4.11): the scroll container sets `scroll-padding-top` to the sticky strip's 32px and `scroll-padding-bottom` to the list/map toggle's height, so a card or chip scrolled into view by keyboard focus never lands under either. While the phone's map is up, the list, its skip links and its sticky strip are inert, so focus never rests on anything under the map. A pin chosen with Enter keeps the focus, now named "…, selected", and a cluster chosen with Enter hands it to the marker that holds its first place, though every marker is redrawn (WCAG 2.2, 2.4.3).

Targets: everything tappable is at least 44px tall (the sticky strip's "Back to now" reaches 44px by a hit area running below the 32px strip); cards are whole-card links at least 88px tall with the stamped time, the name and the status line (with its end time) in the accessible name (a card whose time is not listed is named "Time not listed, {name}", with ", cancelled" when it is); each card's event line is a separate 44px target after the card link, never inside it and never overlapping it, named by its visible words, then the night, then the new tab: "Event page at theronda.us, Tango Cafe, opens in a new tab" (WCAG 2.5.3, the visible text first; 2.4.4, the night named, so a list of such links is not ten "Tickets at eventbrite.com"; 3.2.5, the new tab announced by `ExternalLink`), and the tab order is card, its event line, the next card (D-073); chips have 8px gaps in a horizontally scrolling row.

Motion: the now rule, the sticky strip and status text update by re-rendering, no transition; the map slides in only when `prefers-reduced-motion` is not set; nothing pulses, flickers or scrolls on its own after first paint.

Colour never the sole carrier: every stock chip carries its family name; status is a sentence; the on-now stamp says "On now until 11pm"; the now rule carries "Now 7:42"; selected chips add a 2px imprint border and a check mark; the selected segment is bold with an underline; confirmation is a phrase that says where the listing was checked ("On the organizer's page, checked 2h ago", "On the ticket page, checked 2h ago", "Listing checked 2h ago"); conflicting source values sit under the source that gave them, so the source name is the label; cancelled events keep their slot with the word "Cancelled" and a struck-through time (a cancelled listing whose time is not listed strikes nothing; "Cancelled tonight" carries it); map pins carry a number, and the highlighted card carries the family name.

Structure for screen readers: the list is an ordered list, and each of its card items holds the card link, then its event line (D-073); each hour group has an `h2` whose visible "8PM" is its accessible text ("8pm"), so users can jump by hour (D-067: "Starting at 8pm" over an hour where nothing starts was untrue); a day in the picker is named "Tonight, 5 places" and a chip "Tango, 4 places", so a count is never heard as part of a date or a name; the filter row is not a second region named "Filters" (the sheet is); skip links float over the page when focused; listings whose time is not listed follow the hour groups under an `h2` "Time not listed" whose visible text is its accessible text; the now rule is a list item with the accessible name "Now, 7:42pm"; the on-now count is announced in a polite live region at most once a minute, nothing else chatters. Display uppercase is CSS `text-transform`, so the DOM keeps sentence case (CLAUDE.md). All strings come from `src/i18n/en.ts`; unknown is "Not listed". For a card whose location is not listed, the card's accessible name is unchanged (stamp, title, status); like a venue name, "Location not listed" is visible text on the card, not part of the link's name. The map is named by its pins ("Map with 6 places", D-082).

Zoom and reflow: units are rem and ch, the page reflows at 320px without horizontal scroll, and at 200% zoom the rail collapses to inline hour headings above each card group while the stamped time stays as the card's first element.

## 12. Approved, 2026-09-22

The owner reviewed this document rendered in both themes and approved the direction: the gig flyer stapled to a lamppost, paper and ink and one spot colour, the thirteen paper stocks, the stamped-time rail and the now rule. The three open choices of the previous draft were settled in the same pass, so none of them is open and none is to be re-opened without a new decision entry. The approval is recorded in `docs/DECISIONS.md` as D-036, and `tests/e2e` is the end-to-end proof that what was approved is what was built.

What the approval covers, and what a reviewer holds the interface to:

- The tokens in `app/globals.css` are the whole palette and the whole type scale. A colour, a size or a weight that is not a utility there does not go into a component: it comes into this document and into `globals.css` first.
- No boxes, no shadows, no rounded corners beyond the 2px on buttons and inputs. A card is a grid `[rail 5ch] [12px gap] [content]` with a hairline between cards, at least 88px tall, and the whole card is one link to the listing's page, followed by its event line, a second link out that is never inside it (D-073).
- A family colour never appears without its label. One chip per card, the primary family; extra styles are plain text after it.
- The status line is never toner: it is ink, or paper on the spot stamp when the night is on now.
- The now rule is the loudest thing on the page, with 8px of clear paper above and below it, and nothing touching it.
- Every time string goes through `formatTime` in `src/domain/time.ts`, so a 24-hour locale reads 19:42 with no second code path.
- Targets are at least 44px tall, the page reflows at 320px with no horizontal scroll, and both themes are rendered checks, not a filter over one.

Added since the approval, without a new token, primitive or option: the "Time not listed" group and card (section 5, 6, 7 and 11; D-060). It reuses the section head, the distance-sort card shape and the plain "Not listed" wording, and changes none of the three choices below.

Amended 2026-09-29 (D-082), with the owner's approval ("Show them, 'Location not listed'"), without a new token or primitive: the card and page of a listing with no location (sections 5, 7, 11), and pins numbered among the cards that have one (choice 2 below). Added with it, in the same roles and links as the lines beside them, and confirmed by the owner on 2026-09-29 ("Accept as built"; a strip that wraps to two lines at 320px is fine): the phone map's strip counting the places not on the map, and with no pin at all saying only that (section 5); and the tail's "1 more has no location listed." with "Clear distance" when a narrowed distance leaves the night empty (section 6).

Corrected after the owner's review of the live site (2026-09-28, D-067), none of it a new option: the rail's 58px written once as a token (`grid-cols-rail`), markers ending at the last start, no meridiem on the rail, the grouped untimed card without the repeated phrase, the selected chip as one rectangle, short segment labels at every width, the empty-state sentences, the lesson line and card price rules, the theme control's words and the browser bar, and the spoken names in section 11.

Added 2026-09-29 (D-073), at the owner's request ("We need links to the event itself, not just links to the organizer. And these event links need to be everywhere, the list, the event, the map blurb"), without a new token, primitive or option: the card's event line (sections 5, 6 and 11), carried by the phone map's card and by the lit card of the split view, and the event page's action row naming the same link in the same words (section 7). It reuses `ExternalLink`, `type-secondary` and `type-body`, ink and its underline, the secondary button and the 44px target; it adds no colour, and spot stays on the time and the way in. The whole card stays one link and its reading order is unchanged; the line follows it. Rejected: a stretched title link with the event link above it (it broke ten end-to-end checks, lost the pin numbers and drew the focus ring round the title alone), a link inside the card link (invalid HTML), an icon in the card's corner (the design uses words, and its 44px target would overlap the card), and a link on the event page only (it misses the list and the map).

## 13. The three choices, as the owner settled them

1. **All thirteen paper stocks ship.** The taxonomy has thirteen families and the label carries the meaning, so nothing is gained by making the rarer families share plain paper and a dancer loses the one glance that says "that is the salsa one". One chip per card is what keeps a busy night from looking busy; the imprint border in light theme and the 6.85:1 minimum tint edge in dark keep every chip legible. `src/ui/stocks.ts` names all thirteen and a unit test holds it to `config/styles.ts`, so the palette and the taxonomy cannot drift apart.
2. **Map pins are numbered.** The number is the card's position in the current list order, printed in the rail under the stamped time while a map is on screen, and before the stamped time under distance sort where the rail is gone. Numbers match list to map without colour and need no legend, which the rejected two-letter family codes would have needed. Pins carry no family colour; the highlighted card carries the family name. Since D-082 the number counts only the cards with a pin.
3. **Empty hours are drawn, as 32px rows.** An hour between the first start and the last end with nothing starting in it still renders its marker and a 32px row of paper, so a quiet stretch reads as time passing rather than disappearing. The rejected alternative, collapsing them, is denser on a quiet night but sets 7pm directly against 10pm, which is the one thing a timeline exists not to do.
