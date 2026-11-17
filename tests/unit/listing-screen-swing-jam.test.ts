import { describe, expect, it } from "vitest";
import { matchStyles } from "@/config/styles";
import { screenNoDance } from "@/src/domain/listing-screen";

// A swing jam is a dance jam, not a music jam (Barcelona, 2026-11-01): "swing jam" is a dance jam pattern.
const listing = (title: string) => ({
  title,
  styles: matchStyles(title).styles as string[],
  startsAt: new Date(Date.UTC(2026, 10, 7, 2)),
  nightDate: "2026-11-06",
  tz: "America/Chicago",
});
const mixedOnly = { mixedCalendar: true, styles: [] as string[] };

describe("swing jams on mixed calendars", () => {
  it.each(["La Gràcia Swing Jam", "Power Jam de Swing"])("keeps %s", (title) => {
    expect(screenNoDance(listing(title), mixedOnly)).toBeNull();
  });

  it("still screens a music jam that names no dance", () => {
    expect(screenNoDance(listing("Open Jam"), mixedOnly)).toMatchObject({
      kind: "not_dance_scope",
    });
  });
});
