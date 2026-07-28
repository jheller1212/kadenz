import { EXERCISES } from "./program";
import type { Equipment } from "./types";

// Shared equipment selection helpers — the custom builder and the weekly-plan
// wizard read/write the same persisted choice.

export const EQUIPMENT_OPTIONS: Array<{ key: Equipment; label: string }> = [
  { key: "dumbbell", label: "Dumbbells" },
  { key: "chair", label: "Chair" },
  { key: "box", label: "Box / step" },
  { key: "bench", label: "Bench" },
  { key: "barbell", label: "Barbell" },
  { key: "kettlebell", label: "Kettlebell" },
  { key: "pullup_bar", label: "Pull-up bar" },
  { key: "band", label: "Resistance band" },
  { key: "machine", label: "Machines" },
];

export const EQUIPMENT_KEYS = EQUIPMENT_OPTIONS.map((o) => o.key);

export const EQUIPMENT_STORAGE_KEY = "kadenz_equipment";
export const DEFAULT_EQUIPMENT: Equipment[] = ["dumbbell", "chair", "box"];

export function loadEquipment(): Equipment[] | null {
  try {
    const raw = localStorage.getItem(EQUIPMENT_STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? (arr.filter((e) => EQUIPMENT_KEYS.includes(e)) as Equipment[])
      : null;
  } catch {
    return null;
  }
}

export function saveEquipment(eq: Equipment[]) {
  try {
    localStorage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify(eq));
  } catch {
    /* private mode */
  }
}

// ── Gym access presets ────────────────────────────────────────────────────────
// Ticking eight (now nine) individual equipment boxes is a poor way to
// describe a gym — most athletes think in terms of "where do I train", not
// a checklist. An access preset is a SHORTCUT that maps to the equipment
// set above, not a second concept: picking one just ticks/unticks the boxes
// for you, and every box stays individually editable afterwards. There's no
// "machine" tier between box and full gym in real life, so the model is a
// straight ladder: home adds nothing, box adds free weights + rig kit, full
// gym adds machines on top of a box.
export type GymAccess = "home" | "box" | "full_gym";

export const ACCESS_PRESETS: Record<
  GymAccess,
  { label: string; blurb: string; equipment: Equipment[] }
> = {
  home: {
    label: "Home or bodyweight",
    blurb: "No equipment ticked, bodyweight work only.",
    equipment: [],
  },
  box: {
    label: "CrossFit or Hyrox box",
    blurb: "Free weights, boxes, bands, benches and pull-up bars, no machines.",
    equipment: ["dumbbell", "barbell", "bench", "kettlebell", "pullup_bar", "band", "box", "chair"],
  },
  full_gym: {
    label: "Full gym",
    blurb: "Everything a box has, plus machines.",
    equipment: ["dumbbell", "barbell", "bench", "kettlebell", "pullup_bar", "band", "box", "chair", "machine"],
  },
};

export const ACCESS_LEVELS: GymAccess[] = ["home", "box", "full_gym"];

/**
 * Which access preset the given equipment set exactly matches, or `null` if
 * it's been hand-edited away from every preset (still a perfectly valid
 * equipment set — just nothing to highlight in the shortcut control).
 */
export function accessForEquipment(equipment: Equipment[]): GymAccess | null {
  const set = new Set(equipment);
  for (const level of ACCESS_LEVELS) {
    const preset = ACCESS_PRESETS[level].equipment;
    if (preset.length === set.size && preset.every((e) => set.has(e))) return level;
  }
  return null;
}

/**
 * How many catalogue exercises this equipment set can actually perform
 * (every required item available) — computed from the real catalogue, not a
 * hardcoded guess, so it stays honest as EXERCISES grows.
 */
export function exerciseCountForEquipment(equipment: Equipment[]): number {
  return EXERCISES.filter((e) => (e.equipment ?? []).every((needed) => equipment.includes(needed))).length;
}
