// D-1245: Modern Events Calendar's month view ("Events for 11月" + "17th") is written as dated headings, so the
// page splits into parts of at most CHUNK_MAX_HEADINGS nights (MAHARAJA Roppongi, read 43320146991).
import { describe, expect, it } from "vitest";
import { cleanPageText } from "@/src/pipeline/clean";
import { CHUNK_MAX_HEADINGS, splitPageText } from "@/src/pipeline/extract";
import { isDateHeading } from "@/src/domain/text-facts";

const PAGE = "https://maharaja-r.jp/schedule2/";

/** One day cell as MAHARAJA's schedule page prints it (2026-11-12 markup). */
function cell(ymd: string, day: string, time: string, title: string, slug: string): string {
  return (
    `<div class="mec-calendar-events-sec" data-mec-cell="${ymd}" ><h6 class="mec-table-side-title">Events for 11月</h6>` +
    `<h3 class="mec-color mec-table-side-day"> ${day}</h3><article class="mec-event-article">` +
    `<div class="mec-event-time mec-color"><i class="mec-sl-clock-o"></i> ${time}</div>` +
    `<h4 class="mec-event-title"><a class="mec-color-hover" href="https://maharaja-r.jp/events/${slug}/">${title}</a></h4>` +
    `</article></div>`
  );
}

describe("Modern Events Calendar day headings (D-1245)", () => {
  it("writes each day cell's date as a date heading", () => {
    const text = cleanPageText(
      cell("20261117", "17th", "19:00", "歌謡曲ナイト", "kayokyoku_night"),
      PAGE,
    );
    expect(text).toContain("Tuesday, November 17, 2026");
    expect(text).not.toContain("Events for 11月");
    expect(text).not.toMatch(/^17th$/m);
    expect(isDateHeading("Tuesday, November 17, 2026", "ja")).toBe(true);
    expect(text).toContain("歌謡曲ナイト [https://maharaja-r.jp/events/kayokyoku_night/]");
  });

  it("splits a dense month into parts of at most CHUNK_MAX_HEADINGS dated nights", () => {
    const html = Array.from({ length: 22 }, (_, i) => {
      const d = i + 1;
      const ordinal = `${d}${d === 1 || d === 21 ? "st" : d === 2 || d === 22 ? "nd" : d === 3 ? "rd" : "th"}`;
      return cell(
        `202611${String(d).padStart(2, "0")}`,
        ordinal,
        "19:00",
        `NIGHT ${d}`,
        `night-${d}`,
      );
    }).join("");
    const parts = splitPageText(cleanPageText(html, PAGE));
    expect(parts.length).toBeGreaterThanOrEqual(4);
    for (const part of parts) {
      const nights = part.split("\n").filter((line) => /^\w+day, November \d+, 2026$/.test(line));
      expect(nights.length).toBeLessThanOrEqual(CHUNK_MAX_HEADINGS);
    }
    // Each night stays in the part that carries its own date heading.
    const last = parts.find((p) => p.includes("NIGHT 22 "))!;
    expect(last).toContain("Sunday, November 22, 2026");
  });

  it("leaves an impossible cell date alone", () => {
    const text = cleanPageText(cell("20261131", "31st", "19:00", "X", "x"), PAGE);
    expect(text).toContain("Events for 11月");
    expect(text).not.toContain("December 1");
  });

  it("does not touch pages without MEC day cells", () => {
    const html = `<h6 class="mec-table-side-title">Events for 11月</h6><h3 class="mec-table-side-day">17th</h3>`;
    expect(cleanPageText(html, PAGE)).toContain("17th");
  });
});
