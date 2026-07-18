"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableItem } from "@/components/strength/SortableItem";
import { SortChips } from "@/components/strength/SortChips";
import { sortExerciseList, type ExerciseSortMode } from "@/lib/strength/sort";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import { EXERCISES } from "@/lib/strength/program";
import { estimateWorkoutDuration } from "@/lib/strength/estimate";
import { getVideoId } from "@/lib/strength/videos";
import { formatWeightKg } from "@/lib/units";
import { snapToLevel } from "@/lib/strength/weights";
import { formatRecency } from "@/lib/recency";
import { VideoSheet } from "@/components/strength/VideoSheet";
import type { Equipment, ExerciseDef } from "@/lib/strength/types";
import {
  DEFAULT_EQUIPMENT,
  EQUIPMENT_OPTIONS,
  loadEquipment,
  saveEquipment,
} from "@/lib/strength/equipment";
import type { CustomWorkoutInput } from "@/hooks/useCustomWorkouts";

interface DraftSlot {
  key: string;
  exerciseSlug: string;
  sets: number;
  repLow: number;
  repHigh: number;
  weightKg?: number;
  restSeconds: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (input: CustomWorkoutInput) => Promise<void>;
  /** Prefill when editing a saved template (rename, add/remove/tune slots). */
  initial?: { name: string; slots: Array<{ exerciseSlug: string; sets: number; repLow: number; repHigh: number; weightKg?: number | null; restSeconds: number }> } | null;
}

// Picker groups by the lift's primary muscle (falls back to "Other").
const MUSCLE_ORDER = [
  "Shoulders",
  "Chest",
  "Back",
  "Arms",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves & Achilles",
  "Core",
  "Other",
];

let draftKey = 0;

