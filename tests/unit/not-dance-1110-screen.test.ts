import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-838 (coverage daily 2026-11-10): teas, tastings, fairs and markets, plant sales, nature walks and
// volunteer days, rugby screenings, album-listening and gong sessions, talk circles, launches, a food
// festival, a wedding-band showcase, a sauna social, blind tests, dueling pianos and a concert billing
// are not dance nights on any calendar, unless the title names a style or a dance word.
describe("D-838 non-dance activities from the 11-10 daily check", () => {
  it.each([
    "Festive Afternoon Tea",
    "Thursday Link-UP: Berkmann's Red Wine Tasting Session",
    "SoLo Craft Fair Christmas Markets at Between the Bridges",
    "Native Plant Sales at George F Canyon",
    "Nature Walk at White Point Nature Preserve",
    "Outdoor Volunteer Day at Alta Vicente Reserve (Upper)",
    "Autumn Internationals - France v South Africa",
    "Six Nations: England v Wales",
    "Rugby World Cup Screening",
    "Groove Obscura presents: Pitch Black Album Listening",
    "The Portal vol. 6 - Ambient Gong and Drone Listening in the Chapel",
    "Gentle Noise for Hard Meditation",
    "Konda Talk Circle",
    "RAZOR-N-TAPE x BILL BERNSTEIN Apparel Launch",
    "The Jewelry Library: NYC Jewelry Week 2026",
    "Chole Kulcha Food Festival",
    "BVTLive! Wedding Band Showcase",
    "Locals x Nomads - Social Sauna",
    "BLINDTEST with DR WAX",
    "Blind Test Musical",
    "NYC’s Original Dueling Pianos",
    "Maelo Ruiz en concierto en New York",
    "Kyle Dixon & Michael Stein performing the music of STRANGER THINGS",
    "How to Pay Your AT&T Bill Online: Step-by-Step Payment Methods",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Salsa Night after the Wine Tasting",
    "Ecstatic Dance & Meditation",
    "Bachata at the Christmas Market",
    "Tea Dance",
    "Afternoon Tea Dance",
    "Swing Dance Social at the Food Festival",
    "Rugby Club Salsa Night",
    "Silent Disco Nature Walk",
    "Salsa Fall Series",
    "Kizomba Sauna Party",
    "Wine & Salsa Night",
    "Dueling DJs Dance Party",
    "Live Jazz with Tal Cohen",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
