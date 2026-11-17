"use client";

// The map's front door. Everything above it deals in places and ids; everything below it is
// MapLibre. The canvas is reached with `next/dynamic` and `ssr: false`, so maplibre-gl, its
// worker and its stylesheet are a separate chunk: fetched the moment this renders, or earlier
// when a phone on the list is idle (`preloadMapCanvas`, D-068), and never on first paint.
//
// "use client" because `next/dynamic` with `ssr: false` is only allowed in a Client Component
// (Next 16, "How to lazy load Client Components and libraries"), because the placeholder has to be
// able to give way to the canvas in the browser, and because the error boundary below is a class
// component, which only runs in the browser.
//
// A chunk that does not arrive (a dropped phone connection, or a page left open across a deploy,
// whose chunk names no longer exist) throws where the canvas renders. Nothing caught it, so the
// whole home or event page became Next's "This page couldn't load" (review, 2026-09-28). The
// boundary here keeps it to the map: the map's own failed notice, and "Load the map again".

import dynamic from "next/dynamic";
import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from "react";

import { MapFailed, MapLoading } from "@/src/ui/map/MapStates";
import type { MapCanvasProps } from "@/src/ui/map/types";

/**
 * Fetch the canvas chunk without drawing anything, so tapping Map on a phone does not also wait
 * for 280KB of MapLibre. The same module as the dynamic imports below, so it is the same chunk.
 */
export function preloadMapCanvas(): Promise<unknown> {
  return import("@/src/ui/map/MapCanvas");
}

// Two loaders for one chunk, because a `loading` component is given no props: the home page's
// pane draws its sheet with a hairline, and the detail page frames its own (DetailMap).
const PaneCanvas = dynamic(() => import("@/src/ui/map/MapCanvas"), {
  ssr: false,
  loading: () => <MapLoading framed />,
});
const InlineCanvas = dynamic(() => import("@/src/ui/map/MapCanvas"), {
  ssr: false,
  loading: () => <MapLoading framed={false} />,
});

/** Shows `fallback` in place of a canvas whose code could not be loaded or drawn. */
class CanvasBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function MapPanel(props: MapCanvasProps) {
  const framed = props.inline !== true;
  // A lazy component that failed once fails the same way on every render, so a retry needs a
  // new one, which asks for the chunk again. `attempt` also gives the boundary a new key, which
  // clears its failure.
  const [attempt, setAttempt] = useState(0);
  const [Retried, setRetried] = useState<ComponentType<MapCanvasProps> | null>(null);
  const retry = () => {
    setRetried(() => lazy(() => import("@/src/ui/map/MapCanvas")));
    setAttempt((count) => count + 1);
  };

  const Canvas = framed ? PaneCanvas : InlineCanvas;
  return (
    <CanvasBoundary
      key={attempt}
      fallback={<MapFailed onRetry={retry} className={framed ? "h-full min-h-44" : "h-full"} />}
    >
      {Retried === null ? (
        <Canvas {...props} />
      ) : (
        <Suspense fallback={<MapLoading framed={framed} />}>
          <Retried {...props} />
        </Suspense>
      )}
    </CanvasBoundary>
  );
}
