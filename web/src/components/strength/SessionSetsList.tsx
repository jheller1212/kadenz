import { muscleFor } from "@/lib/strength/session-display";
import { formatSetHr } from "@/lib/strength/format-set-hr";
import { workingSetNumber } from "@/lib/strength/types";

// ── Logged sets, grouped per exercise ────────────────────────────────────────
// One card per exercise, in the order the athlete actually performed them
// (exerciseOrder — see lib/strength/session-order.ts firstLoggedExerciseOrder
// in the caller), each set showing weight × reps plus, where a linked
// activity's heart-rate stream covers it, that set's avg/max bpm.

interface SetRow {
  id: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  kind?: "warmup" | "working" | null;
  avgHr: number | null;
  maxHr: number | null;
}

interface CatalogRow {
  id: string;
  slug: string;
  name: string;
}

export function SessionSetsList({
  exerciseOrder,
  bySlot,
  catalog,
}: {
  exerciseOrder: string[];
  bySlot: Map<string, SetRow[]>;
  catalog: Record<string, CatalogRow>;
}) {
  return (
    <>
      {exerciseOrder.map((exerciseId, i) => {
        const sets = bySlot.get(exerciseId) ?? [];
        const row = catalog[exerciseId];
        const muscle = muscleFor(row?.slug);
        return (
          <div key={exerciseId} className="k-card flex items-start gap-3 p-3.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-elevated text-[12px] font-extrabold text-text-2">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-bold leading-tight text-text-1">
                  {row?.name ?? "Exercise"}
                </p>
                {muscle && (
                  <span className="rounded-md bg-elevated px-2 py-0.5 text-[11px] font-semibold text-text-3">
                    {muscle}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-text-3">
                {sets.length} {sets.length === 1 ? "set" : "sets"}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {(() => {
                  const ordered = [...sets].sort((a, b) => a.setNumber - b.setNumber);
                  return ordered.map((s, idx) => {
                    const hrText = formatSetHr(s);
                    return (
                      <div key={s.id} className="flex items-center justify-between text-[14px]">
                        {/* Number counts working sets only — a warm-up ramp
                            (raw setNumber counts it) would otherwise push
                            "Set 1" as logged during the guided session up to
                            "Set 3" here (see workingSetNumber). */}
                        <span className="text-text-3">
                          {s.kind === "warmup" ? "WU" : `Set ${workingSetNumber(ordered, idx)}`}
                        </span>
                        <span className="flex items-baseline gap-2">
                          <span className="font-semibold tabular-nums text-text-1">
                            {s.weightKg != null ? `${s.weightKg} kg` : "BW"} × {s.reps ?? "—"}
                          </span>
                          {hrText && (
                            <span className="text-[12px] tabular-nums text-text-3">{hrText}</span>
                          )}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
