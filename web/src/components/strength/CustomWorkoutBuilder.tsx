"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { EXERCISES } from "@/lib/strength/program";
import { estimateWorkoutDuration } from "@/lib/strength/estimate";
import type { ExerciseDef } from "@/lib/strength/types";
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
}

const CATEGORY_LABEL: Record<ExerciseDef["category"], string> = {
  upper: "Upper",
  lower: "Lower",
  achilles: "Achilles",
  full_body: "Full body",
};

let draftKey = 0;

export function CustomWorkoutBuilder({ open, onClose, onSave }: Props) {
  const [name, setName] = useState("");
  const [slots, setSlots] = useState<DraftSlot[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the draft each time the sheet opens.
  useEffect(() => {
    if (open) {
      setName("");
      setSlots([]);
      setExpanded(null);
      setError(null);
    }
  }, [open]);

  const estMinutes = useMemo(
    () => (slots.length ? estimateWorkoutDuration(slots) : 0),
    [slots]
  );

  function addExercise(ex: ExerciseDef) {
    haptic("light");
    const slot: DraftSlot = {
      key: `d${draftKey++}`,
      exerciseSlug: ex.slug,
      sets: ex.defaultSets ?? 3,
      repLow: ex.repLow ?? 8,
      repHigh: ex.repHigh ?? 12,
      weightKg: ex.startWeightKg,
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
          return {
            exerciseSlug,
            sets: Number.isNaN(sets) ? 3 : sets,
            repLow: Math.min(lo, hi),
            repHigh: Math.max(lo, hi),
            weightKg: weightKg != null && Number.isNaN(weightKg) ? undefined : weightKg,
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
    const g = new Map<ExerciseDef["category"], ExerciseDef[]>();
    for (const ex of EXERCISES) {
      const list = g.get(ex.category) ?? [];
      list.push(ex);
      g.set(ex.category, list);
    }
    return g;
  }, []);

  return (
    <>
      <Sheet open={open} onClose={onClose} title="New custom workout">
        <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto px-4 pb-6">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workout name"
            className="w-full rounded-[var(--radius-input)] bg-elevated px-3.5 py-3 text-[16px] font-medium text-text-1 placeholder:text-text-3 outline-none"
          />

          {slots.map((slot) => {
            const ex = EXERCISES.find((e) => e.slug === slot.exerciseSlug);
            const isOpen = expanded === slot.key;
            return (
              <div key={slot.key} className="k-card p-3.5">
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
                      {slot.weightKg != null ? ` · ${slot.weightKg} kg` : ""} · {slot.restSeconds}s rest
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
                    <Field
                      label="Rest (s)"
                      value={slot.restSeconds}
                      step={15}
                      fallback={90}
                      onChange={(v) => patchSlot(slot.key, { restSeconds: clamp(v, 0, 600) })}
                    />
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
              </div>
            );
          })}

          <Button variant="secondary" full onClick={() => setPickerOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            Add exercise
          </Button>

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
            Save workout
          </Button>
        </div>
      </Sheet>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add exercise">
        <div className="max-h-[60dvh] overflow-y-auto px-4 pb-6">
          {[...grouped.entries()].map(([category, list]) => (
            <div key={category} className="mb-4">
              <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">
                {CATEGORY_LABEL[category]}
              </p>
              <div className="flex flex-col gap-1.5">
                {list.map((ex) => (
                  <button
                    key={ex.slug}
                    type="button"
                    onClick={() => addExercise(ex)}
                    className="press rounded-[var(--radius-input)] bg-elevated px-3.5 py-2.5 text-left"
                  >
                    <span className="block text-[15px] font-semibold text-text-1">{ex.name}</span>
                    {(ex.equipmentNote || ex.tempoNote) && (
                      <span className="block text-[12px] text-text-3">
                        {ex.equipmentNote ?? ex.tempoNote}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
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
