"use client";

import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { haptic } from "@/lib/haptics";
import { getVideoId } from "@/lib/strength/videos";
import { formatWeightKg } from "@/lib/units";
import { formatRecency } from "@/lib/recency";
import type { ExerciseDef } from "@/lib/strength/types";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/strength/muscle-groups";
import { filterExercises } from "@/lib/strength/exercise-search";

// Picker groups the *unfiltered, unfiltered-by-chip* browse view by the
// lift's raw primaryMuscle (finer-grained than the MuscleGroup chips) so it
// still reads as "Quads", "Chest", etc. As soon as a chip is on (or there's
// a search term) we drop this and show a flat, ranked list instead — a
// Biceps chip can only match some exercises via secondaryMuscles (see
// exercise-search.ts), and those don't have a stable single raw-muscle
// heading to sit under.
const MUSCLE_ORDER = [
  "Shoulders",
  "Chest",
  "Back",
  "Lower back",
  "Biceps",
  "Triceps",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Adductors",
  "Calves & Achilles",
  "Calves",
  "Shin (tibialis anterior)",
  "Core",
  "Other",
];

interface LastUsedEntry {
  weightKg: number | null;
  repLow: number;
  repHigh: number;
  date: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Already equipment-filtered exercise list. */
  exercises: ExerciseDef[];
  lastUsed: Record<string, LastUsedEntry>;
  onSelect: (ex: ExerciseDef) => void;
  onWatchVideo: (slug: string) => void;
}

export function ExercisePicker({ open, onClose, exercises, lastUsed, onSelect, onWatchVideo }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<MuscleGroup | null>(null);

  // Start each visit to the picker unfiltered — a leftover search from last
  // time you added an exercise is more surprising than helpful.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset filters on each open, same pattern as the builder's own draft reset
      setQuery("");
      setGroup(null);
    }
  }, [open]);

  const hasFilter = query.trim().length > 0 || group !== null;

  function clearFilters() {
    setQuery("");
    setGroup(null);
  }

  // Any active filter (search text or a muscle chip) switches to a flat,
  // ranked list — see the MUSCLE_ORDER comment above for why the raw-muscle
  // headings only make sense for the fully unfiltered browse view.
  const filtered = query.trim().length > 0 || group !== null;

  const filteredResults = useMemo(
    () => (filtered ? filterExercises(exercises, { query, group }) : []),
    [exercises, query, group, filtered]
  );

  const grouped = useMemo(() => {
    if (filtered) return [];
    const g = new Map<string, ExerciseDef[]>();
    for (const ex of exercises) {
      const key = ex.primaryMuscle ?? "Other";
      const list = g.get(key) ?? [];
      list.push(ex);
      g.set(key, list);
    }
    return [...g.entries()].sort((a, b) => MUSCLE_ORDER.indexOf(a[0]) - MUSCLE_ORDER.indexOf(b[0]));
  }, [exercises, filtered]);

  const resultCount = filtered ? filteredResults.length : grouped.reduce((n, [, list]) => n + list.length, 0);

  function renderExercise(ex: ExerciseDef) {
    const last = lastUsed[ex.slug];
    return (
      <div key={ex.slug} className="flex items-center rounded-[var(--radius-input)] bg-elevated">
        <button
          type="button"
          onClick={() => onSelect(ex)}
          className="press min-w-0 flex-1 px-3.5 py-2.5 text-left"
        >
          <span className="block text-[15px] font-semibold text-text-1">{ex.name}</span>
          {last && (
            <span className="block text-[12px] text-text-3">
              Last: {last.weightKg != null ? `${formatWeightKg(last.weightKg)} × ` : ""}
              {last.repLow === last.repHigh ? last.repLow : `${last.repLow}–${last.repHigh}`}
              {last.date ? ` · ${formatRecency(last.date)}` : ""}
            </span>
          )}
          {ex.secondaryMuscles && ex.secondaryMuscles.length > 0 && (
            <span className="block text-[12px] text-text-3">also {ex.secondaryMuscles.join(", ").toLowerCase()}</span>
          )}
        </button>
        {getVideoId(ex.slug) && (
          <button
            type="button"
            aria-label={`Watch ${ex.name} demo`}
            onClick={() => { haptic("light"); onWatchVideo(ex.slug); }}
            className="press px-3 py-2.5 text-[13px] font-bold text-accent-fg"
          >
            ▶
          </button>
        )}
      </div>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add exercise">
      <div className="flex max-h-[60dvh] flex-col gap-3 px-4 pb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises"
          aria-label="Search exercises"
          className="w-full shrink-0 rounded-[var(--radius-input)] bg-elevated px-3.5 py-3 text-[16px] font-medium text-text-1 placeholder:text-text-3 outline-none"
        />

        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {MUSCLE_GROUPS.map((g) => {
            const on = group === g;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                onClick={() => { haptic("light"); setGroup(on ? null : g); }}
                className={`press inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-[12px] font-bold ${
                  on ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                }`}
              >
                {g}
              </button>
            );
          })}
          {hasFilter && (
            <button
              type="button"
              onClick={() => { haptic("light"); clearFilters(); }}
              className="press inline-flex min-h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-[12px] font-bold text-accent-fg"
            >
              Clear
            </button>
          )}
        </div>

        <div className="overflow-y-auto">
          {resultCount === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[13px] text-text-3">No exercises match.</p>
              <button
                type="button"
                onClick={() => { haptic("light"); clearFilters(); }}
                className="press rounded-[var(--radius-input)] bg-elevated px-4 py-2 text-[13px] font-bold text-accent-fg"
              >
                Clear filters
              </button>
            </div>
          ) : filtered ? (
            <div className="flex flex-col gap-1.5">{filteredResults.map(renderExercise)}</div>
          ) : (
            grouped.map(([muscle, list]) => (
              <div key={muscle} className="mb-4">
                <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">{muscle}</p>
                <div className="flex flex-col gap-1.5">{list.map(renderExercise)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </Sheet>
  );
}
