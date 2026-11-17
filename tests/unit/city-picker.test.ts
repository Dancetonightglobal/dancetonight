import { describe, expect, test } from "vitest";
import { en } from "@/src/i18n/en";
import { cityHref } from "@/src/ui/home/CityPicker";
import { headlineParts } from "@/src/ui/home/Header";

describe("cityHref", () => {
  test("opening city returns '/'", () => {
    const city = {
      slug: "new-york",
      name: "New York",
      center: { lat: 40.7128, lng: -74.006 },
      hasListings: true,
    };
    const href = cityHref(city, "new-york");
    expect(href).toBe("/");
  });

  test("other city returns lat/lng query", () => {
    const city = {
      slug: "london",
      name: "London",
      center: { lat: 51.5074, lng: -0.1278 },
      hasListings: false,
    };
    const href = cityHref(city, "new-york");
    expect(href).toBe("/?lat=51.50740&lng=-0.12780");
  });
});

describe("headlineParts", () => {
  test("returns null when place is null", () => {
    const props = { place: null, dayLabel: "Wed, Oct 7", isTonight: false, isTomorrow: false };
    expect(headlineParts(props)).toBeNull();
  });

  test("tonight: parts join to headline", () => {
    const props = { place: "New York", dayLabel: "", isTonight: true, isTomorrow: false };
    const parts = headlineParts(props);
    expect(parts).not.toBeNull();
    if (parts) {
      expect(parts.before + parts.place + parts.after).toBe("Tonight near New York");
    }
  });

  test("tomorrow: parts join to headline", () => {
    const props = { place: "New York", dayLabel: "", isTonight: false, isTomorrow: true };
    const parts = headlineParts(props);
    expect(parts).not.toBeNull();
    if (parts) {
      expect(parts.before + parts.place + parts.after).toBe("Tomorrow near New York");
    }
  });

  test("day label: parts join to headline", () => {
    const props = {
      place: "New York",
      dayLabel: "Wed, Oct 7",
      isTonight: false,
      isTomorrow: false,
    };
    const parts = headlineParts(props);
    expect(parts).not.toBeNull();
    if (parts) {
      expect(parts.before + parts.place + parts.after).toBe("Wed, Oct 7 near New York");
    }
  });
});

describe("en keys", () => {
  test("home.header.city.button exists", () => {
    expect(en.home.header.city.button).toBeTypeOf("string");
  });
  test("home.header.city.choose exists", () => {
    expect(en.home.header.city.choose).toBeTypeOf("string");
  });
  test("home.header.city.current exists", () => {
    expect(en.home.header.city.current).toBeTypeOf("string");
  });
  test("home.header.city.comingSoon exists", () => {
    expect(en.home.header.city.comingSoon).toBeTypeOf("string");
  });
});

import { intentPrefetchProps } from "@/src/ui/home/CityPicker";

describe("intentPrefetchProps", () => {
  test("onPointerEnter calls prefetch with href", () => {
    const calls: string[] = [];
    const props = intentPrefetchProps((h) => calls.push(h), "/test-href");
    props.onPointerEnter();
    expect(calls).toEqual(["/test-href"]);
  });

  test("onPointerDown calls prefetch with href", () => {
    const calls: string[] = [];
    const props = intentPrefetchProps((h) => calls.push(h), "/test-href");
    props.onPointerDown();
    expect(calls).toEqual(["/test-href"]);
  });

  test("onFocus calls prefetch with href", () => {
    const calls: string[] = [];
    const props = intentPrefetchProps((h) => calls.push(h), "/test-href");
    props.onFocus();
    expect(calls).toEqual(["/test-href"]);
  });

  test("constructing props does not call prefetch", () => {
    const calls: string[] = [];
    intentPrefetchProps((h) => calls.push(h), "/test-href");
    expect(calls).toEqual([]);
  });

  test("onPointerEnter does not throw when prefetch throws", () => {
    const props = intentPrefetchProps(() => {
      throw new Error("prefetch failed");
    }, "/test-href");
    expect(() => props.onPointerEnter()).not.toThrow();
  });

  test("onPointerDown does not throw when prefetch throws", () => {
    const props = intentPrefetchProps(() => {
      throw new Error("prefetch failed");
    }, "/test-href");
    expect(() => props.onPointerDown()).not.toThrow();
  });

  test("onFocus does not throw when prefetch throws", () => {
    const props = intentPrefetchProps(() => {
      throw new Error("prefetch failed");
    }, "/test-href");
    expect(() => props.onFocus()).not.toThrow();
  });
});
