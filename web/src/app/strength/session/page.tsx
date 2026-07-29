"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, CheckCircle2, Dumbbell } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { estimateWorkoutDuration } from "@/lib/strength/estimate";
import { useStrengthEquipment } from "@/hooks/useStrengthEquipment";
import { ExerciseActionsSheet } from "@/components/strength/ExerciseActionsSheet";
import type { PlannedExercise } from "@/components/strength/GuidedSession";
import type { ExerciseOverride } from "@/lib/strength/session";
import { sessionVolume } from "@/lib/strength/volume";
import { firstLoggedExerciseOrder } from "@/lib/strength/session-order";
import { SessionHeartRate } from "@/components/strength/SessionHeartRate";
import { SessionTimeline } from "@/components/strength/SessionTimeline";
import { SessionSetsList } from "@/components/strength/SessionSetsList";
import { SessionPerformedOnWatch, type PerformedExercise } from "@/components/strength/SessionPerformedOnWatch";
import { SessionSkippedExercises } from "@/components/strength/SessionSkippedExercises";
import { SessionPlannedExercises } from "@/components/strength/SessionPlannedExercises";
import { SessionOverviewCards } from "@/components/strength/SessionOverviewCards";

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
  /** When this row was actually logged — the only real record of exercise
   *  order (see lib/strength/session-order.ts firstLoggedExerciseOrder). */
  createdAt: string;
  /** Average/max bpm over a guessed window ending around when this set was
   *  logged (see lib/sync/strength-hr.ts alignSetHeartRate) — null whenever
   *  there's no linked activity, no HR stream, or no sample in the window.
   *  Never a per-rep reading; the caption on the heart rate card says so. */
  avgHr: number | null;
  maxHr: number | null;
}

interface SessionDetail {
  id: string;
  type: string;
  title: string;
  status: string;
  date: string;
  durationMinutes: number | null;
  targetDurationMinutes: number | null;
  /** First/last logged set's createdAt (PR #95) — null until the first set
   *  of the session is logged, so absent for planned/never-started sessions. */
  startedAt: string | null;
  endedAt: string | null;
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

interface CatalogRow {
  id: string;
  slug: string;
  name: string;
}

// useSearchParams() requires a Suspense boundary in a prerendered/exported
// build, so the id-reading logic lives in the inner component below.
export default function StrengthSessionPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-dvh bg-bg">
          <NavBar title="Session" large={false} />
          <div className="flex flex-col gap-3 px-4 pb-tabbar pt-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </main>
      }
    >
      <StrengthSessionPageInner />
    </Suspense>
  );
}

