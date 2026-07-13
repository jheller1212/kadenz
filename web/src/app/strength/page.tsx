"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Plus, X , CalendarDays } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { ListGroup, Row } from "@/components/ui/List";
import { EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import GuidedSession, {
  unlockGuidedAudio,
  type GuidedFinishSummary,
  type PlannedExercise,
  type SessionType,
} from "@/components/strength/GuidedSession";
import { CustomWorkoutBuilder } from "@/components/strength/CustomWorkoutBuilder";
import {
  useCustomWorkouts,
  type CustomWorkoutInput,
  type CustomWorkoutTemplate,
} from "@/hooks/useCustomWorkouts";
import { estimateWorkoutDuration } from "@/lib/strength/estimate";
import { EXERCISES } from "@/lib/strength/program";

// ── Types (API shapes) ────────────────────────────────────────────────────────

interface SessionDetail {
  id: string;
  type: SessionType;
  title: string;
  status: string;
  targetDurationMinutes: number | null;
  plannedExercises: PlannedExercise[];
}

interface ExerciseCatalogRow {
  slug: string;
  name: string;
  category: "upper" | "lower" | "achilles" | "full_body";
  equipmentNote?: string | null;
  tempoNote?: string | null;
  flatGroundOnly: boolean;
  defaultSets: number | null;
  repLow: number | null;
  repHigh: number | null;
  startWeightKg: number | null;
}

type Phase = "picker" | "overview" | "guided" | "summary";

// Colors are grouped by family: Upper days are blues (+ Achilles = deeper
// shade), Lower days are purples (+ Achilles = deeper shade), standalone
// Achilles is orange, Full Body green.
const TYPE_META: Record<SessionType, { title: string; sub: string; color: string }> = {
  upper: { title: "Upper", sub: "5 lifts · ~35 min", color: "#93C5FD" },
  upper_achilles: { title: "Upper + Achilles", sub: "7 lifts · ~50 min", color: "#3B82F6" },
  lower: { title: "Lower", sub: "4 lifts · ~35 min", color: "#D8B4FE" },
  lower_achilles: { title: "Lower + Achilles", sub: "9 lifts · ~50 min", color: "#A855F7" },
  achilles: { title: "Achilles", sub: "4 lifts · ~20 min", color: "#FB923C" },
  full_body: { title: "Full Body", sub: "6 lifts · ~38 min", color: "#34D399" },
};

// Categories eligible for "Add exercise" per session type.
const ADD_CATEGORIES: Record<SessionType, Array<ExerciseCatalogRow["category"]>> = {
  upper: ["upper"],
  lower: ["lower"],
  upper_achilles: ["upper", "achilles"],
  achilles: ["achilles"],
  lower_achilles: ["lower", "achilles"],
  full_body: ["full_body", "upper", "lower"],
};

export default function StrengthPage() {
  const [phase, setPhase] = useState<Phase>("picker");
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [exercises, setExercises] = useState<PlannedExercise[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [catalog, setCatalog] = useState<ExerciseCatalogRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [summary, setSummary] = useState<GuidedFinishSummary | null>(null);
  const [painLogged, setPainLogged] = useState(false);
  const [painSaving, setPainSaving] = useState(false);
  const [painError, setPainError] = useState<string | null>(null);

  const [customBuilderOpen, setCustomBuilderOpen] = useState(false);
  const { templates, listWorkouts, createWorkout, deleteWorkout } =
    useCustomWorkouts();

  useEffect(() => {
    if (phase === "picker") listWorkouts();
  }, [phase, listWorkouts]);

  async function logPain(score: number) {
    if (!session || painSaving) return;
    setPainSaving(true);
    setPainError(null);
    try {
      const res = await apiFetch(`/api/strength/sessions/${session.id}/pain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, timing: "after" }),
      });
      if (res.ok) {
        haptic("success");
        setPainLogged(true);
      } else {
        haptic("warning");
        setPainError("Couldn't save — try again.");
      }
    } catch {
      setPainError("Couldn't save — try again.");
    } finally {
      setPainSaving(false);
    }
  }

  // Session id created ad-hoc by this flow (vs adopted from the plan) — if the
  // user backs out of the overview without logging anything, we delete it again
  // so abandoned picker taps don't linger as phantom "missed" sessions.
  const adHocIdRef = useRef<string | null>(null);

  // ── Picker → adopt today's planned session of this type, or create one ──────
  async function pickType(type: SessionType) {
    setBusy(true);
    setError(null);
    try {
      let sessionId: string | null = null;
      adHocIdRef.current = null;

      // Adopt: a planned session of this type scheduled for today.
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date();
      dayEnd.setHours(23, 59, 59, 999);
      const listRes = await apiFetch(
        `/api/strength/sessions?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`
      );
      if (listRes.ok) {
        const todays = (await listRes.json()) as Array<{ id: string; type: string; status: string }>;
        sessionId = todays.find((s) => s.type === type && s.status === "planned")?.id ?? null;
      }

      if (!sessionId) {
        const res = await apiFetch("/api/strength/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, date: new Date().toISOString(), force: true }),
        });
        if (!res.ok) {
          setError("Couldn't start the session. Try again.");
          return;
        }
        const { session: s } = await res.json();
        sessionId = s.id as string;
        adHocIdRef.current = sessionId;
      }

      const detailRes = await apiFetch(`/api/strength/sessions/${sessionId}`);
      if (!detailRes.ok) {
        setError("Couldn't load the session. Try again.");
        return;
      }
      const detail: SessionDetail = await detailRes.json();
      setSession(detail);
      setExercises(detail.plannedExercises);
      setPhase("overview");
    } catch {
      setError("Network error — couldn't start the session.");
    } finally {
      setBusy(false);
    }
  }

  function backToPicker() {
    haptic("light");
    // Abandoning a just-created ad-hoc session before logging anything? Remove
    // it again (adopted planned sessions are left untouched).
    if (phase === "overview" && adHocIdRef.current && session?.id === adHocIdRef.current) {
      apiFetch(`/api/strength/sessions/${adHocIdRef.current}`, { method: "DELETE" }).catch(() => {});
    }
    adHocIdRef.current = null;
    setPhase("picker");
    setSession(null);
    setExercises([]);
    setSummary(null);
    setError(null);
  }

  async function handleSaveCustomWorkout(input: CustomWorkoutInput) {
    await createWorkout(input);
    haptic("success");
  }

  async function handleDeleteCustomWorkout(id: string) {
    haptic("light");
    try {
      await deleteWorkout(id);
    } catch {
      setError("Couldn't delete the workout.");
    }
  }

  // Start a saved custom workout: create an ad-hoc session to log against,
  // then hand the template's slots to the overview/guided flow. Sets are
  // logged by exercise slug, so no session-type coupling is needed.
  async function startCustomWorkout(template: CustomWorkoutTemplate) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/strength/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "full_body",
          date: new Date().toISOString(),
          force: true,
          title: template.name,
          targetDurationMinutes: estimateWorkoutDuration(template.slots),
        }),
      });
      if (!res.ok) {
        setError("Couldn't start the session. Try again.");
        return;
      }
      const { session: s } = await res.json();
      adHocIdRef.current = s.id as string;

      const planned: PlannedExercise[] = template.slots.map((slot) => {
        const ex = EXERCISES.find((e) => e.slug === slot.exerciseSlug);
        return {
          slug: slot.exerciseSlug,
          name: ex?.name ?? slot.exerciseSlug,
          category: ex?.category ?? "full_body",
          equipmentNote: ex?.equipmentNote,
          tempoNote: ex?.tempoNote,
          flatGroundOnly: ex?.flatGroundOnly ?? false,
          perSide: false,
          sets: slot.sets,
          repLow: slot.repLow,
          repHigh: slot.repHigh,
          restSeconds: slot.restSeconds,
          prescription:
            slot.repLow === slot.repHigh
              ? `${slot.sets} × ${slot.repLow}`
              : `${slot.sets} × ${slot.repLow}–${slot.repHigh}`,
          suggestedWeightKg: slot.weightKg ?? ex?.startWeightKg ?? null,
          lastWeightKg: null,
          painGated: false,
          progression: { action: "same", reason: "Custom workout" },
        };
      });

      setSession({
        id: s.id,
        type: "full_body",
        title: template.name,
        status: "planned",
        targetDurationMinutes: estimateWorkoutDuration(template.slots),
        plannedExercises: planned,
      });
      setExercises(planned);
      setPhase("overview");
    } catch {
      setError("Network error — couldn't start the session.");
    } finally {
      setBusy(false);
    }
  }

  function removeExercise(slug: string) {
    haptic("light");
    setExercises((exs) => exs.filter((e) => e.slug !== slug));
  }

  async function openAddSheet() {
    setAddOpen(true);
    if (catalog.length > 0 || catalogLoading) return;
    setCatalogLoading(true);
    try {
      const res = await apiFetch("/api/strength/exercises");
      if (res.ok) {
        setCatalog(await res.json());
      } else {
        setError("Couldn't load the exercise catalogue.");
      }
    } catch {
      setError("Network error loading exercises.");
    } finally {
      setCatalogLoading(false);
    }
  }

  function addExercise(row: ExerciseCatalogRow) {
    haptic("light");
    const sets = row.defaultSets ?? 3;
    const repLow = row.repLow ?? 8;
    const repHigh = row.repHigh ?? 12;
    const planned: PlannedExercise = {
      slug: row.slug,
      name: row.name,
      category: row.category,
      equipmentNote: row.equipmentNote ?? undefined,
      tempoNote: row.tempoNote ?? undefined,
      flatGroundOnly: row.flatGroundOnly ?? false,
      perSide: false,
      sets,
      repLow,
      repHigh,
      restSeconds: 90,
      prescription: repLow === repHigh ? `${sets} × ${repLow}` : `${sets} × ${repLow}–${repHigh}`,
      suggestedWeightKg: row.startWeightKg ?? null,
      lastWeightKg: null,
      painGated: false,
      progression: { action: "same", reason: "Manually added" },
    };
    setExercises((exs) => [...exs, planned]);
    setAddOpen(false);
  }

  function handleStart() {
    if (exercises.length === 0) {
      setError("Add at least one exercise before starting.");
      return;
    }
    setError(null);
    unlockGuidedAudio();
    setPhase("guided");
  }

  function handleFinish(s: GuidedFinishSummary) {
    setSummary(s);
    setPainLogged(false);
    setPainError(null);
    setPhase("summary");
  }

  function handleExitGuided(setsLogged: number) {
    // An ad-hoc session abandoned with nothing logged shouldn't linger as a
    // phantom planned session on today.
    if (setsLogged === 0 && adHocIdRef.current && session?.id === adHocIdRef.current) {
      apiFetch(`/api/strength/sessions/${adHocIdRef.current}`, { method: "DELETE" }).catch(() => {});
    }
    adHocIdRef.current = null;
    setPhase("picker");
    setSession(null);
    setExercises([]);
  }

  // ── Phase 1: Picker ───────────────────────────────────────────────────────
  if (phase === "picker") {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Kraft" large={false} centerAlways left={<ProfileAvatar />} right={
          <TransitionLink
            href="/plan"
            aria-label="Calendar"
            className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
          >
            <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
          </TransitionLink>
        } />
        <div className="px-4 pb-tabbar">
          <p className="text-[15px] text-text-2">
            Dumbbell program · loads snap to your DH FitLife 18-in-1 (18 levels, 2.5–23.5 kg).
          </p>

          {error && (
            <div className="mt-3 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-3">
            {(Object.keys(TYPE_META) as SessionType[]).map((t) => (
              <motion.button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => pickType(t)}
                whileTap={{ scale: busy ? 1 : 0.97 }}
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                style={{ touchAction: "manipulation" }}
                className="flex items-center gap-3 k-card p-4 text-left disabled:opacity-50"
              >
                <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: TYPE_META[t].color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-bold text-text-1">{TYPE_META[t].title}</span>
                  <span className="block text-[13px] text-text-3">{TYPE_META[t].sub}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.9} />
              </motion.button>
            ))}
          </div>

          <div className="mt-6">
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">
              Custom
            </p>
            <div className="flex flex-col gap-3">
              {templates.map((t) => (
                <div key={t.id} className="flex items-center gap-3 k-card p-4">
                  <span className="h-10 w-1.5 shrink-0 rounded-full bg-accent/60" />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startCustomWorkout(t)}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                  >
                    <span className="block text-[17px] font-bold text-text-1">{t.name}</span>
                    <span className="block text-[13px] text-text-3">
                      {t.slots.length} lift{t.slots.length === 1 ? "" : "s"} · ~
                      {estimateWorkoutDuration(t.slots)} min
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => handleDeleteCustomWorkout(t.id)}
                    className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated"
                  >
                    <X className="h-4 w-4 text-text-3" strokeWidth={1.9} />
                  </button>
                </div>
              ))}
              <Button variant="secondary" full onClick={() => setCustomBuilderOpen(true)}>
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                Create custom workout
              </Button>
            </div>
          </div>

          <TransitionLink
            href="/strength/history"
            className="mt-5 block text-center text-[15px] font-semibold text-accent"
          >
            View history →
          </TransitionLink>
        </div>

        <CustomWorkoutBuilder
          open={customBuilderOpen}
          onClose={() => setCustomBuilderOpen(false)}
          onSave={handleSaveCustomWorkout}
        />

        <BottomNav active="strength" />
      </main>
    );
  }

  // ── Phase 3: Guided walkthrough (full-screen takeover) ───────────────────────
  if (phase === "guided" && session) {
    return (
      <GuidedSession
        session={{
          id: session.id,
          type: session.type,
          title: session.title,
          targetDurationMinutes: session.targetDurationMinutes,
        }}
        exercises={exercises}
        onExit={handleExitGuided}
        onFinish={handleFinish}
      />
    );
  }

  // ── Phase 4: Summary ─────────────────────────────────────────────────────────
  if (phase === "summary" && summary) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6">
        <div className="w-full max-w-sm k-card p-6 text-center">
          <h1 className="text-[22px] font-extrabold tracking-tight text-text-1">Session complete</h1>
          <p className="mt-2 text-[15px] text-text-2">
            {summary.setsLogged}/{summary.totalSets} sets logged · {summary.durationMinutes} min
          </p>

          {/* Achilles pain check-in — feeds the pain gate + history sparkline */}
          {session && (
            <div className="mt-6 rounded-[var(--radius-input)] bg-elevated p-4 text-left">
              <p className="text-[13px] font-semibold text-text-2">
                {painLogged ? "Pain logged — thanks." : "Any Achilles pain right now? (0 = none, 10 = worst)"}
              </p>
              {!painLogged && (
                <div className="mt-3 grid grid-cols-11 gap-1">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={painSaving}
                      onClick={() => logPain(n)}
                      className={`press rounded-md py-2 text-[13px] font-bold tabular-nums ${
                        n === 0
                          ? "bg-surface text-text-1"
                          : n <= 3
                            ? "bg-surface text-[#4ADE80]"
                            : n <= 6
                              ? "bg-surface text-[#FFB547]"
                              : "bg-surface text-[#FF4D4D]"
                      } disabled:opacity-50`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
              {painError && <p className="mt-2 text-[12px] text-danger">{painError}</p>}
            </div>
          )}

          <div className="mt-6">
            <Button variant="primary" size="lg" full onClick={backToPicker}>
              Done
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // ── Phase 2: Overview (editable, no clock) ───────────────────────────────────
  if (phase === "overview" && session) {
    const addable = catalog.filter(
      (r) =>
        ADD_CATEGORIES[session.type].includes(r.category) &&
        !exercises.some((e) => e.slug === r.slug)
    );

    return (
      <main className="min-h-dvh bg-bg">
        <NavBar
          title={session.title}
          large={false}
          left={
            <button
              type="button"
              onClick={backToPicker}
              aria-label="Back"
              style={{ touchAction: "manipulation" }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-text-1"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
          }
        />
        <div className="px-4 pb-tabbar">
          <h1 className="text-[22px] font-extrabold tracking-tight text-text-1">{session.title}</h1>
          <p className="mt-1 text-[13px] text-text-3">
            {exercises.length} exercises · ~{session.targetDurationMinutes} min
          </p>

          {session.type === "lower_achilles" && (
            <div className="mt-3 rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2.5 text-[13px] font-medium text-warn">
              Order locked: explosive work first, slow heavy HSR calf work last.
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
              {error}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-3">
            {exercises.map((ex, ei) => (
              <div key={ex.slug} className="flex items-start gap-3 k-card p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-elevated text-[12px] font-extrabold text-text-2">
                  {ei + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold leading-tight text-text-1">{ex.name}</p>
                  <p className="mt-0.5 text-[12px] text-text-3">
                    {ex.sets} sets × {ex.repLow === ex.repHigh ? ex.repLow : `${ex.repLow}–${ex.repHigh}`} reps
                    {ex.suggestedWeightKg != null ? ` · ${ex.suggestedWeightKg} kg` : " · bodyweight"}
                    {ex.perSide ? "/side" : ""}
                  </p>
                  {ex.tempoNote && <p className="mt-0.5 text-[12px] text-text-3">{ex.tempoNote}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ex.flatGroundOnly && (
                      <span className="rounded-md bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">
                        ⚠ Flat ground only
                      </span>
                    )}
                    {ex.painGated && (
                      <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger">
                        Eased — pain gate
                      </span>
                    )}
                    {ex.progression.action === "increase" && (
                      <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent">
                        ↑ Level up
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeExercise(ex.slug)}
                  aria-label={`Remove ${ex.name}`}
                  style={{ touchAction: "manipulation" }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-text-3"
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            ))}

            <motion.button
              type="button"
              onClick={openAddSheet}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              style={{ touchAction: "manipulation" }}
              className="flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-hairline bg-transparent p-3.5 text-[15px] font-semibold text-accent"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Add exercise
            </motion.button>
          </div>

          <div className="mt-6">
            <Button variant="primary" size="lg" full onClick={handleStart}>
              Start
            </Button>
          </div>
        </div>

        <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Add exercise">
          {catalogLoading ? (
            <p className="py-8 text-center text-[13px] text-text-3">Loading…</p>
          ) : addable.length === 0 ? (
            <EmptyState title="Nothing to add" message="All eligible exercises are already in this session." />
          ) : (
            <ListGroup>
              {addable.map((row) => (
                <Row
                  key={row.slug}
                  title={row.name}
                  subtitle={
                    row.tempoNote ??
                    `${row.defaultSets ?? 3} sets × ${row.repLow ?? 8}–${row.repHigh ?? 12} reps`
                  }
                  onClick={() => addExercise(row)}
                  chevron
                />
              ))}
            </ListGroup>
          )}
        </Sheet>

        <BottomNav active="strength" />
      </main>
    );
  }

  return null;
}
