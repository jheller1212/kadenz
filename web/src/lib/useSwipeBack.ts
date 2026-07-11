"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "./haptics";

const EDGE = 28; // px from the left edge where the gesture may start
const TRIGGER_X = 90; // horizontal travel to fire
const MAX_SLOPE = 0.6; // |dy/dx| above this = it's a scroll, not a swipe

/**
 * iOS edge-swipe-back for detail screens (standalone PWAs have no browser
 * chrome). Starts only from the left edge; fires router.back() when the
 * swipe travels far enough and stays mostly horizontal.
 */
export function useSwipeBack(enabled: boolean = true) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    let startX: number | null = null;
    let startY = 0;
    let fired = false;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      startX = t.clientX <= EDGE ? t.clientX : null;
      startY = t.clientY;
      fired = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (startX === null || fired) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx > 12 && dy / dx > MAX_SLOPE) {
        startX = null; // diagonal/vertical — treat as scroll
        return;
      }
      if (dx >= TRIGGER_X) {
        fired = true;
        startX = null;
        haptic("light");
        router.back();
      }
    }

    function onTouchEnd() {
      startX = null;
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, router]);
}
