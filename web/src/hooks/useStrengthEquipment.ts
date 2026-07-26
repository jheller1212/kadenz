import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Equipment } from "@/lib/strength/types";

/**
 * The athlete's available equipment (strengthPlanSettings.equipment), used to
 * filter Exchange alternatives to things they can actually do. `null` = not
 * yet loaded, or no plan settings configured — callers should treat that as
 * "unfiltered" rather than "no equipment".
 */
export function useStrengthEquipment(): Equipment[] | null {
  const [equipment, setEquipment] = useState<Equipment[] | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch("/api/strength/plan-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (alive && s && Array.isArray(s.equipment)) setEquipment(s.equipment as Equipment[]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return equipment;
}
