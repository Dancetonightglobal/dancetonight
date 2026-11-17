import { describe, expect, it } from "vitest";
import type { RawListing } from "@/src/domain/listing";
import { checkListingTimes, readBlockTimes } from "@/src/domain/stated-times";
import { titleBlocks } from "@/src/domain/title-blocks";

// The Fringe Club's what's-on page (hkfringeclub.com/en/whatson/index/4-Event.html, 2026-10-31),
// as cleanPageText writes it: its two dance listings, the card between them and the language
// switch (" | ") after them, byte for byte.
const PAGE =
  "[https://www.hkfringeclub.com/en/whatson/2777-November+Weekly+Swing+Dance+Social.html]\n\nNovember Weekly Swing Dance Social\n\n- Wed 04-11-2026, 8:00 PM - 3 h\n- Wed 11-11-2026, 8:00 PM - 3 h\n- Wed 18-11-2026, 8:00 PM - 3 h\n- Wed 25-11-2026, 8:00 PM - 3 h\n\nWed 04-11-2026, 8:00 PM - 3 h\nmore time slots &raquo; [https://www.hkfringeclub.com/en/whatson/2777-November+Weekly+Swing+Dance+Social.html]\n\nFringe Dairy\n\nRegular: HKD100\nRegular：$138(Online ticket, Incl. 1 drink)\nAt Door: HKD108\n\n十一月氣溫漸涼，但跳舞的熱情不減！每逢週三晚，藝穗會與 Hong Kong Swings 聯手帶來搖擺舞派對，讓你在舞池中盡情釋放、隨心搖擺。\n\nDetails &raquo; [https://www.hkfringeclub.com/en/whatson/2777-November+Weekly+Swing+Dance+Social.html]\n\n[https://www.hkfringeclub.com/en/whatson/2736-%E3%80%90Own+You+Stage+%7C+Music+Edition%C2%A9%EF%B8%8F%E3%80%91Presented+by+the+Fringe+Club.html]\n\n【Own You Stage | Music Edition©️】Presented by the Fringe Club\n\nHong Kong Fringe Club\n\n- Mon 09-11-2026, 8:00 PM - 2 h\n- Sat 28-11-2026, 8:00 PM - 2 h\n\nMon 09-11-2026, 8:00 PM - 2 h\nmore time slots &raquo; [https://www.hkfringeclub.com/en/whatson/2736-%E3%80%90Own+You+Stage+%7C+Music+Edition%C2%A9%EF%B8%8F%E3%80%91Presented+by+the+Fringe+Club.html]\n\nFringe Dairy\n\n正價 : $220/參賽組合\n全日制學生: $120/ 參賽組合\n*每組參賽組合表演時長約12分鐘，三首歌曲，包含2杯飲品\n\nDream of hosting your very own music concert at the Fringe Club?\n\nDetails &raquo; [https://www.hkfringeclub.com/en/whatson/2736-%E3%80%90Own+You+Stage+%7C+Music+Edition%C2%A9%EF%B8%8F%E3%80%91Presented+by+the+Fringe+Club.html]\n\n[https://www.hkfringeclub.com/en/whatson/2778-November+Blue+Moon+Milonga.html]\n\nNovember Blue Moon Milonga\n\n- Tue 10-11-2026, 7:30 PM - 4 h\n\nTue 10-11-2026, 7:30 PM - 4 h\n\nFringe Dairy\n\nRegular Taster class+milonga：HK$200（Incl. 1 drink)\nMilonga(No drink): HK$150\nFull time student：HK$100（No drink）\n\nJoin us for an enchanting evening of tango!\n\nDetails &raquo; [https://www.hkfringeclub.com/en/whatson/2778-November+Blue+Moon+Milonga.html]\n\n[https://www.hkfringeclub.com/en]\n\nEn | 繁 [https://www.hkfringeclub.com/zh/whatson/index/4-Event.html] | 简 [https://www.hkfringeclub.com/cn/whatson/index/4-Event.html]";

const TITLES = ["November Weekly Swing Dance Social", "November Blue Moon Milonga"];

function check(title: string, date: string, dancing: string, end: string) {
  const listing = {
    title,
    date,
    doors_time: null,
    lesson_time: null,
    dancing_time: dancing,
    end_time: end,
    evidence: {},
    confidence: {},
  } as unknown as RawListing;
  const blocks = titleBlocks(PAGE, title, TITLES, null);
  return checkListingTimes(listing, { blocks, pageText: PAGE, title, date, lang: null });
}

describe("a duration end is checked by its clock face (D-669)", () => {
  it("gives the duration end the face of the time it ends at", () => {
    const end = readBlockTimes("- Wed 04-11-2026, 8:00 PM - 3 h").find((m) => m.role === "end");
    expect(end?.value).toBe("23:00");
    expect(end?.face).toBe("11:00");
  });

  it("keeps the swing social's 23:00 end (8:00 PM - 3 h)", () => {
    const r = check(TITLES[0]!, "2026-11-04", "20:00", "23:00");
    expect(r.changes).toEqual([]);
    expect(r.listing.dancing_time).toBe("20:00");
    expect(r.listing.end_time).toBe("23:00");
  });

  it("keeps the milonga's 23:30 end (7:30 PM - 4 h)", () => {
    const r = check(TITLES[1]!, "2026-11-10", "19:30", "23:30");
    expect(r.changes).toEqual([]);
    expect(r.listing.end_time).toBe("23:30");
  });

  it("still drops an end the page does not write", () => {
    const r = check(TITLES[0]!, "2026-11-04", "20:00", "21:00");
    expect(r.listing.end_time).toBeNull();
    expect(r.changes).toContainEqual({ kind: "not_written", field: "end_time", given: "21:00" });
  });
});
