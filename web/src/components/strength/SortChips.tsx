"use client";

import { haptic } from "@/lib/haptics";
import { SORT_OPTIONS, type ExerciseSortMode } from "@/lib/strength/sort";

// Compact sort chips shown above pre-workout exercise lists. "Custom" is the
// implicit manual (drag) order and lights up whenever the user has dragged.
export function SortChips({
  mode,
  onSelect,
}: {
  mode: ExerciseSortMode;
  onSelect: (mode: ExerciseSortMode) => void;
}) {
  const chips: Array<{ key: ExerciseSortMode; label: string }> = [
    { key: "custom", label: "Custom" },
    ...SORT_OPTIONS,
  ];
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
      <span className="shrink-0 text-[12px] font-semibold text-text-3">Sort</span>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => {
            haptic("light");
            onSelect(c.key);
          }}
          className={`press shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-bold ${
            mode === c.key ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
