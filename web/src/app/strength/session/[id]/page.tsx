"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CheckCircle2, Heart, SkipForward, Dumbbell, Repeat, X } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { STRENGTH_COLOR } from "@/lib/workout-colors";
import { formatLoad } from "@/lib/strength/weights";
import { EXERCISES } from "@/lib/strength/program";
import { estimateWorkoutDuration } from "@/lib/strength/estimate";
import { useStrengthEquipment } from "@/hooks/useStrengthEquipment";
import { ExerciseActionsSheet } from "@/components/strength/ExerciseActionsSheet";
import type { PlannedExercise } from "@/components/strength/GuidedSession";
import type { ExerciseOverride } from "@/lib/strength/session";
import { workingSetNumber } from "@/lib/strength/types";
import { sessionVolume } from "@/lib/strength/volume";

// ── Strength session preview / summary in the workout anatomy ────────────────
// Planned sessions show the prescription (from plannedExercises); logged
// sessions show the recorded sets. Reached from Today, the plan, and the
// Activities feed.

interface SetRow {
  id: string;
  exerciseId: string;
  /** Catalogue slug (see program.ts) — the volume stat's dumbbell/bodyweight
   *  lookup key (see lib/strength/volume.ts). */
  exerciseSlug: string;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  /** "warmup" | "working" | null (null/undefined reads as working — see
   *  strength_sets.kind). Drives both the athlete-facing set number (see
   *  workingSetNumber) and the volume stat's warm-up exclusion below. */
  kind?: "warmup" | "working" | null;
}

interface SessionDetail {
  id: string;
  type: string;
  title: string;
  status: string;
  date: string;
  durationMinutes: number | null;
  targetDurationMinutes: number | null;
  sets: SetRow[];
  plannedExercises: PlannedExercise[];
  exerciseOverrides: ExerciseOverride[];
  linkedActivity?: {
    id: string;
    stravaId: string | null;
    garminId: string | null;
    avgHr: number | null;
    maxHr: number | null;
    durationSeconds: number | null;
  } | null;
}

interface PerformedExercise {
  category: string | null;
  name: string | null;
  sets: number;
  reps: number[];
}

interface CatalogRow {
  id: string;
  slug: string;
  name: string;
}

