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
