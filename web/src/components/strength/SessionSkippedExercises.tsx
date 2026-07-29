import { SkipForward } from "lucide-react";
import { muscleFor } from "@/lib/strength/session-display";

// ── "Not done" ────────────────────────────────────────────────────────────────
// Planned exercises with no logged sets on a session that otherwise has
// logged sets — shown, not silently dropped, so nothing the athlete decided
// to skip (or ran out of time for) disappears from the record.

interface SkippedExercise {
  slug: string;
  name: string;
}

export function SessionSkippedExercises({ skipped }: { skipped: SkippedExercise[] }) {
  if (skipped.length === 0) return null;

  return (
    <>
      <h2 className="mt-1 text-[17px] font-bold text-text-1">Not done</h2>
      {skipped.map((ex) => {
        const muscle = muscleFor(ex.slug);
        return (
          <div key={ex.slug} className="k-card flex items-start gap-3 p-3.5 opacity-60">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-elevated text-[12px] font-extrabold text-text-2">
              <SkipForward className="h-3.5 w-3.5" strokeWidth={2.4} />
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
              <p className="mt-0.5 text-[12px] text-text-3">Not done</p>
            </div>
          </div>
        );
      })}
    </>
  );
}
