import { Repeat, X } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { formatLoad } from "@/lib/strength/weights";
import { EXERCISES } from "@/lib/strength/program";
import { muscleFor } from "@/lib/strength/session-display";
import type { PlannedExercise } from "@/components/strength/GuidedSession";

// ── Prescription for a not-yet-started session ───────────────────────────────
// One block per planned exercise, editable (Exchange/Remove) until the
// session has logged sets — see hasLoggedSets in the caller for why editing
// stops being offered once anything has actually been logged.

export function SessionPlannedExercises({
  planned,
  editable,
  actionsBusy,
  onExchange,
  onRemove,
}: {
  planned: PlannedExercise[];
  /** Only planned, not-yet-started sessions allow edits at all. */
  editable: boolean;
  actionsBusy: boolean;
  onExchange: (slug: string) => void;
  onRemove: (slug: string) => void;
}) {
  return (
    <>
      {planned.map((ex, i) => {
        const muscle = muscleFor(ex.slug);
        // The always-protected rehab work is never editable, even on an
        // otherwise-editable session (see EXERCISE_BY_SLUG achillesRole,
        // enforced server-side too).
        const exerciseEditable = editable && !EXERCISES.find((e) => e.slug === ex.slug)?.achillesRole;
        return (
          <div key={ex.slug} className="k-card flex items-start gap-3 p-3.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-elevated text-[12px] font-extrabold text-text-2">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-bold leading-tight text-text-1">{ex.name}</p>
                {muscle && (
                  <span className="rounded-md bg-elevated px-2 py-0.5 text-[11px] font-semibold text-text-3">
                    {muscle}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-text-3">
                {ex.sets} sets ×{" "}
                {ex.repLow === ex.repHigh ? ex.repLow : `${ex.repLow}–${ex.repHigh}`} reps ·{" "}
                {ex.restSeconds}s rest
              </p>
              <p className="mt-0.5 text-[12px] font-medium text-text-2">
                {formatLoad(ex.suggestedWeightKg, {
                  dumbbells: ex.dumbbells,
                  holdNote: ex.holdNote,
                  perSide: ex.perSide,
                })}
              </p>
            </div>
            {exerciseEditable && (
              <div className="flex shrink-0 items-start gap-1.5">
                <button
                  type="button"
                  disabled={actionsBusy}
                  onClick={() => {
                    haptic("light");
                    onExchange(ex.slug);
                  }}
                  aria-label={`Exchange ${ex.name}`}
                  style={{ touchAction: "manipulation" }}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-3 disabled:opacity-50"
                >
                  <Repeat className="h-4 w-4" strokeWidth={2.2} />
                </button>
                <button
                  type="button"
                  disabled={actionsBusy}
                  onClick={() => onRemove(ex.slug)}
                  aria-label={`Remove ${ex.name}`}
                  style={{ touchAction: "manipulation" }}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-3 disabled:opacity-50"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
