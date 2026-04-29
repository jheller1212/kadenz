"use client";

import { useRef, useEffect, useCallback } from "react";

interface Props {
  values: number[];
  selected: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  label?: string;
  itemHeight?: number;
}

/**
 * Scroll wheel picker — flick with thumb on mobile, scroll on desktop.
 * Shows 3 visible items with the selected one in the center.
 */
export function ScrollPicker({
  values,
  selected,
  onChange,
  formatValue = (v) => v.toString().padStart(2, "0"),
  label,
  itemHeight = 48,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const visibleItems = 3;
  const containerHeight = itemHeight * visibleItems;
  const selectedIndex = values.indexOf(selected);

  // Scroll to selected value on mount and when selected changes externally
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const targetScroll = selectedIndex * itemHeight;
    if (Math.abs(el.scrollTop - targetScroll) > 2) {
      isScrolling.current = true;
      el.scrollTop = targetScroll;
      setTimeout(() => { isScrolling.current = false; }, 100);
    }
  }, [selectedIndex, itemHeight]);

  const handleScroll = useCallback(() => {
    if (isScrolling.current) return;
    const el = containerRef.current;
    if (!el) return;

    // Debounce: snap to nearest item after scroll stops
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      const index = Math.round(el.scrollTop / itemHeight);
      const clamped = Math.max(0, Math.min(index, values.length - 1));

      // Snap scroll position
      isScrolling.current = true;
      el.scrollTo({ top: clamped * itemHeight, behavior: "smooth" });
      setTimeout(() => { isScrolling.current = false; }, 200);

      if (values[clamped] !== selected) {
        onChange(values[clamped]);
      }
    }, 80);
  }, [itemHeight, values, selected, onChange]);

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative overflow-hidden"
        style={{ height: containerHeight, width: 64 }}
      >
        {/* Selection highlight */}
        <div
          className="absolute left-0 right-0 pointer-events-none z-10 border-y border-accent/30 bg-accent/5"
          style={{ top: itemHeight, height: itemHeight }}
        />

        {/* Fade top */}
        <div className="absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-bg to-transparent z-20 pointer-events-none" />
        {/* Fade bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-bg to-transparent z-20 pointer-events-none" />

        {/* Scrollable list */}
        <div
          ref={containerRef}
          className="h-full overflow-y-scroll scrollbar-none snap-y snap-mandatory"
          style={{
            scrollSnapType: "y mandatory",
            WebkitOverflowScrolling: "touch",
            msOverflowStyle: "none",
            scrollbarWidth: "none",
          }}
          onScroll={handleScroll}
        >
          {/* Top padding (1 empty item) */}
          <div style={{ height: itemHeight }} />

          {values.map((val) => {
            const isSelected = val === selected;
            return (
              <div
                key={val}
                className="flex items-center justify-center snap-center select-none"
                style={{ height: itemHeight }}
              >
                <span
                  className={`text-2xl tabular-nums font-bold transition-all ${
                    isSelected ? "text-text-1 scale-110" : "text-text-3 scale-90 opacity-50"
                  }`}
                >
                  {formatValue(val)}
                </span>
              </div>
            );
          })}

          {/* Bottom padding (1 empty item) */}
          <div style={{ height: itemHeight }} />
        </div>
      </div>
      {label && (
        <span className="text-[10px] text-text-3 uppercase tracking-wider font-medium">{label}</span>
      )}
    </div>
  );
}