export function CustomWorkoutBuilder({ open, onClose, onSave, initial }: Props) {
  const [name, setName] = useState("");
  const [slots, setSlots] = useState<DraftSlot[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [videoSlug, setVideoSlug] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>(DEFAULT_EQUIPMENT);
  // First open ever: ask about equipment before showing the builder.
  const [equipmentStep, setEquipmentStep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "custom" = the user's manual (drag) order; picking a sort reorders slots.
  const [sortMode, setSortMode] = useState<ExerciseSortMode>("custom");

  // Long-press drag (250ms) so taps still expand a slot and the sheet scrolls.
  // MouseSensor + TouchSensor, NOT PointerSensor: on iOS the pointer sensor
  // cannot cancel scroll panning, so drags activate and then never move.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  // Reset the draft each time the sheet opens; ask about equipment on the
  // very first use (persisted afterwards, editable via the Equipment chip).
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setSlots(
        (initial?.slots ?? []).map((sl) => ({
          key: `d${draftKey++}`,
          exerciseSlug: sl.exerciseSlug,
          sets: sl.sets,
          repLow: sl.repLow,
          repHigh: sl.repHigh,
          weightKg: sl.weightKg ?? undefined,
          restSeconds: sl.restSeconds,
        }))
      );
      setExpanded(null);
      setError(null);
      setSortMode("custom");
      const stored = loadEquipment();
      setEquipment(stored ?? DEFAULT_EQUIPMENT);
      setEquipmentStep(stored == null && !initial);
    }
  }, [open, initial]);

  // Last-used weight/reps per exercise (prefill) + how often each exercise
  // was performed (frequency sort).
  const [lastUsed, setLastUsed] = useState<Record<string, { weightKg: number | null; repLow: number; repHigh: number; date: string | null }>>({});
  const [freq, setFreq] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const res = await apiFetch("/api/strength/exercises");
        if (!res.ok) return;
        const rows: Array<{ slug: string; lastWeightKg: number | null; lastRepLow: number | null; lastRepHigh: number | null; lastDate: string | null; timesPerformed?: number }> = await res.json();
        const map: Record<string, { weightKg: number | null; repLow: number; repHigh: number; date: string | null }> = {};
        const counts: Record<string, number> = {};
        for (const r of rows) {
          counts[r.slug] = r.timesPerformed ?? 0;
          if (r.lastRepLow != null && r.lastRepHigh != null) {
            map[r.slug] = { weightKg: r.lastWeightKg, repLow: r.lastRepLow, repHigh: r.lastRepHigh, date: r.lastDate };
          }
        }
        setLastUsed(map);
        setFreq(counts);
      } catch {
        /* defaults are fine */
      }
    })();
  }, [open]);

  function toggleEquipment(key: Equipment) {
    haptic("light");
    setEquipment((eq) =>
      eq.includes(key) ? eq.filter((e) => e !== key) : [...eq, key]
    );
  }

  function confirmEquipment() {
    saveEquipment(equipment);
    setEquipmentStep(false);
  }

  const estMinutes = useMemo(
    () => (slots.length ? estimateWorkoutDuration(slots) : 0),
    [slots]
  );

  function addExercise(ex: ExerciseDef) {
    haptic("light");
    const last = lastUsed[ex.slug];
    const slot: DraftSlot = {
      key: `d${draftKey++}`,
      exerciseSlug: ex.slug,
      sets: ex.defaultSets ?? 3,
      repLow: last?.repLow ?? ex.repLow ?? 8,
      repHigh: last?.repHigh ?? ex.repHigh ?? 12,
      weightKg: last?.weightKg ?? ex.startWeightKg,
      restSeconds: 90,
    };
    setSlots((s) => [...s, slot]);
    setPickerOpen(false);
    setExpanded(slot.key);
  }

  function patchSlot(key: string, patch: Partial<DraftSlot>) {
    setSlots((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }

  function removeSlot(key: string) {
    haptic("light");
    setSlots((s) => s.filter((x) => x.key !== key));
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    haptic("light");
    setSortMode("custom");
    setSlots((s) => {
      const from = s.findIndex((x) => x.key === active.id);
      const to = s.findIndex((x) => x.key === over.id);
      if (from < 0 || to < 0) return s;
      return arrayMove(s, from, to);
    });
  }

  // Applying a sort reorders the draft slots themselves — the saved template
  // keeps whatever order is on screen, same as a manual drag.
  function applySort(mode: ExerciseSortMode) {
    setSortMode(mode);
    if (mode === "custom") return;
    setSlots((s) =>
      sortExerciseList(s, mode, {
        name: (x) => EXERCISES.find((e) => e.slug === x.exerciseSlug)?.name ?? x.exerciseSlug,
        weightKg: (x) => x.weightKg ?? null,
        timesPerformed: (x) => freq[x.exerciseSlug] ?? 0,
      })
    );
  }

  async function save() {
    if (!name.trim()) {
      setError("Give the workout a name.");
      return;
    }
    if (slots.length === 0) {
      setError("Add at least one exercise.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        slots: slots.map(({ exerciseSlug, sets, repLow, repHigh, weightKg, restSeconds }) => {
          // Cleared fields hold NaN until blur — restore defaults on save too.
          const lo = Number.isNaN(repLow) ? 8 : repLow;
          const hi = Number.isNaN(repHigh) ? 12 : repHigh;
          const w = weightKg != null && Number.isNaN(weightKg) ? undefined : weightKg;
          return {
            exerciseSlug,
            sets: Number.isNaN(sets) ? 3 : sets,
            repLow: Math.min(lo, hi),
            repHigh: Math.max(lo, hi),
            // Free-typed weights snap onto the standard ladder.
            weightKg: w != null && w > 0 ? snapToLevel(w) : w,
            restSeconds: Number.isNaN(restSeconds) ? 90 : restSeconds,
          };
        }),
      });
      onClose();
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const have = new Set(equipment);
    const g = new Map<string, ExerciseDef[]>();
    for (const ex of EXERCISES) {
      // Available iff every required item is on hand (empty = bodyweight).
      if ((ex.equipment ?? []).some((e) => !have.has(e))) continue;
      const key = ex.primaryMuscle ?? "Other";
      const list = g.get(key) ?? [];
      list.push(ex);
      g.set(key, list);
    }
    return [...g.entries()].sort(
      (a, b) => MUSCLE_ORDER.indexOf(a[0]) - MUSCLE_ORDER.indexOf(b[0])
    );
  }, [equipment]);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={equipmentStep ? "What do you have?" : initial ? "Edit workout" : "New custom workout"}
      >
        {equipmentStep ? (
          <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto px-4 pb-6">
            <p className="text-[13px] text-text-3">
              Pick everything you can easily use — bodyweight moves are always
              included. You can change this anytime.
            </p>
            <div className="flex flex-col gap-2">
              {EQUIPMENT_OPTIONS.map((opt) => {
                const on = equipment.includes(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggleEquipment(opt.key)}
                    className={`press flex items-center justify-between rounded-[var(--radius-input)] px-3.5 py-3 text-left ${
                      on ? "bg-accent/15" : "bg-elevated"
                    }`}
                  >
                    <span className="text-[15px] font-semibold text-text-1">{opt.label}</span>
                    <span
                      aria-hidden
                      className={`flex h-6 w-6 items-center justify-center rounded-md border text-[13px] font-bold ${
                        on
                          ? "border-transparent bg-accent text-on-accent"
                          : "border-hairline bg-transparent text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
            <Button full onClick={confirmEquipment}>
              Continue
            </Button>
          </div>
        ) : (
        <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto px-4 pb-6">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workout name"
            className="w-full rounded-[var(--radius-input)] bg-elevated px-3.5 py-3 text-[16px] font-medium text-text-1 placeholder:text-text-3 outline-none"
          />

          {slots.length > 1 && (
            <div>
              <SortChips mode={sortMode} onSelect={applySort} />
              <p className="mt-1.5 text-[12px] text-text-3">Hold and drag a card to reorder.</p>
            </div>
          )}

          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragStart={() => haptic("light")}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={slots.map((s) => s.key)} strategy={verticalListSortingStrategy}>
          {slots.map((slot) => {
            const ex = EXERCISES.find((e) => e.slug === slot.exerciseSlug);
            const isOpen = expanded === slot.key;
            return (
              <SortableItem key={slot.key} id={slot.key} className="k-card p-3.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(isOpen ? null : slot.key)}
                  >
                    <span className="block truncate text-[15px] font-bold text-text-1">
                      {ex?.name ?? slot.exerciseSlug}
                    </span>
                    <span className="block text-[13px] text-text-3">
                      {slot.sets} × {slot.repLow === slot.repHigh ? slot.repLow : `${slot.repLow}–${slot.repHigh}`}
                      {slot.weightKg != null ? ` · ${formatWeightKg(slot.weightKg)}` : ""} · {slot.restSeconds}s rest
                    </span>
                  </button>
                  <motion.span animate={{ rotate: isOpen ? 180 : 0 }}>
                    <ChevronDown className="h-4 w-4 text-text-3" strokeWidth={1.9} />
                  </motion.span>
                  <button
                    type="button"
                    aria-label="Remove exercise"
                    onClick={() => removeSlot(slot.key)}
                    className="press flex h-8 w-8 items-center justify-center rounded-lg bg-elevated"
                  >
                    <Trash2 className="h-4 w-4 text-danger" strokeWidth={1.9} />
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <Field
                      label="Sets"
                      value={slot.sets}
                      fallback={3}
                      onChange={(v) => patchSlot(slot.key, { sets: clamp(v, 1, 20) })}
                    />
                    <div>
                      <span className="mb-1 block text-[12px] font-medium text-text-3">Rest</span>
                      <div className="flex gap-1.5">
                        {[30, 60, 90].map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => { haptic("light"); patchSlot(slot.key, { restSeconds: sec }); }}
                            className={`press flex-1 rounded-[var(--radius-input)] py-2 text-[13px] font-bold ${
                              slot.restSeconds === sec ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>
                    <Field
                      label="Reps from"
                      value={slot.repLow}
                      fallback={8}
                      onChange={(v) => patchSlot(slot.key, { repLow: clamp(v, 1, 100) })}
                    />
                    <Field
                      label="Reps to"
                      value={slot.repHigh}
                      fallback={12}
                      onChange={(v) => patchSlot(slot.key, { repHigh: clamp(v, 1, 100) })}
                    />
                    <div className="col-span-2">
                      <Field
                        label="Weight (kg, optional)"
                        value={slot.weightKg ?? ""}
                        decimal
                        onChange={(v) =>
                          patchSlot(slot.key, {
                            weightKg: Number.isNaN(v) ? undefined : clamp(v, 0, 500),
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </SortableItem>
            );
          })}
            </SortableContext>
          </DndContext>

          <Button variant="secondary" full onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Add exercise
          </Button>

          <button
            type="button"
            onClick={() => { haptic("light"); setEquipmentStep(true); }}
            className="press text-center text-[13px] font-semibold text-accent"
          >
            Equipment: {equipment.length ? EQUIPMENT_OPTIONS.filter((o) => equipment.includes(o.key)).map((o) => o.label).join(", ") : "bodyweight only"} — change
          </button>

          {slots.length > 0 && (
            <p className="text-center text-[13px] text-text-3">
              {slots.length} exercise{slots.length === 1 ? "" : "s"} · ~{estMinutes} min
            </p>
          )}

          {error && (
            <p className="rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}

          <Button full busy={busy} onClick={save} disabled={!name.trim() || slots.length === 0}>
            {initial ? "Save changes" : "Save workout"}
          </Button>
        </div>
        )}
      </Sheet>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add exercise">
        <div className="max-h-[60dvh] overflow-y-auto px-4 pb-6">
          {grouped.map(([muscle, list]) => (
            <div key={muscle} className="mb-4">
              <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">
                {muscle}
              </p>
              <div className="flex flex-col gap-1.5">
                {list.map((ex) => (
                  <div
                    key={ex.slug}
                    className="flex items-center rounded-[var(--radius-input)] bg-elevated"
                  >
                    <button
                      type="button"
                      onClick={() => addExercise(ex)}
                      className="press min-w-0 flex-1 px-3.5 py-2.5 text-left"
                    >
                      <span className="block text-[15px] font-semibold text-text-1">{ex.name}</span>
                      {lastUsed[ex.slug] && (
                        <span className="block text-[12px] text-text-3">
                          Last:{" "}
                          {lastUsed[ex.slug].weightKg != null ? `${formatWeightKg(lastUsed[ex.slug].weightKg!)} × ` : ""}
                          {lastUsed[ex.slug].repLow === lastUsed[ex.slug].repHigh
                            ? lastUsed[ex.slug].repLow
                            : `${lastUsed[ex.slug].repLow}–${lastUsed[ex.slug].repHigh}`}
                          {lastUsed[ex.slug].date ? ` · ${formatRecency(lastUsed[ex.slug].date!)}` : ""}
                        </span>
                      )}
                      {ex.secondaryMuscles && ex.secondaryMuscles.length > 0 && (
                        <span className="block text-[12px] text-text-3">
                          also {ex.secondaryMuscles.join(", ").toLowerCase()}
                        </span>
                      )}
                    </button>
                    {getVideoId(ex.slug) && (
                      <button
                        type="button"
                        aria-label={`Watch ${ex.name} demo`}
                        onClick={() => { haptic("light"); setVideoSlug(ex.slug); }}
                        className="press px-3 py-2.5 text-[13px] font-bold text-accent"
                      >
                        ▶
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Sheet>

      <VideoSheet
        slug={videoSlug}
        title={videoSlug ? EXERCISES.find((e) => e.slug === videoSlug)?.name : undefined}
        onClose={() => setVideoSlug(null)}
      />
    </>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function Field({
  label,
  value,
  onChange,
  step,
  decimal,
  fallback,
}: {
  label: string;
  value: number | "";
  onChange: (v: number) => void;
  step?: number;
  decimal?: boolean;
  /** Value restored when the field is cleared (NaN guard). Omit to allow empty (weight). */
  fallback?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-text-3">{label}</span>
      <input
        type="number"
        inputMode={decimal ? "decimal" : "numeric"}
        step={step ?? (decimal ? 0.5 : 1)}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => {
          const v = decimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
          onChange(v); // NaN renders as an empty field; blur/save restore sane values
        }}
        onBlur={(e) => {
          const v = decimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
          if (Number.isNaN(v) && fallback !== undefined) onChange(fallback);
        }}
        className="w-full rounded-[var(--radius-input)] bg-elevated px-3 py-2 text-[15px] font-semibold text-text-1 outline-none"
      />
    </label>
  );
}
