"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { EXERCISES } from "@/lib/strength/program";
import { estimateWorkoutDuration } from "@/lib/strength/estimate";
import { getVideoId } from "@/lib/strength/videos";
import { VideoSheet } from "@/components/strength/VideoSheet";
import type { Equipment, ExerciseDef } from "@/lib/strength/types";
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

const EQUIPMENT_OPTIONS: Array<{ key: Equipment; label: string; hint?: string }> = [
  { key: "dumbbell", label: "Dumbbells" },
  { key: "chair", label: "Chair" },
  { key: "box", label: "Box / step" },
  { key: "bench", label: "Bench" },
  { key: "barbell", label: "Barbell" },
  { key: "kettlebell", label: "Kettlebell" },
  { key: "pullup_bar", label: "Pull-up bar" },
  { key: "band", label: "Resistance band" },
];

const EQUIPMENT_STORAGE_KEY = "kadenz_equipment";
const DEFAULT_EQUIPMENT: Equipment[] = ["dumbbell", "chair", "box"];

function loadEquipment(): Equipment[] | null {
  try {
    const raw = localStorage.getItem(EQUIPMENT_STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as Equipment[]) : null;
  } catch {
    return null;
  }
}

function saveEquipment(eq: Equipment[]) {
  try {
    localStorage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify(eq));
  } catch {
    /* private mode */
  }
}

let draftKey = 0;

export function CustomWorkoutBuilder({ open, onClose, onSave }: Props) {
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

  // Reset the draft each time the sheet opens; ask about equipment on the
  // very first use (persisted afterwards, editable via the Equipment chip).
  useEffect(() => {
    if (open) {
      setName("");
      setSlots([]);
      setExpanded(null);
      setError(null);
      const stored = loadEquipment();
      setEquipment(stored ?? DEFAULT_EQUIPMENT);
      setEquipmentStep(stored == null);
    }
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
        title={equipmentStep ? "What do you have?" : "New custom workout"}
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
            Save workout
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
                      {ex.secondaryMuscles && ex.secondaryMuscles.length > 0 && (
                        <span className="block text-[12px] text-text-3">
                          also {ex.secondaryMuscles.join(", ").toLowerCase()}
                        </span>
                      )}
                      {(ex.equipmentNote || ex.tempoNote) && (
                        <span className="block text-[12px] text-text-3">
                          {ex.equipmentNote ?? ex.tempoNote}
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
