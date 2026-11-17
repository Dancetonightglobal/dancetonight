import { describe, expect, it } from "vitest";
import { stripTracking } from "@/src/domain/event-link-matcher";

// D-883 (daily check 2026-11-13, LA DJ Meredith Marks): one Ticketmaster event, once plain and once with the venue
// site's camefrom=...&brand=..., made two cards.
describe("stripTracking drops Ticketmaster's venue-site tags (D-883)", () => {
  const plain =
    "https://www.ticketmaster.com/dj-meredith-marks-you-can-dance-los-angeles-california-11-13-2026/event/09006529C460B333";

  it("drops camefrom and brand on ticketmaster", () => {
    expect(stripTracking(`${plain}?camefrom=CFC_THEBELLWETHER_web&brand=thebellwether`)).toBe(
      plain,
    );
  });

  it("drops camefrom anywhere, keeps brand off ticketmaster and other parameters", () => {
    expect(stripTracking("https://example.com/e/1?camefrom=x&brand=y&id=3")).toBe(
      "https://example.com/e/1?brand=y&id=3",
    );
  });
});
