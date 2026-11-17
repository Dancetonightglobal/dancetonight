"use client";

// The wire between the list and the map, and the only thing a card has to import to be part of
// it. Selecting a pin highlights its card; selecting a card highlights its pin; both go through
// this one piece of state. No MapLibre type reaches this file, so a card that highlights itself
// costs nothing on a phone that never opens the map.
//
// "use client" because this is React state shared by two subtrees and driven by clicks.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { MapPlace, MapSelection, MapView, SelectionSource } from "@/src/ui/map/types";

/**
 * The default for a page with no map at all: nothing is selected, selecting does nothing, and
 * `mapOnScreen` is false so a rail prints no pin numbers. A card can therefore call
 * `useMapSelection()` unconditionally and render correctly outside a provider.
 */
const NO_MAP: MapSelection = Object.freeze({
  selectedId: null,
  selectedFrom: null,
  select: () => {},
  numberOf: () => null,
  mapOnScreen: false,
  listOnScreen: true,
  view: "list" as MapView,
  setView: () => {},
});

const MapSelectionContext = createContext<MapSelection>(NO_MAP);

/** What a card reads to highlight itself and to print its pin number. */
export function useMapSelection(): MapSelection {
  return useContext(MapSelectionContext);
}

interface Picked {
  id: string | null;
  from: SelectionSource | null;
}

const NOTHING: Picked = { id: null, from: null };

export function MapSelectionProvider({
  places,
  mapOnScreen,
  listOnScreen,
  view,
  setView,
  children,
}: {
  places: readonly MapPlace[];
  mapOnScreen: boolean;
  listOnScreen: boolean;
  view: MapView;
  setView: (view: MapView) => void;
  children: ReactNode;
}) {
  const [picked, setPicked] = useState<Picked>(NOTHING);

  const select = useCallback((id: string | null, from: SelectionSource = "card") => {
    setPicked((current) =>
      current.id === id && current.from === (id === null ? null : from)
        ? current
        : id === null
          ? NOTHING
          : { id, from },
    );
  }, []);

  const numbers = useMemo(() => {
    const byId = new Map<string, number>();
    for (const place of places) byId.set(place.id, place.number);
    return byId;
  }, [places]);

  const numberOf = useCallback(
    (id: string) => (mapOnScreen ? (numbers.get(id) ?? null) : null),
    [numbers, mapOnScreen],
  );

  const value = useMemo<MapSelection>(
    () => ({
      selectedId: picked.id,
      selectedFrom: picked.from,
      select,
      numberOf,
      mapOnScreen,
      listOnScreen,
      view,
      setView,
    }),
    [picked, select, numberOf, mapOnScreen, listOnScreen, view, setView],
  );

  return <MapSelectionContext.Provider value={value}>{children}</MapSelectionContext.Provider>;
}

/** Only for tests and for a screen that wants a fixed selection; the provider is the usual way. */
export const MapSelectionContextForTests = MapSelectionContext;
