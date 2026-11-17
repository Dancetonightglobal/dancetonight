import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startMinuteTicks, MINUTE_MS } from "../../src/ui/home/minute-ticks";

describe("minute-ticks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.setSystemTime(0);
  });

  function createMockDoc(initialState: string) {
    const listeners: Array<() => void> = [];
    let state = initialState;
    return {
      get visibilityState() {
        return state;
      },
      set visibilityState(newState: string) {
        state = newState;
      },
      addEventListener(_type: "visibilitychange", listener: () => void) {
        listeners.push(listener);
      },
      removeEventListener(_type: "visibilitychange", listener: () => void) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
      triggerVisibilityChange() {
        listeners.forEach((fn) => fn());
      },
    };
  }

  it("refreshes at first boundary and every minute after while visible", () => {
    vi.setSystemTime(0);
    const mockDoc = createMockDoc("visible");
    const refresh = vi.fn();
    const stop = startMinuteTicks(refresh, mockDoc, Date.now);

    // At time 0, next minute boundary is at 60000 ms
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(3);

    stop();
    vi.setSystemTime(0);
  });

  it("does not refresh while hidden for 10 minutes", () => {
    vi.setSystemTime(0);
    const mockDoc = createMockDoc("visible");
    const refresh = vi.fn();
    const stop = startMinuteTicks(refresh, mockDoc, Date.now);

    // First minute boundary
    vi.advanceTimersByTime(MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Hide
    mockDoc.visibilityState = "hidden";
    mockDoc.triggerVisibilityChange();
    // Advance 10 minutes
    vi.advanceTimersByTime(10 * MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(1); // No additional calls

    stop();
    vi.setSystemTime(0);
  });

  it("refreshes immediately on return after a boundary passed", () => {
    vi.setSystemTime(0);
    const mockDoc = createMockDoc("visible");
    const refresh = vi.fn();
    const stop = startMinuteTicks(refresh, mockDoc, Date.now);

    // Hide
    mockDoc.visibilityState = "hidden";
    mockDoc.triggerVisibilityChange();
    // Advance past a minute boundary
    vi.advanceTimersByTime(2 * MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(0);

    // Become visible again
    mockDoc.visibilityState = "visible";
    mockDoc.triggerVisibilityChange();
    // Should refresh immediately because we crossed a boundary
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();
    vi.setSystemTime(0);
  });

  it("does not refresh immediately on return within same minute", () => {
    vi.setSystemTime(0);
    const mockDoc = createMockDoc("visible");
    const refresh = vi.fn();
    const stop = startMinuteTicks(refresh, mockDoc, Date.now);

    // Hide at 30 seconds
    vi.advanceTimersByTime(30_000);
    mockDoc.visibilityState = "hidden";
    mockDoc.triggerVisibilityChange();
    // Advance 20 seconds (still within same minute)
    vi.advanceTimersByTime(20_000);
    expect(refresh).toHaveBeenCalledTimes(0);

    // Become visible again
    mockDoc.visibilityState = "visible";
    mockDoc.triggerVisibilityChange();
    // Should NOT refresh immediately because still in same minute
    expect(refresh).toHaveBeenCalledTimes(0);
    // But should schedule next boundary
    vi.advanceTimersByTime(10_000); // Total 60s from start
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();
    vi.setSystemTime(0);
  });

  it("starts hidden -> nothing until visible", () => {
    vi.setSystemTime(0);
    const mockDoc = createMockDoc("hidden");
    const refresh = vi.fn();
    const stop = startMinuteTicks(refresh, mockDoc, Date.now);

    // Advance 5 minutes
    vi.advanceTimersByTime(5 * MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(0);

    // Become visible
    mockDoc.visibilityState = "visible";
    mockDoc.triggerVisibilityChange();
    // Should refresh immediately because we crossed boundaries while hidden
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();
    vi.setSystemTime(0);
  });

  it("repeated visible events do not double the refresh rate", () => {
    vi.setSystemTime(0);
    const mockDoc = createMockDoc("visible");
    const refresh = vi.fn();
    const stop = startMinuteTicks(refresh, mockDoc, Date.now);

    // Trigger multiple visibility changes while staying visible
    mockDoc.triggerVisibilityChange();
    mockDoc.triggerVisibilityChange();
    mockDoc.triggerVisibilityChange();

    // Advance to first boundary
    vi.advanceTimersByTime(MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(1); // Only one refresh, not multiple

    stop();
    vi.setSystemTime(0);
  });

  it("stop() stops everything and removes listener", () => {
    vi.setSystemTime(0);
    const mockDoc = createMockDoc("visible");
    const refresh = vi.fn();
    const stop = startMinuteTicks(refresh, mockDoc, Date.now);

    // Advance to first boundary
    vi.advanceTimersByTime(MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Stop
    stop();
    // Advance more time
    vi.advanceTimersByTime(2 * MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(1); // No more calls

    // Verify listener was removed by trying to trigger visibility change
    mockDoc.triggerVisibilityChange();
    vi.advanceTimersByTime(MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(1); // Still no more calls

    // Calling stop twice is harmless
    stop();
    vi.setSystemTime(0);
  });
});