function StrengthSessionPageInner() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
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
        setActionsError("Couldn't save that change. Try again.");
        return;
      }
      const fresh = await apiFetch(`/api/strength/sessions/${id}`);
      if (fresh.ok) setSession(await fresh.json());
      haptic("success");
    } catch {
      setActionsError("Network error. Couldn't save that change.");
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
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no fetch to run without an id, so there's nothing to synchronize; this just ends the loading state
      setLoading(false);
      return;
    }
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

  const isCompleted = session.status === "completed";
  const isSkipped = session.status === "skipped" || session.status === "missed";
  const hasLoggedSets = session.sets.length > 0;

  const dateStr = new Date(session.date).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  // Logged sets grouped per exercise. `bySlot`'s own key order is whatever
  // order the API returned rows in (set_number ascending, a per-exercise
  // counter that says nothing about cross-exercise order) — the athlete's
  // real order comes from `exerciseOrder` below, computed from when each
  // exercise's first set was actually logged.
  const bySlot = new Map<string, SetRow[]>();
  for (const s of session.sets) {
    const list = bySlot.get(s.exerciseId) ?? [];
    list.push(s);
    bySlot.set(s.exerciseId, list);
  }
  const exerciseOrder = firstLoggedExerciseOrder(session.sets);

  const planned = session.plannedExercises ?? [];
  // Planned but never logged — still shown, so nothing the athlete decided
  // to skip (or ran out of time for) silently disappears from the screen.
  const loggedSlugs = new Set(
    exerciseOrder.map((exerciseId) => catalog[exerciseId]?.slug).filter((s): s is string => !!s)
  );
  const skipped = hasLoggedSets ? planned.filter((ex) => !loggedSlugs.has(ex.slug)) : [];

  // Summary numbers: recorded reality when sets exist, the prescription otherwise.
  const exerciseCount = hasLoggedSets ? bySlot.size : planned.length;
  const totalSets = hasLoggedSets
    ? session.sets.length
    : planned.reduce((sum, e) => sum + e.sets, 0);
  // durationMinutes is the real elapsed time (endedAt - startedAt, see
  // SessionTimeline) — only fall back to the target/estimate when it's not
  // there yet. isRealDuration decides whether the "~" estimate marker is
  // allowed on estMinutes below; a real recorded duration must never get it.
  const isRealDuration = session.durationMinutes != null;
  // SessionTimeline only renders once startedAt exists (see its own null
  // check), and only labels a duration "real" via the same isRealDuration
  // check — when both hold, it's already showing this session's recorded
  // duration alongside its start/finish, so the summary stat row must not
  // repeat the same number in a second place (that's the "one concept
  // computed in two places" drift this codebase has hit before).
  const timelineShowsDuration = isRealDuration && session.startedAt != null;
  const estMinutes =
    session.durationMinutes ??
    session.targetDurationMinutes ??
    (planned.length ? estimateWorkoutDuration(planned) : null);
  // Working volume only, dumbbell/bodyweight-aware — see sessionVolume for
  // why warm-ups are excluded and kg/reps are kept as two separate figures.
  const volume = sessionVolume(session.sets);
  const anySetHr = session.sets.some((s) => s.avgHr != null);

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title={session.title} large={false} left={back} />

      <div className="flex flex-col gap-4 px-4 pb-tabbar pt-1">
        <SessionOverviewCards
          title={session.title}
          dateStr={dateStr}
          status={session.status}
          isCompleted={isCompleted}
          isSkipped={isSkipped}
          estMinutes={estMinutes}
          isRealDuration={isRealDuration}
          hideTimeCell={timelineShowsDuration}
          exerciseCount={exerciseCount}
          totalSets={totalSets}
          volume={volume}
        />

        {/* Start / finish / real duration — only present once a set has been
            logged (see SessionTimeline). */}
        <SessionTimeline
          startedAt={session.startedAt}
          endedAt={session.endedAt}
          durationMinutes={session.durationMinutes}
        />

        {/* Heart rate from the linked recording, shown alongside the logged
            sets below — the "combined" view. */}
        {session.linkedActivity && (
          <SessionHeartRate linkedActivity={session.linkedActivity} showPerSetCaption={anySetHr} />
        )}

        <SessionPerformedOnWatch performed={performed} />

        <h2 className="text-[17px] font-bold text-text-1">
          {hasLoggedSets ? "Logged sets" : performed.length > 0 ? "Planned exercises" : "Exercises"}
        </h2>

        {hasLoggedSets ? (
          // Recorded reality: one card per exercise with its logged sets, in
          // the order the athlete actually performed them (first-logged —
          // see exerciseOrder above), not the order they were proposed in.
          <SessionSetsList exerciseOrder={exerciseOrder} bySlot={bySlot} catalog={catalog} />
        ) : planned.length === 0 ? (
          <EmptyState title="No sets logged" message="This session has no recorded sets." />
        ) : null}

        {/* Planned but never logged — visible, not silently dropped, and
            obviously not part of what was actually done. */}
        <SessionSkippedExercises skipped={skipped} />

        {!hasLoggedSets && planned.length > 0 && (
          // The prescription: not started yet (checked via hasLoggedSets),
          // so still editable via Exchange/Remove.
          <SessionPlannedExercises
            planned={planned}
            editable={session.status === "planned"}
            actionsBusy={actionsBusy}
            onExchange={(slug) => {
              haptic("light");
              setActionsSlug(slug);
            }}
            onRemove={handleRemove}
          />
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
