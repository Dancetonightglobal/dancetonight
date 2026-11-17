export interface VisibilityDoc {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export const MINUTE_MS = 60_000;

export function startMinuteTicks(
  refresh: () => void,
  doc: VisibilityDoc,
  now: () => number = Date.now,
): () => void {
  let renderedMinute = Math.floor(now() / MINUTE_MS);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const clearAllTimers = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    if (intervalId !== undefined) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  };

  const scheduleNextBoundary = () => {
    clearAllTimers();
    const currentTime = now();
    const toNextMinute = MINUTE_MS - (currentTime % MINUTE_MS);
    timeoutId = setTimeout(() => {
      refresh();
      renderedMinute = Math.floor(now() / MINUTE_MS);
      intervalId = setInterval(() => {
        refresh();
        renderedMinute = Math.floor(now() / MINUTE_MS);
      }, MINUTE_MS);
    }, toNextMinute);
  };

  const handleVisibilityChange = () => {
    if (doc.visibilityState === "visible") {
      const currentMinute = Math.floor(now() / MINUTE_MS);
      if (currentMinute > renderedMinute) {
        refresh();
        renderedMinute = currentMinute;
      }
      scheduleNextBoundary();
    } else {
      clearAllTimers();
    }
  };

  // Initial state
  if (doc.visibilityState === "visible") {
    scheduleNextBoundary();
  }

  doc.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    clearAllTimers();
    doc.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
