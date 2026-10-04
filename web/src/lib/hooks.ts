import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AgentSessionsStore, type AgentSessionsState } from "../networking/agentSessionsStore";
import { RuntimeBriefModeStore } from "../networking/dataSource";

export function useAgentSessionsStore(): AgentSessionsState {
  const store = AgentSessionsStore.shared;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(
    RuntimeBriefModeStore.subscribe,
    () => RuntimeBriefModeStore.isDemoEnabled,
    () => false,
  );
}

/** Mirrors `scenePhase == .active`: refresh when the tab becomes visible again. */
export function useOnBecomeActive(callback: () => void): void {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);
}

/** Repeats `task` every `intervalMs` while `enabled`, like a `.task` loop with `Task.sleep`. */
export function usePolling(task: () => Promise<void> | void, intervalMs: number, enabled = true): void {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (cancelled) return;
      await latest.current();
      if (cancelled) return;
      timer = setTimeout(loop, intervalMs);
    };
    timer = setTimeout(loop, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, enabled]);
}

const PULL_THRESHOLD = 72;

/** Touch pull-to-refresh for the list screen (`.refreshable`). */
export function usePullToRefresh(onRefresh: () => Promise<void>): { pulling: boolean; refreshing: boolean } {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;

  const trigger = useCallback(async () => {
    setRefreshing(true);
    try {
      await latest.current();
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const onStart = (event: TouchEvent) => {
      if (window.scrollY <= 0 && event.touches.length === 1) {
        startY.current = event.touches[0]?.clientY ?? null;
      } else {
        startY.current = null;
      }
    };
    const onMove = (event: TouchEvent) => {
      if (startY.current === null) return;
      const delta = (event.touches[0]?.clientY ?? 0) - startY.current;
      setPulling(delta > PULL_THRESHOLD);
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      setPulling((was) => {
        if (was) void trigger();
        return false;
      });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [trigger]);

  return { pulling, refreshing };
}
