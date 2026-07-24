"use client";

import { useEffect, useRef, useState } from "react";

// Progress model for the plan-building loader.
//
// Plan generation is a single synchronous POST — there are no observable
// server-side stages to report, so there is nothing real to sample mid-flight.
// Instead of faking a timer that loops (which lies about being finished), the
// bar approaches a ceiling asymptotically while the request is genuinely in
// flight, then lands on 100% only once the plan actually exists. It therefore
// never stalls, never moves backwards, and never claims completion early.
//
// If the generator ever grows real milestones, feed them in as `stage` and swap
// the rising curve for a per-stage band — the rest of this stays as-is.

const CEILING = 90; // the rising curve approaches but never reaches this
const TAU_MS = 2200; // time constant of the approach; larger = slower crawl
const LAND_MS = 380; // ramp from wherever we are up to 100%
const HOLD_MS = 400; // hold a full bar so the fill visibly lands
// Keeps a fast local generation from flashing the screen for a few frames.
// Real completion still gates the end — this only sets a lower bound.
const FLOOR_MS = 1800;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Drives 0→100 for the plan-building loader.
 *
 * @param complete flips true when the plan has actually been generated
 * @param onSettled fired once, after the bar has held 100% — navigate here
 */
export function usePlanBuildProgress(complete: boolean, onSettled?: () => void) {
  const [progress, setProgress] = useState(0);

  const completeRef = useRef(complete);
  const settledRef = useRef(false);
  const onSettledRef = useRef(onSettled);

  // Synced in effects, not during render: the rAF loop below reads the latest
  // values without the loop itself having to restart.
  useEffect(() => {
    completeRef.current = complete;
  }, [complete]);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    let landFrom: number | null = null;
    let landAt = 0;
    let current = 0;

    const tick = (now: number) => {
      const elapsed = now - start;

      let next: number;
      if (completeRef.current && elapsed >= FLOOR_MS) {
        // First frame past the floor: latch where the landing ramp starts from.
        if (landFrom === null) {
          landFrom = current;
          landAt = now;
        }
        const k = Math.min(1, (now - landAt) / LAND_MS);
        next = landFrom + (100 - landFrom) * easeOut(k);
      } else {
        next = CEILING * (1 - Math.exp(-elapsed / TAU_MS));
      }

      // Monotonic: the bar is never allowed to retreat.
      current = Math.max(current, Math.min(100, next));
      setProgress(current);

      if (current >= 100) {
        if (!settledRef.current) {
          settledRef.current = true;
          window.setTimeout(() => onSettledRef.current?.(), HOLD_MS);
        }
        return; // stop the loop; nothing left to animate
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return progress;
}
