import { describe, expect, it } from "vitest";
import { tidyTitle } from "@/src/domain/title-tidy";

// D-747: London, daily site check 11-05. Tango Amistoso's weekly schedule gives each Sunday class
// twice: "Tango Beginners Class" and "Tango Beginners Class, Sundays 5pm, Angel". The card already
// shows the night, the start and the area, so a trailing ", <weekday>(s) <time>(, <area>)" tail is
// dropped and the two copies share one title.

describe("tidyTitle: an English weekday-and-time tail (D-747)", () => {
  it('drops ", <Weekday>s <time>, <area>"', () => {
    expect(tidyTitle("Tango Beginners Class, Sundays 5pm, Angel", "2026-11-08")).toBe(
      "Tango Beginners Class",
    );
    expect(tidyTitle("Tango - Open Level Class, Sundays 6pm, Angel", "2026-11-08")).toBe(
      "Tango - Open Level Class",
    );
  });
  it("drops the tail with no area, a singular weekday, minutes, a space or a dot before am/pm", () => {
    expect(tidyTitle("Salsa Social, Friday 9pm", "2026-11-06")).toBe("Salsa Social");
    expect(tidyTitle("Bachata Class, Mondays 7:30pm", "2026-11-09")).toBe("Bachata Class");
    expect(tidyTitle("Lindy Hop, Thursdays 8 PM, King's Cross", "2026-11-12")).toBe("Lindy Hop");
    expect(tidyTitle("Milonga, Saturdays 8.30pm, Old Street", "2026-11-07")).toBe("Milonga");
  });
  it("works with no night", () => {
    expect(tidyTitle("Tango Beginners Class, Sundays 5pm, Angel", null)).toBe(
      "Tango Beginners Class",
    );
  });
  it("keeps a weekday or time that is part of the name", () => {
    expect(tidyTitle("Salsa Sundays 5pm", "2026-11-08")).toBe("Salsa Sundays 5pm");
    expect(tidyTitle("Sundays at the Social", "2026-11-08")).toBe("Sundays at the Social");
    expect(tidyTitle("Swing, Sundays", "2026-11-08")).toBe("Swing, Sundays");
    expect(tidyTitle("Tango, 5pm, Angel", "2026-11-08")).toBe("Tango, 5pm, Angel");
  });
  it("keeps a tail whose area part is long (a description, not an area)", () => {
    const long = "Tango Class, Sundays 5pm, with a social afterwards until late in the hall";
    expect(tidyTitle(long, "2026-11-08")).toBe(long);
  });
  it("never leaves an empty title", () => {
    expect(tidyTitle(", Sundays 5pm, Angel", "2026-11-08")).toBe(", Sundays 5pm, Angel");
  });
});
