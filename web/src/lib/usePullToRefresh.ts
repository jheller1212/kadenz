"use client";

import { useEffect, useRef, useState } from "react";
import { haptic } from "./haptics";

const THRESHOLD = 72; // px of damped pull to trigger
const MAX_PULL = 110;

/**
 * iOS-style pull-to-refresh on the page scroll. Attach the returned pull
 * state to a spinner row; `refreshing` stays true until `onRefresh` resolves.
 * Only engages when the page is scrolled to the very top.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      startY.current = window.scrollY <= 0 && !refreshing ? e.touches[0].clientY : null;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        setPull(0);
        return;
      }
      setPull(Math.min(MAX_PULL, dy * 0.45)); // rubber-band damping
    }

    async function onTouchEnd() {
      if (startY.current === null) return;
      startY.current = null;
      if (pull >= THRESHOLD && !refreshing) {
        haptic("medium");
        setRefreshing(true);
        setPull(THRESHOLD * 0.75);
        try {
          await cb.current();
        } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [pull, refreshing]);

  return { pull, refreshing };
}
