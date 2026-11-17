import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";

const TZ = "America/New_York";
const NIGHT = "2026-10-31";
const at = (hour: number) => new Date(Date.UTC(2026, 9, 31, hour + 4)); // EDT
const listing = (title: string, hour = 20) => ({
  title,
  styles: [] as string[],
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});
const mixed = { mixedCalendar: true, styles: [] as string[] };

describe("party kinds keep a night on a mixed calendar (D-256)", () => {
  it.each([
    "Halloween Night ft. DJ Breezy & Jamboree",
    "Pink Flamingo Halloween 2026 | Convenção das Bruxas 21h",
    "Fundo de Quintal: Pagode na Lapa",
    "Roda de Samba do Trapiche",
    "Friday DJ Set with Lola",
    "Radio Bar Sessions: DJ sets all night",
  ])("keeps %s", (title) => {
    expect(screenNoDance(listing(title), mixed), title).toBeNull();
  });

  it("still screens a seated Halloween show and an unnamed concert", () => {
    expect(screenNoDance(listing("Halloween Film Screening"), mixed)).not.toBeNull();
    expect(screenNoDance(listing("Chow Lee Album Release Show"), mixed)).not.toBeNull();
  });

  it("does not read DJ inside another word", () => {
    expect(screenNoDance(listing("Adjusted Acoustic Evening"), mixed)).not.toBeNull();
  });

  it("keeps a night whose evidence says DJ sets (D-288)", () => {
    const listingWithEvidence = {
      ...listing("Baltiwhore Feat. Dan Grey"),
      evidenceText: "DJ sets from 9pm till late",
    };
    expect(screenNoDance(listingWithEvidence, mixed)).toBeNull();
  });
});
