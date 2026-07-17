"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

interface Props {
  min: number;
  max: number;
  /** Value increment between rows (default 1). */
  step?: number;
  value: number;
  onChange: (value: number) => void;
  /** Rendered to the right of the selection band (e.g. "bpm"). */
  unit?: string;
}

const ROW_H = 44; // px per row
const VISIBLE_ROWS = 5; // odd, so one row sits dead-centre
const PAD = ((VISIBLE_ROWS - 1) / 2) * ROW_H; // lets first/last values centre

// iOS-style drum picker: a snap-scrolling column of numbers with a fixed
// highlight band over the centre row. Scroll settles via scroll-snap; we
// debounce scroll events to detect the settled row and fire onChange.
export function WheelPicker({ min, max, step = 1, value, onChange, unit }: Props) {
  const values = useMemo(() => {
    const out: number[] = [];
    for (let v = min; v <= max; v += step) out.push(v);
    return out;
  }, [min, max, step]);

  const clampIdx = (i: number) => Math.max(0, Math.min(values.length - 1, i));
  const valueIdx = clampIdx(Math.round((value - min) / step));

  const scrollerRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [centerIdx, setCenterIdx] = useState(valueIdx);
  const centerIdxRef = useRef(valueIdx);

  // Position the drum on the current value at mount (and when the value is
  // changed from outside, e.g. reopening with a different draft).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (centerIdxRef.current !== valueIdx) {
      el.scrollTo({ top: valueIdx * ROW_H, behavior: "instant" });
      centerIdxRef.current = valueIdx;
      setCenterIdx(valueIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueIdx]);

  // Initial mount: scroll before paint so the drum never flashes at the top.
  useLayoutEffect(() => {
    scrollerRef.current?.scrollTo({ top: valueIdx * ROW_H, behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = clampIdx(Math.round(el.scrollTop / ROW_H));
    if (idx !== centerIdxRef.current) {
      centerIdxRef.current = idx;
      setCenterIdx(idx);
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const settled = clampIdx(Math.round(el.scrollTop / ROW_H));
      const next = values[settled];
      if (next !== value) {
        haptic("light");
        onChange(next);
      }
    }, 120);
  }

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  return (
    <div
      className="relative mx-auto w-full max-w-[220px]"
      style={{ height: ROW_H * VISIBLE_ROWS }}
      // Keep parent drag gestures (e.g. the Sheet's drag-to-dismiss) from
      // hijacking touch scrolling inside the drum.
      onPointerDownCapture={(e) => e.stopPropagation()}
      onTouchMoveCapture={(e) => e.stopPropagation()}
    >
      {/* Centre highlight band */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-xl bg-elevated"
        style={{ height: ROW_H }}
      />
      {unit && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 ml-10 -translate-y-1/2 text-[15px] font-semibold text-text-3"
        >
          {unit}
        </span>
      )}

      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitOverflowScrolling: "touch", paddingTop: PAD, paddingBottom: PAD }}
        role="listbox"
        aria-label={unit ? `Value in ${unit}` : "Value"}
        aria-activedescendant={`wheel-opt-${values[centerIdx]}`}
      >
        {values.map((v, i) => {
          const dist = Math.abs(i - centerIdx);
          const isCenter = dist === 0;
          return (
            <div
              key={v}
              id={`wheel-opt-${v}`}
              role="option"
              aria-selected={isCenter}
              className="flex snap-center items-center justify-center tabular-nums transition-opacity duration-100"
              style={{
                height: ROW_H,
                fontSize: isCenter ? 24 : 17,
                fontWeight: isCenter ? 700 : 500,
                color: isCenter ? "var(--k-text-1)" : "var(--k-text-2)",
                opacity: isCenter ? 1 : dist === 1 ? 0.6 : 0.3,
              }}
            >
              {v}
            </div>
          );
        })}
      </div>
    </div>
  );
}
