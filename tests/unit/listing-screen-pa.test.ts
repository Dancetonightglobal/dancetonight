import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";
import { screenTitlePa } from "@/src/domain/listing-screen-pa";

describe("screenTitlePa Punjabi (Gurmukhi) title screens", () => {
  it("returns null for titles without Gurmukhi characters", () => {
    expect(screenTitlePa("Comedy Night at Lyla")).toBeNull();
    expect(screenTitlePa("कॉमेडी शो")).toBeNull(); // Hindi Devanagari
  });

  it("screens out comedy shows", () => {
    expect(screenTitle("ਪੰਜਾਬੀ ਕਾਮੇਡੀ ਸ਼ੋਅ")).toEqual({
      kind: "not_dance_scope",
      reason: "a Punjabi comedy show, not a dance (D-1141)",
    });
  });

  it("screens out poetry and religious gatherings", () => {
    expect(screenTitle("ਕਵੀ ਦਰਬਾਰ 2026")).toEqual({
      kind: "not_dance_scope",
      reason: "a Punjabi poetry or religious gathering, not a dance (D-1141)",
    });
    expect(screenTitle("ਗੁਰਬਾਣੀ ਕੀਰਤਨ ਸਮਾਗਮ")).toEqual({
      kind: "not_dance_scope",
      reason: "a Punjabi poetry or religious gathering, not a dance (D-1141)",
    });
  });

  it("screens out plays, films, talks, and book events", () => {
    expect(screenTitle("ਪੰਜਾਬੀ ਨਾਟਕ")).toEqual({
      kind: "not_dance_scope",
      reason: "a Punjabi play, film, talk or book event, not a dance (D-1141)",
    });
  });

  it("screens out workshops, fairs, and exhibitions", () => {
    expect(screenTitle("ਫੁਲਕਾਰੀ ਵਰਕਸ਼ਾਪ")).toEqual({
      kind: "not_dance_scope",
      reason: "a Punjabi workshop, fair or exhibition, not a dance (D-1141)",
    });
  });

  it("screens out closure notices", () => {
    expect(screenTitle("ਪ੍ਰੋਗਰਾਮ ਰੱਦ")).toEqual({
      kind: "closure",
      reason: "a Punjabi cancellation notice (D-1141)",
    });
  });

  it("keeps dance events with join words", () => {
    expect(screenTitle("ਭੰਗੜਾ ਨਾਈਟ")).toBeNull();
    expect(screenTitle("ਪੰਜਾਬੀ ਮੇਲਾ ਤੇ ਭੰਗੜਾ")).toBeNull();
    expect(screenTitle("ਗਿੱਧਾ ਮੇਲਾ")).toBeNull();
  });

  it("keeps events with party/dj words", () => {
    expect(screenTitle("ਕਾਮੇਡੀ ਤੋਂ ਬਾਅਦ ਡੀਜੇ ਪਾਰਟੀ")).toBeNull();
    expect(screenTitle("Jawani x Tarana Live | ਪੰਜਾਬੀ ਨਾਈਟ")).toBeNull();
    expect(screenTitle("ਪੰਜਾਬੀ ਬਾਗ਼ ਪਾਰਟੀ")).toBeNull();
  });

  it("keeps false friends: 'ਬੰਦ' with party word is not closure", () => {
    expect(screenTitle("ਬੰਦ ਕਮਰਾ ਪਾਰਟੀ")).toBeNull();
  });

  it("keeps events that match dance styles", () => {
    // This would require a style configuration that matches Punjabi words
    // For now, just ensure it doesn't get screened
    expect(screenTitle("ਪੰਜਾਬੀ ਡਾਂਸ ਪਾਰਟੀ")).toBeNull();
  });
  it("screens a Punjabi comedy night: night alone is not a dance", () => {
    expect(screenTitle("ਕਾਮੇਡੀ ਨਾਈਟ")?.kind).toBe("not_dance_scope");
  });
});
