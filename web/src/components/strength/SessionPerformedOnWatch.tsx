// ── "As performed on watch" ──────────────────────────────────────────────────
// Real Garmin exercise order, pulled from the linked activity's own set
// stream (see the exercise-order fetch in the session page) — a separate
// section from "Logged sets" because it can legitimately disagree with what
// was tapped into the guided session (a rest logged as a set, a superset the
// watch recorded differently, etc).

export interface PerformedExercise {
  category: string | null;
  name: string | null;
  sets: number;
  reps: number[];
}

// Garmin gives a category code (BENCH_PRESS) and sometimes a specific name.
// "BARBELL_BENCH_PRESS" → "Barbell bench press"; "BENCH_PRESS" → "Bench press".
function prettyExercise(p: PerformedExercise): string {
  const raw = p.name || p.category || "Exercise";
  if (raw === "UNKNOWN") return "Exercise";
  return raw
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function SessionPerformedOnWatch({ performed }: { performed: PerformedExercise[] }) {
  if (performed.length === 0) return null;

  return (
    <section className="k-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
          As performed on watch
        </p>
        <span className="text-[11px] text-text-3">Garmin</span>
      </div>
      <ol className="flex flex-col gap-2.5">
        {performed.map((p, i) => {
          const uniform = p.reps.length > 0 && p.reps.every((r) => r === p.reps[0]);
          const repText =
            p.reps.length === 0
              ? ""
              : uniform
                ? ` · ${p.sets} × ${p.reps[0]}`
                : ` · ${p.reps.join(", ")} reps`;
          return (
            <li key={i} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 text-[13px] font-bold tabular-nums text-text-3">
                {i + 1}
              </span>
              <span className="text-[15px] font-semibold text-text-1">{prettyExercise(p)}</span>
              <span className="ml-auto text-[13px] tabular-nums text-text-2">
                {repText.replace(/^ · /, "")}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
