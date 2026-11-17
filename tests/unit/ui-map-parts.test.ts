// The map's React pieces that render on the server (D-068), drawn to static markup the way the
// home tests draw the card: the toggle's links, the strip over the phone map and a card's pin
// number. MapLibre itself is proven in tests/e2e/map.spec.ts.

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { en, t } from "@/src/i18n";
import { ListMapToggle } from "@/src/ui/map/ListMapToggle";
import { MapCard } from "@/src/ui/map/MapCard";
import { MapStrip, stripSummary } from "@/src/ui/map/MapStrip";
import { MapSelectionContextForTests } from "@/src/ui/map/selection";
import type { MapSelection } from "@/src/ui/map/types";

function withSelection(selection: Partial<MapSelection>, child: ReactNode): string {
  const value: MapSelection = {
    selectedId: null,
    selectedFrom: null,
    select: () => {},
    numberOf: () => null,
    mapOnScreen: false,
    listOnScreen: true,
    view: "list",
    setView: () => {},
    ...selection,
  };
  return renderToStaticMarkup(
    createElement(MapSelectionContextForTests.Provider, { value }, child),
  );
}

describe("the List/Map toggle", () => {
  it("is two links, so a tap before hydration still gets there (M6)", () => {
    const html = renderToStaticMarkup(
      createElement(ListMapToggle, {
        view: "list",
        listHref: "/?day=2026-09-29",
        mapHref: "/?day=2026-09-29&view=map",
      }),
    );
    expect(html).toContain(`href="/?day=2026-09-29"`);
    expect(html).toContain(`href="/?day=2026-09-29&amp;view=map"`);
    expect(html).not.toContain("<button");
  });

  it("marks the view on screen with aria-current, not colour alone", () => {
    const html = renderToStaticMarkup(
      createElement(ListMapToggle, { view: "map", listHref: "/", mapHref: "/?view=map" }),
    );
    const current = /<a [^>]*aria-current="page"[^>]*>(.*?)<\/a>/.exec(html);
    expect(current?.[0]).toContain(`href="/?view=map"`);
    expect(current?.[1]).toContain(en.home.view.map);
    expect(html.match(/aria-current/g)).toHaveLength(1);
  });
});

describe("the strip over the phone map (M4)", () => {
  it("says which night, where, and how many places, as a link back to the list", () => {
    const html = renderToStaticMarkup(
      createElement(MapStrip, {
        place: "New York",
        dayLabel: "Tonight",
        isTonight: true,
        isTomorrow: false,
        count: 5,
        listHref: "/?day=2026-09-28",
      }),
    );
    expect(html).toContain(`href="/?day=2026-09-28"`);
    expect(html).toContain("Tonight near New York · 5 places");
    expect(html).toContain(en.map.strip.toList);
  });

  it("names a later night by its label and counts none as none", () => {
    const html = renderToStaticMarkup(
      createElement(MapStrip, {
        place: "New York",
        dayLabel: "Sat, Oct 3",
        isTonight: false,
        isTomorrow: false,
        count: 0,
        listHref: "/",
      }),
    );
    expect(html).toContain(
      `${t("home.header.day", { day: "Sat, Oct 3", place: "New York" })} · ${en.map.strip.places.zero}`,
    );
  });

  it("counts the places with no pin after the pins, and alone when no place has one (D-082)", () => {
    const night = {
      place: "New York",
      dayLabel: "Thu, Oct 1",
      isTonight: false,
      isTomorrow: false,
    };
    expect(stripSummary({ ...night, count: 12, unplaced: 1 })).toBe(
      "Thu, Oct 1 near New York · 12 places · 1 not on the map",
    );
    // Never "No places · 1 not on the map": that says there is nothing, then counts it.
    expect(stripSummary({ ...night, count: 0, unplaced: 1 })).toBe(
      "Thu, Oct 1 near New York · 1 not on the map",
    );
    expect(stripSummary({ ...night, count: 0, unplaced: 2 })).toBe(
      "Thu, Oct 1 near New York · 2 not on the map",
    );
    expect(stripSummary({ ...night, count: 0, unplaced: 0 })).toBe(
      `Thu, Oct 1 near New York · ${en.map.strip.places.zero}`,
    );
    const html = renderToStaticMarkup(
      createElement(MapStrip, { ...night, count: 0, unplaced: 1, listHref: "/" }),
    );
    expect(html).toContain("Thu, Oct 1 near New York · 1 not on the map");
    expect(html).not.toContain(en.map.strip.places.zero);
  });
});

describe("a card's part in the map (M12)", () => {
  const card = createElement(
    "a",
    { href: "/e/x" },
    createElement("div", null, createElement("span", null, "9:30")),
    createElement("div", null, "Name"),
  );

  it("keeps its pin's number as data, and prints none", () => {
    const html = withSelection(
      { numberOf: () => 4, mapOnScreen: true },
      createElement(MapCard, { id: "x", railed: true }, card),
    );
    expect(html).toContain(`data-pin-number="4"`);
    expect(html).not.toContain("pin-under-stamp");
    expect(html).not.toContain("--pin-number");
  });

  it("prints no number with no map on screen", () => {
    const html = withSelection({}, createElement(MapCard, { id: "x", railed: true }, card));
    expect(html).not.toContain("data-pin-number");
  });

  it("lays the selected card on the halftone sheet, and says it is the current one", () => {
    const selected = withSelection(
      { selectedId: "x", selectedFrom: "map", numberOf: () => 1, mapOnScreen: true },
      createElement(MapCard, { id: "x", railed: true }, card),
    );
    expect(selected).toContain("bg-halftone");
    expect(selected).toContain(`aria-current="true"`);
    expect(selected).toContain(`data-card-id="x"`);
  });
});
