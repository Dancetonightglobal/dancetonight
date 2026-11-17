import { describe, expect, it } from "vitest";
import { normalizeStatedTime, normalizeStatedEndTime } from "@/src/domain/listing";
import { readBlockTimes } from "@/src/domain/stated-times";

describe("German clock forms with 'Uhr' (D-1022)", () => {
  describe("readBlockTimes", () => {
    it("reads '22 Uhr' as 22:00", () => {
      const mentions = readBlockTimes("22 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("22:00");
      expect(mentions[0]!.role).toBe("start");
    });

    it("reads 'ab 22 Uhr' as 22:00", () => {
      const mentions = readBlockTimes("ab 22 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("22:00");
      expect(mentions[0]!.role).toBe("start");
    });

    it("reads 'Einlass 21 Uhr' as 21:00", () => {
      const mentions = readBlockTimes("Einlass 21 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("21:00");
      expect(mentions[0]!.role).toBe("start");
      expect(mentions[0]!.label).toBe("doors");
    });

    it("reads '22.00 Uhr' as 22:00", () => {
      const mentions = readBlockTimes("22.00 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("22:00");
    });

    it("reads '22:00 Uhr' as 22:00 (keeps existing)", () => {
      const mentions = readBlockTimes("22:00 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("22:00");
    });

    it("reads '20.30 Uhr bis 1 Uhr' as range", () => {
      const mentions = readBlockTimes("20.30 Uhr bis 1 Uhr", "de");
      expect(mentions).toHaveLength(2);
      expect(mentions[0]!.value).toBe("20:30");
      expect(mentions[0]!.role).toBe("start");
      expect(mentions[1]!.value).toBe("01:00");
      expect(mentions[1]!.role).toBe("end");
    });

    it("reads '20 bis 2 Uhr' as range", () => {
      const mentions = readBlockTimes("20 bis 2 Uhr", "de");
      expect(mentions).toHaveLength(2);
      expect(mentions[0]!.value).toBe("20:00");
      expect(mentions[0]!.role).toBe("start");
      expect(mentions[1]!.value).toBe("02:00");
      expect(mentions[1]!.role).toBe("end");
    });

    it("reads 'Beginn: 19.30 Uhr' as 19:30", () => {
      const mentions = readBlockTimes("Beginn: 19.30 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("19:30");
    });

    it("does not read '24 Uhr' as a time", () => {
      const mentions = readBlockTimes("24 Uhr", "de");
      expect(mentions).toHaveLength(0);
    });

    it("does not read 'Uhrzeit 22' as a time", () => {
      const mentions = readBlockTimes("Uhrzeit 22", "de");
      expect(mentions).toHaveLength(0);
    });

    it("keeps existing '22h' behavior", () => {
      const mentions = readBlockTimes("22h", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("22:00");
    });

    it("keeps existing '21 h' behavior", () => {
      const mentions = readBlockTimes("21 h", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("21:00");
    });

    it("keeps existing '8pm' behavior", () => {
      const mentions = readBlockTimes("8pm", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("20:00");
    });

    it("keeps existing '20:00' behavior", () => {
      const mentions = readBlockTimes("20:00", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("20:00");
    });

    it("keeps existing '19.30 Uhr' behavior (with minutes)", () => {
      const mentions = readBlockTimes("19.30 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("19:30");
    });

    it("reads 'Tickets 15 Uhr' as 15:00", () => {
      const mentions = readBlockTimes("Tickets 15 Uhr", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("15:00");
    });

    it("does not read '15 Euro' as a time", () => {
      const mentions = readBlockTimes("15 Euro", "de");
      expect(mentions).toHaveLength(0);
    });

    it("reads '3 Uhr nachts' as 03:00", () => {
      const mentions = readBlockTimes("3 Uhr nachts", "de");
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.value).toBe("03:00");
    });
  });

  describe("normalizeStatedTime", () => {
    it("normalizes '22 Uhr' to '22:00'", () => {
      expect(normalizeStatedTime("22 Uhr")).toBe("22:00");
    });

    it("normalizes '22.00 Uhr' to '22:00'", () => {
      expect(normalizeStatedTime("22.00 Uhr")).toBe("22:00");
    });

    it("normalizes '9 Uhr' to '09:00'", () => {
      expect(normalizeStatedTime("9 Uhr")).toBe("09:00");
    });

    it("normalizes 'ab 22 Uhr' to '22:00'", () => {
      expect(normalizeStatedTime("ab 22 Uhr")).toBe("22:00");
    });

    it("returns null for '22.75 Uhr'", () => {
      expect(normalizeStatedTime("22.75 Uhr")).toBeNull();
    });

    it("keeps existing '22:00' behavior", () => {
      expect(normalizeStatedTime("22:00")).toBe("22:00");
    });

    it("keeps existing '22h' behavior", () => {
      expect(normalizeStatedTime("22h")).toBe("22:00");
    });

    it("handles range '20 - 2 Uhr' start side", () => {
      // The start side "20" should be read as 20:00 because end has "Uhr"
      expect(normalizeStatedTime("20 - 2 Uhr")).toBe("20:00");
    });

    it("handles range '20-2 Uhr' start side", () => {
      expect(normalizeStatedTime("20-2 Uhr")).toBe("20:00");
    });
  });

  describe("normalizeStatedEndTime", () => {
    it("normalizes '2 Uhr' as end time", () => {
      expect(normalizeStatedEndTime("2 Uhr")).toBe("02:00");
    });

    it("normalizes '2.00 Uhr' as end time", () => {
      expect(normalizeStatedEndTime("2.00 Uhr")).toBe("02:00");
    });

    it("handles range '20 - 2 Uhr' end side", () => {
      expect(normalizeStatedEndTime("20 - 2 Uhr")).toBe("02:00");
    });
  });
});

describe("German half hours and doors (D-1022, coverage review)", () => {
  it("reads '22.30 Uhr' in page text and as a stated time", () => {
    expect(readBlockTimes("Beginn 22.30 Uhr", "de")[0]?.value).toBe("22:30");
    expect(normalizeStatedTime("22.30 Uhr")).toBe("22:30");
  });
  it("reads the start of '20 - 2 Uhr' as 20:00", () => {
    expect(normalizeStatedTime("20 - 2 Uhr")).toBe("20:00");
  });
  it("does not read 'Uhrzeit 22' as a stated time", () => {
    expect(normalizeStatedTime("Uhrzeit 22")).toBeNull();
  });
});

describe("German doors and 'bis' end (D-1022, coverage review)", () => {
  it("reads 'Einlass 21.30 Uhr, Party bis 3 Uhr' as doors 21:30 and end 03:00", () => {
    const m = readBlockTimes("Einlass 21.30 Uhr, Party bis 3 Uhr", "de").map((x) => [
      x.value,
      x.role,
    ]);
    expect(m).toEqual([
      ["21:30", "start"],
      ["03:00", "end"],
    ]);
    expect(readBlockTimes("Einlass 21.30 Uhr, Party bis 3 Uhr", "de")[0]?.label).toBe("doors");
  });
  it("reads '20:00 Uhr' through the page-text path", () => {
    expect(readBlockTimes("Beginn 20:00 Uhr", "de")[0]?.value).toBe("20:00");
  });
  it("does not take 'Uhrwerk' as 'Uhr' on a range's other side", () => {
    expect(normalizeStatedTime("8 - 2 Uhrwerk")).toBeNull();
  });
});
