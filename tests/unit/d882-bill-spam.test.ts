import { describe, expect, it } from "vitest";

import { screenBillSpam } from "@/src/domain/listing-screen-spam";

// D-882: bill-pay SEO spam on RA in wording the D-857 screen missed (daily check 2026-11-13, A).

describe("bill-pay spam in new wording (D-882)", () => {
  it.each([
    "Spectrum Mobile App Bill Pay Guide - Fast & Hassle-Free Payments",
    "View Past Cox Bills Online - Paperless Billing & Statement Help",
  ])("screens %s", (title) => {
    expect(screenBillSpam(title)?.reason).toBe("bill-payment spam, not an event (D-857)");
  });

  it.each([
    "Bill Evans Tribute Night",
    "Buffalo Bills Watch Party & Salsa Social",
    "Paperless Post Launch Party",
    "Dance App Launch: Bachata Social",
    "Billy's Online Swing Class",
  ])("keeps %s", (title) => {
    expect(screenBillSpam(title)).toBeNull();
  });
});