function muscleFor(slug: string | undefined): string | null {
  if (!slug) return null;
  return EXERCISES.find((e) => e.slug === slug)?.primaryMuscle ?? null;
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

export default function StrengthSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  useSwipeBack();
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [catalog, setCatalog] = useState<Record<string, CatalogRow>>({});
  const [loading, setLoading] = useState(true);
  const [performed, setPerformed] = useState<PerformedExercise[]>([]);
  // Exchange/Remove — planned, not-yet-started sessions only (see hasLoggedSets
  // below); persisted via PATCH exerciseOverrides so it survives a reload.
  const [actionsSlug, setActionsSlug] = useState<string | null>(null);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [actionsError, setActionsError] = useState<string | null>(null);
  const equipment = useStrengthEquipment();

  async function saveOverrides(next: ExerciseOverride[]) {
    setActionsBusy(true);
    setActionsError(null);
    try {
      const res = await apiFetch(`/api/strength/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseOverrides: next }),
      });
      if (!res.ok) {
        setActionsError("Couldn't save that change — try again.");
        return;
      }
      const fresh = await apiFetch(`/api/strength/sessions/${id}`);
      if (fresh.ok) setSession(await fresh.json());
      haptic("success");
    } catch {
      setActionsError("Network error — couldn't save that change.");
    } finally {
      setActionsBusy(false);
      setActionsSlug(null);
    }
  }

  function handleRemove(slug: string) {
    if (!session) return;
    if ((session.plannedExercises ?? []).length <= 1) {
      haptic("warning");
      setActionsError("Can't remove the only exercise in this session.");
      return;
    }
    void saveOverrides([...(session.exerciseOverrides ?? []), { slug, action: "removed" }]);
  }

  function handleExchange(slug: string, replacementSlug: string) {
    if (!session) return;
    void saveOverrides([
      ...(session.exerciseOverrides ?? []),
      { slug, action: "swapped", replacementSlug },
    ]);
  }

  useEffect(() => {
    let alive = true;
    Promise.all([
      apiFetch(`/api/strength/sessions/${id}`).then((r) => (r.ok ? r.json() : null)),
      apiFetch("/api/strength/exercises").then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([detail, rows]: [SessionDetail | null, CatalogRow[]]) => {
        if (!alive) return;
        setSession(detail);
        setCatalog(Object.fromEntries(rows.map((c) => [c.id, c])));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  // If this session is linked to a Garmin activity, pull the exercises as they
  // were actually performed on the watch (real order), shown as its own section.
  useEffect(() => {
    const act = session?.linkedActivity;
    if (!act?.garminId || !act.id) return;
    let alive = true;
    apiFetch(`/api/activities/${act.id}/exercise-order`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && Array.isArray(d.exercises)) setPerformed(d.exercises);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [session?.linkedActivity?.id, session?.linkedActivity?.garminId]);

  const back = (
    <TransitionLink
      href="/activities"
      aria-label="Back"
      className="press flex h-11 items-center gap-0.5 text-accent-fg"
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
      <span className="text-[17px]">Back</span>
    </TransitionLink>
  );

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Session" large={false} left={back} />
        <div className="flex flex-col gap-3 px-4 pb-tabbar pt-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Session" large={false} left={back} />
        <div className="px-4 pb-tabbar pt-2">
          <EmptyState title="Session not found" message="It may have been deleted." />
        </div>
      </main>
    );
  }

  const color = STRENGTH_COLOR.solid;
  const isCompleted = session.status === "completed";
  const isSkipped = session.status === "skipped" || session.status === "missed";
  const hasLoggedSets = session.sets.length > 0;

  const dateStr = new Date(session.date).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // Logged sets grouped per exercise, in first-logged order.
  const bySlot = new Map<string, SetRow[]>();
  for (const s of session.sets) {
    const list = bySlot.get(s.exerciseId) ?? [];
    list.push(s);
    bySlot.set(s.exerciseId, list);
  }

  const planned = session.plannedExercises ?? [];

  // Summary numbers: recorded reality when sets exist, the prescription otherwise.
  const exerciseCount = hasLoggedSets ? bySlot.size : planned.length;
  const totalSets = hasLoggedSets
    ? session.sets.length
    : planned.reduce((sum, e) => sum + e.sets, 0);
  const estMinutes =
    session.durationMinutes ??
    session.targetDurationMinutes ??
    (planned.length ? estimateWorkoutDuration(planned) : null);
  // Working volume only, dumbbell/bodyweight-aware — see sessionVolume for
  // why warm-ups are excluded and kg/reps are kept as two separate figures.
  const volume = sessionVolume(session.sets);

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title={session.title} large={false} left={back} />

      <div className="flex flex-col gap-4 px-4 pb-tabbar pt-1">
        {/* Hero card with the strength-blue accent */}
        <section
          className="rounded-[var(--radius-card)] p-4"
          style={{ backgroundColor: `${color}1A` }}
        >
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
              <h1 className="mt-1.5 text-[22px] font-bold tracking-tight text-text-1">
                {session.title}
              </h1>
              <p className="mt-0.5 text-[13px] text-text-3">
                {dateStr}
                {estMinutes != null ? ` · ~${estMinutes} min` : ""}
              </p>
            </div>
            {isCompleted ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent">
                <CheckCircle2 className="h-5 w-5 text-on-accent" strokeWidth={2.4} />
              </div>
            ) : isSkipped ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-elevated px-2 py-1 text-[11px] font-bold capitalize text-text-3">
                <SkipForward className="h-3 w-3" strokeWidth={2.4} />
                {session.status}
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
              <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                {exerciseCount}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-3">Sets</p>
              <p className="text-[22px] font-extrabold tabular-nums text-text-1">{totalSets}</p>
            </div>
            {estMinutes != null && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Time</p>
                <p className="text-[22px] font-extrabold tabular-nums text-text-1">
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

        {/* Heart rate from a linked Strava recording, shown alongside the
            logged sets — the "combined" view. */}
        {session.linkedActivity?.avgHr != null && (
          <section className="k-card p-4">
            <div className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-danger" strokeWidth={2.2} fill="currentColor" />
              <p className="text-[13px] font-semibold text-text-1">Heart rate</p>
              <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-text-3">
                from Strava
              </span>
            </div>
            <div className="mt-3 flex items-center gap-8">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-3">Average</p>
                <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                  {session.linkedActivity.avgHr}
                  <span className="text-[12px] font-semibold text-text-3"> bpm</span>
                </p>
              </div>
              {session.linkedActivity.maxHr != null && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-text-3">Max</p>
                  <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                    {session.linkedActivity.maxHr}
                    <span className="text-[12px] font-semibold text-text-3"> bpm</span>
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {performed.length > 0 && (
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
                    <span className="w-5 shrink-0 text-[13px] font-bold tabular-nums text-text-3">{i + 1}</span>
                    <span className="text-[15px] font-semibold text-text-1">{prettyExercise(p)}</span>
                    <span className="ml-auto text-[13px] tabular-nums text-text-2">{repText.replace(/^ · /, "")}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <h2 className="text-[17px] font-bold text-text-1">
          {hasLoggedSets ? "Logged sets" : performed.length > 0 ? "Planned exercises" : "Exercises"}
        </h2>

        {hasLoggedSets ? (
          // Recorded reality: one card per exercise with its logged sets.
          [...bySlot.entries()].map(([exerciseId, sets], i) => {
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
                      return ordered.map((s, idx) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between text-[14px]"
                        >
                          {/* Number counts working sets only — a warm-up ramp
                              (raw setNumber counts it) would otherwise push
                              "Set 1" as logged during the guided session up to
                              "Set 3" here (see workingSetNumber). */}
                          <span className="text-text-3">
                            {s.kind === "warmup" ? "WU" : `Set ${workingSetNumber(ordered, idx)}`}
                          </span>
                          <span className="font-semibold tabular-nums text-text-1">
                            {s.weightKg != null ? `${s.weightKg} kg` : "BW"} × {s.reps ?? "—"}
                          </span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            );
          })
        ) : planned.length === 0 ? (
          <EmptyState title="No sets logged" message="This session has no recorded sets." />
        ) : (
          // The prescription: one block per planned exercise.
          planned.map((ex, i) => {
            const muscle = muscleFor(ex.slug);
            // Not started yet (checked above via hasLoggedSets) — editable,
            // except the always-protected rehab work (see EXERCISE_BY_SLUG
            // achillesRole, enforced server-side too).
            const editable = session.status === "planned" && !EXERCISES.find((e) => e.slug === ex.slug)?.achillesRole;
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
                {editable && (
                  <div className="flex shrink-0 items-start gap-1.5">
                    <button
                      type="button"
                      disabled={actionsBusy}
                      onClick={() => { haptic("light"); setActionsSlug(ex.slug); }}
                      aria-label={`Exchange ${ex.name}`}
                      style={{ touchAction: "manipulation" }}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-3 disabled:opacity-50"
                    >
                      <Repeat className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                    <button
                      type="button"
                      disabled={actionsBusy}
                      onClick={() => handleRemove(ex.slug)}
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
          })
        )}

        {actionsError && (
          <p className="text-center text-[13px] font-medium text-danger">{actionsError}</p>
        )}

        {/* Primary action */}
        <div className="flex flex-col gap-2.5 pt-1">
          {isCompleted ? (
            <div className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-input)] bg-elevated py-4 text-center text-[15px] font-bold text-text-2">
              <CheckCircle2 className="h-4 w-4 text-accent-fg" strokeWidth={2.5} />
              Completed
            </div>
          ) : !isSkipped ? (
            <Button
              variant="primary"
              full
              size="lg"
              onClick={() => {
                haptic("medium");
                // Deep-link straight into THIS session's overview (weights,
                // reorder, then start guided) — not the Kraft picker landing.
                router.push(`/strength?session=${id}`);
              }}
            >
              <span className="flex items-center justify-center gap-2">
                <Dumbbell className="h-5 w-5" strokeWidth={2.2} />
                Start session
              </span>
            </Button>
          ) : null}
        </div>
      </div>

      <ExerciseActionsSheet
        open={actionsSlug != null}
        onClose={() => setActionsSlug(null)}
        exercise={actionsSlug ? planned.find((e) => e.slug === actionsSlug) ?? null : null}
        otherSlugsInSession={planned.filter((e) => e.slug !== actionsSlug).map((e) => e.slug)}
        equipment={equipment}
        hasLoggedSets={false}
        onExchange={(replacementSlug) => actionsSlug && handleExchange(actionsSlug, replacementSlug)}
      />
    </main>
  );
}
