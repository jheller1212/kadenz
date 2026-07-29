import { CheckCircle2, SkipForward, Dumbbell } from "lucide-react";
import { STRENGTH_COLOR } from "@/lib/workout-colors";

// ── Hero card + summary stat row ─────────────────────────────────────────────
// The top of the session detail screen: title/date/status, then
// exercises/sets/time/volume. estMinutes is durationMinutes (real, once the
// session is complete) falling back to targetDurationMinutes or the plan
// estimate — isRealDuration says which, so a real recorded duration is never
// shown with the "~" estimate prefix the other two get.

interface Volume {
  kg: number | null;
  bodyweightReps: number | null;
}

export function SessionOverviewCards({
  title,
  dateStr,
  status,
  isCompleted,
  isSkipped,
  estMinutes,
  isRealDuration,
  hideTimeCell,
  exerciseCount,
  totalSets,
  volume,
}: {
  title: string;
  dateStr: string;
  status: string;
  isCompleted: boolean;
  isSkipped: boolean;
  estMinutes: number | null;
  isRealDuration: boolean;
  /** True when SessionTimeline is already showing this session's real
   *  recorded duration (with its start/finish) — the stat row would just be
   *  repeating the same number, the exact "one concept, two places" drift
   *  this codebase has been bitten by before, so skip it here. */
  hideTimeCell: boolean;
  exerciseCount: number;
  totalSets: number;
  volume: Volume;
}) {
  const color = STRENGTH_COLOR.solid;

  return (
    <>
      {/* Hero card with the strength-blue accent */}
      <section className="rounded-[var(--radius-card)] p-4" style={{ backgroundColor: `${color}1A` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                style={{ backgroundImage: STRENGTH_COLOR.grad }}
              >
                <Dumbbell className="h-3 w-3" strokeWidth={2.4} />
                Strength
              </span>
            </div>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-tight text-text-1">{title}</h1>
            <p className="mt-0.5 text-[13px] text-text-3">
              {dateStr}
              {estMinutes != null ? ` · ${isRealDuration ? "" : "~"}${estMinutes} min` : ""}
            </p>
          </div>
          {isCompleted ? (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent">
              <CheckCircle2 className="h-5 w-5 text-on-accent" strokeWidth={2.4} />
            </div>
          ) : isSkipped ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-elevated px-2 py-1 text-[11px] font-bold capitalize text-text-3">
              <SkipForward className="h-3 w-3" strokeWidth={2.4} />
              {status}
            </span>
          ) : (
            <div className="h-8 w-8 shrink-0 rounded-full border-2 border-text-3" />
          )}
        </div>
      </section>

      {/* Summary stat row */}
      <section className="k-card p-4">
        <div className="flex items-end gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-3">Exercises</p>
            <p className="text-[22px] font-extrabold tabular-nums text-text-1">{exerciseCount}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-3">Sets</p>
            <p className="text-[22px] font-extrabold tabular-nums text-text-1">{totalSets}</p>
          </div>
          {estMinutes != null && !hideTimeCell && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-3">Time</p>
              <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                {isRealDuration ? "" : "~"}
                {estMinutes}
                <span className="text-[13px] font-semibold text-text-3"> min</span>
              </p>
            </div>
          )}
          {volume.kg != null && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-3">Volume</p>
              <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                {Math.round(volume.kg)}
                <span className="text-[13px] font-semibold text-text-3"> kg</span>
              </p>
            </div>
          )}
          {volume.bodyweightReps != null && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-3">Bodyweight</p>
              <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                {volume.bodyweightReps}
                <span className="text-[13px] font-semibold text-text-3"> reps</span>
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
