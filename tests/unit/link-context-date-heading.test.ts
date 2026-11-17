import { describe, expect, it } from "vitest";
import { findEventLinks } from "@/src/domain/event-link-matcher";

describe("link-context-date-heading", () => {
  const pageText = `Sunday · November 1

1pm · Rittenhouse · Rittenhouse Square Rittenhop Weekly Social Dance Every Sunday at 1:00 p.m. in Rittenhouse [https://www.ourphilly.org/events/rittenhop-weekly-social-dance]

Reported recurring event — posted on a schedule, not verified. Confirm before going.

Tuesday · November 3

6:30pm · Old City · Brasil's Nightclub Zouk Tuesdays [https://www.ourphilly.org/events/brasilsnightclub-zouk-tuesdays-2026-11-03]`;

  const pageUrl = "https://www.ourphilly.org/tags/dance";
  const options = { lang: "en", dateOrder: "mdy" as const };

  it("picks correct links when dates match headings", () => {
    const queries = [
      { title: "Rittenhop Weekly Social Dance", date: "2026-11-01" },
      { title: "Zouk Tuesdays", date: "2026-11-03" },
    ];
    const result = findEventLinks(pageText, pageUrl, queries, options);
    expect(result[0]!.url).toBe("https://www.ourphilly.org/events/rittenhop-weekly-social-dance");
    expect(result[1]!.url).toBe(
      "https://www.ourphilly.org/events/brasilsnightclub-zouk-tuesdays-2026-11-03",
    );
  });

  it("returns null for wrong date under heading", () => {
    const queries = [{ title: "Rittenhop Weekly Social Dance", date: "2026-11-03" }];
    const result = findEventLinks(pageText, pageUrl, queries, options);
    // The link is under "Sunday · November 1", not "Tuesday · November 3"
    expect(result[0]!.url).toBeNull();
  });
});
