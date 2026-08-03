"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Minus, X , CalendarDays, Watch, ArrowUpRight, Check, Play, Dumbbell, HeartPulse, Repeat, Video } from "lucide-react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { StepperButton } from "@/components/ui/StepperButton";
import { ListGroup, Row } from "@/components/ui/List";
import { EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import dynamic from "next/dynamic";
import { unlockGuidedAudio } from "@/lib/strength/guided-audio";
import type {
  GuidedFinishSummary,
  PlannedExercise,
  SessionType,
} from "@/components/strength/GuidedSession";
import { validateAchillesOrdering, type ExerciseOverride } from "@/lib/strength/session";
// Heavy, full-screen surfaces only reached deep in the flow — load them on
// demand so the strength landing bundle stays small.
const GuidedSession = dynamic(() => import("@/components/strength/GuidedSession"), {
  ssr: false,
});
const CustomWorkoutBuilder = dynamic(
  () =>
    import("@/components/strength/CustomWorkoutBuilder").then(
      (m) => m.CustomWorkoutBuilder
    ),
  { ssr: false }
);
import { SortableItem } from "@/components/strength/SortableItem";
import { SortChips } from "@/components/strength/SortChips";
import { ExerciseActionsSheet } from "@/components/strength/ExerciseActionsSheet";
import { VideoSheet } from "@/components/strength/VideoSheet";
import { getVideoId } from "@/lib/strength/videos";
import { useStrengthEquipment } from "@/hooks/useStrengthEquipment";
import { sortExerciseList, type ExerciseSortMode } from "@/lib/strength/sort";
import {
  useCustomWorkouts,
  type CustomWorkoutInput,
  type CustomWorkoutTemplate,
} from "@/hooks/useCustomWorkouts";
import { estimateWorkoutDuration } from "@/lib/strength/estimate";
import {
  clearGuidedSnapshot,
  loadGuidedSnapshot,
  type GuidedSnapshot,
} from "@/lib/strength/guided-snapshot";
import { formatRecency } from "@/lib/recency";
import { displayWeight, formatWeightKg, weightUnitLabel } from "@/lib/units";
import { EXERCISES } from "@/lib/strength/program";
import { COMPLAINT_SHORT_LABELS, type Complaint, type Equipment } from "@/lib/strength/types";
import { formatLoad, stepWeight } from "@/lib/strength/weights";
import { ACCESS_PRESETS, ACCESS_LEVELS, type GymAccess } from "@/lib/strength/equipment";
import { REHAB_COLOR } from "@/lib/workout-colors";
import { needsStrengthSetupPrompt } from "@/lib/strength/setup-prompt";

// ── Types (API shapes) ────────────────────────────────────────────────────────

interface SessionDetail {
  id: string;
  type: SessionType;
  title: string;
  status: string;
  targetDurationMinutes: number | null;
  plannedExercises: PlannedExercise[];
  exerciseOverrides?: ExerciseOverride[];
  // This session's own "this session only" equipment choice, if the athlete
  // set one from the pre-start sheet — see SessionStartOptions below. Wins
  // over the profile's usual equipment when offering Exchange alternatives,
  // same as it already wins when the plan itself is built (service.ts).
  equipmentOverride?: Equipment[] | null;
}

// Session-level "this session only" overrides picked in the pre-start sheet
// — see pickType. Both optional/undefined = use the athlete's profile
// defaults, exactly as before this existed.
interface SessionStartOptions {
  durationOverrideMinutes?: number;
  equipmentOverride?: Equipment[];
}

const START_DURATIONS: Array<30 | 45 | 60> = [30, 45, 60];

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
  lastWeightKg: number | null;
  lastRepLow: number | null;
  lastRepHigh: number | null;
  lastDate: string | null;
  timesPerformed: number;
}

type Phase = "picker" | "overview" | "guided" | "summary";

// Colors are grouped by family: Upper days are blues (+ Achilles = deeper
// shade), Lower days are purples (+ Achilles = deeper shade), standalone
// rehab is the dedicated rehab token (docs/DESIGN.md), Full Body green.
// "Rehab" (not "Achilles" or "Physio") is the one word for this everywhere —
// see docs/DESIGN.md's rehab entry.
const TYPE_META: Record<
  SessionType,
  { title: string; sub: string; color: string; icon: typeof Dumbbell }
> = {
  upper: { title: "Upper", sub: "6 lifts · ~40 min", color: "#93C5FD", icon: Dumbbell },
  upper_achilles: { title: "Upper + Achilles", sub: "7 lifts · ~50 min", color: "#3B82F6", icon: Dumbbell },
  lower: { title: "Lower", sub: "4 lifts · ~35 min", color: "#D8B4FE", icon: Dumbbell },
  lower_achilles: { title: "Lower + Achilles", sub: "9 lifts · ~50 min", color: "#A855F7", icon: Dumbbell },
  achilles: { title: "Rehab", sub: "4 lifts · ~20 min", color: REHAB_COLOR.solid, icon: HeartPulse },
  full_body: { title: "Full Body", sub: "6 lifts · ~38 min", color: "#34D399", icon: Dumbbell },
};

// The picker only offers the standard programme types. The dedicated
// "achilles" type is scheduled automatically as the weekly rehab pass places
// it (see reconcile.ts computeAchillesRehabDays) — it's a real, distinct
// session the athlete sees and completes on the Kraft screen, just not
// something you hand-pick from here (the upper_achilles/lower_achilles combo
// types are historic only). TYPE_META keeps all six entries so every session
// type — freshly scheduled or historic — still renders its title, color and
// icon correctly wherever it's looked up.
const PICKER_TYPES: SessionType[] = ["full_body", "upper", "lower"];

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

  // Sort mode for the overview list — "custom" whenever the user has dragged.
  const [sortMode, setSortMode] = useState<ExerciseSortMode>("custom");
  // slug → distinct-session count, lazily fetched for the frequency sort.
  const [freq, setFreq] = useState<Record<string, number> | null>(null);

  // Long-press drag (250ms) so taps still open the editor and scrolling isn't
  // hijacked. MouseSensor + TouchSensor, NOT PointerSensor: on iOS the pointer
  // sensor claims the gesture but cannot preventDefault the scroll pan, so
  // drags activate and then never move. TouchSensor blocks scroll after the hold.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const [addOpen, setAddOpen] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<ExerciseCatalogRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Exchange/Remove sheet — which exercise (by slug) it's currently open for.
  const [actionsSlug, setActionsSlug] = useState<string | null>(null);
  // Form-demo video sheet — which exercise (by slug) it's currently open for,
  // reusing the same VideoSheet the guided session uses (see GuidedSession.tsx).
  const [videoSlug, setVideoSlug] = useState<string | null>(null);
  const equipment = useStrengthEquipment();

  // Pre-start sheet: "this session only" duration/equipment, offered when
  // starting a NEW session from the picker (see pickType). `null` selections
  // mean "use my usual setting" — nothing is sent as an override.
  const [startType, setStartType] = useState<SessionType | null>(null);
  const [startDuration, setStartDuration] = useState<30 | 45 | 60 | null>(null);
  const [startAccess, setStartAccess] = useState<GymAccess | null>(null);
  // "This session only" override actually applied to the session now in the
  // overview, for display near the title — see issue: the pre-start sheet's
  // choice used to vanish with nothing confirming it took effect. Only set
  // when a fresh session was created with an override (an adopted
  // already-planned session keeps its own committed plan, see pickType).
  const [appliedOverride, setAppliedOverride] = useState<{
    durationMinutes?: number;
    accessLabel?: string;
  } | null>(null);

  const [summary, setSummary] = useState<GuidedFinishSummary | null>(null);
  const [painLogged, setPainLogged] = useState(false);
  const [painSaving, setPainSaving] = useState(false);
  const [painError, setPainError] = useState<string | null>(null);
  // "Why fewer sets than prescribed" — asked once per session, only when
  // GuidedSession reports something was left unlogged at Finish (see
  // GuidedFinishSummary.skippedWorkingSets). null = not answered/dismissed
  // yet; "time"/"fatigue" once tapped. A tap that fails to save still hides
  // the prompt (skippable, not required) — see logCutShortReason below.
  const [cutShortAnswered, setCutShortAnswered] = useState(false);
  const [cutShortSaving, setCutShortSaving] = useState<"time" | "fatigue" | null>(null);

  // Kraft hub stat row — real aggregates only (sessions/wk, weekly volume);
  // no invented "load delta" tile, see /api/strength/summary. volumeKg and
  // bodyweightReps are two separate figures, not blended into one number —
  // kg and reps aren't the same unit (see lib/strength/volume.ts).
  const [hubStats, setHubStats] = useState<{
    sessionsPerWeek: number | null;
    volumeKg: number | null;
    bodyweightReps: number | null;
    // What running-plan phase (base/build/peak/taper, or the deload/race
    // override) today's strength work is following — null with no active
    // running plan, see phase-policy.ts phaseSummaryFor.
    phase: { phaseLabel: string; note: string } | null;
  } | null>(null);
  const [customBuilderOpen, setCustomBuilderOpen] = useState(false);
  // Today's scheduled strength session(s), surfaced at the top of the picker so
  // the planned workout is one tap away and manual types stay below it.
  const [todaySessions, setTodaySessions] = useState<
    Array<{
      id: string;
      type: SessionType;
      title: string;
      status: string;
      targetDurationMinutes: number | null;
      // Whether the weekly rehab pass attached the Achilles/HSR block to
      // THIS session (strength_sessions.achilles_attached) — absent from
      // older API responses, treated as false until the sessions endpoint
      // returns it.
      achillesAttached?: boolean;
    }>
  >([]);
  // "Send to watch": only offered when Garmin is actually usable. watchSend
  // tracks the button's state for the current exercise setup.
  const [garminConnected, setGarminConnected] = useState(false);
  const [watchSend, setWatchSend] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // The athlete's reported running complaints. The post-session pain check-in is
  // rehab tracking — it only makes sense (and only appears) for the areas they
  // actually flagged; no complaints → no prompt.
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  // Whether the Kraft setup prompt should show on the picker — null until the
  // plan-settings fetch resolves, so we never flash the prompt before we
  // actually know (see needsStrengthSetupPrompt).
  const [showSetupPrompt, setShowSetupPrompt] = useState<boolean | null>(null);
  // Saved in-progress guided session (accidental exits / reloads are resumable).
  const [resumeSnap, setResumeSnap] = useState<GuidedSnapshot | null>(null);
  const [resume, setResume] = useState<{
    exIndex: number;
    work: GuidedSnapshot["work"];
    startedAt: number;
  } | null>(null);
  const { templates, listWorkouts, createWorkout, updateWorkout, deleteWorkout } =
    useCustomWorkouts();
  const [editingTemplate, setEditingTemplate] = useState<CustomWorkoutTemplate | null>(null);

  useEffect(() => {
    if (phase === "picker") listWorkouts();
  }, [phase, listWorkouts]);

  // Kraft hub stat row — fetched once per picker landing.
  useEffect(() => {
    if (phase !== "picker") return;
    let alive = true;
    apiFetch("/api/strength/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (alive && s) setHubStats(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [phase]);

  // Is the watch connected? Decides whether "Send to watch" is offered.
  useEffect(() => {
    let alive = true;
    apiFetch("/api/garmin/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (alive && s) setGarminConnected(Boolean(s.authenticated));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Load plan settings — gates the post-session pain check-in (complaints)
  // and the Kraft setup prompt (no row yet → equipment/ability unfiltered).
  useEffect(() => {
    let alive = true;
    apiFetch("/api/strength/plan-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!alive) return;
        if (s && Array.isArray(s.complaints)) setComplaints(s.complaints as Complaint[]);
        setShowSetupPrompt(needsStrengthSetupPrompt(s));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Any change to the exercise setup invalidates a prior "sent to watch" — the
  // wrist would be stale — so reset the button so the athlete can re-send.
  const exerciseSignature = exercises
    .map((e) => `${e.slug}:${e.sets}:${e.repLow}:${e.suggestedWeightKg}`)
    .join("|");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting UI state on setup change
    setWatchSend("idle");
  }, [exerciseSignature]);

  async function sendToWatch() {
    if (!session || watchSend === "sending") return;
    haptic("medium");
    setWatchSend("sending");
    try {
      const res = await apiFetch(`/api/strength/sessions/${session.id}/garmin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercises: exercises.map((e) => ({
            name: e.name,
            category: e.category,
            sets: e.sets,
            // Garmin takes a single rep target; the low end is the honest floor.
            reps: e.repLow,
            weightKg: e.suggestedWeightKg ?? e.lastWeightKg ?? null,
          })),
        }),
      });
      if (!res.ok) {
        setWatchSend("error");
        haptic("warning");
        return;
      }
      setWatchSend("sent");
      haptic("success");
    } catch {
      setWatchSend("error");
      haptic("warning");
    }
  }

  // Load today's scheduled strength sessions whenever we land on the picker.
  useEffect(() => {
    if (phase !== "picker") return;
    let alive = true;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    apiFetch(`/api/strength/sessions?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (alive) setTodaySessions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [phase]);

  useEffect(() => {
    if (phase === "picker") {
      const snap = loadGuidedSnapshot();
      // A finished snapshot only guards queued writes — never offer to resume it.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only init from storage
      setResumeSnap(snap && !snap.finishedAt ? snap : null);
    }
  }, [phase]);

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
        setPainError("Couldn't save. Try again.");
      }
    } catch {
      setPainError("Couldn't save. Try again.");
    } finally {
      setPainSaving(false);
    }
  }

  // One tap, skippable: saves best-effort and always dismisses the prompt
  // either way — this is a nudge for next session's progression, not a form
  // the athlete has to get past. See progression.ts for how "time" vs
  // "fatigue" actually change the next suggested load.
  async function logCutShortReason(reason: "time" | "fatigue") {
    if (!session || cutShortSaving) return;
    setCutShortSaving(reason);
    try {
      await apiFetch(`/api/strength/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutShortReason: reason }),
      });
    } catch {
      /* best-effort — see the comment above */
    } finally {
      haptic("light");
      setCutShortSaving(null);
      setCutShortAnswered(true);
    }
  }

  // Session id created ad-hoc by this flow (vs adopted from the plan) — if the
  // user backs out of the overview without logging anything, we delete it again
  // so abandoned picker taps don't linger as phantom "missed" sessions.
  const adHocIdRef = useRef<string | null>(null);

  // Exchange made from the pre-start sheet, persisted the same way the
  // guided session's exchange is (session row's exerciseOverrides — see
  // lib/strength/session.ts applyExerciseOverrides), so a reload or a second
  // device rebuilds the plan with this swap already applied instead of
  // reverting to the template on the very next read. Seeded from whatever
  // the session already carries whenever a session is (re)loaded into the
  // overview, and appended to (never replaced) on each exchange here.
  const overridesRef = useRef<ExerciseOverride[]>([]);
  useEffect(() => {
    overridesRef.current = session?.exerciseOverrides ?? [];
    // Re-seed only on a session change, not on every override — the ref is
    // meant to survive this effect re-running (exchangeExercise appends to
    // it independently of session.exerciseOverrides).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Backing out of an ad-hoc session deletes it without awaiting the response
  // (Back must feel instant), which leaves a window where the session still exists server-side.
  // Starting a session again inside that window used to re-adopt the very
  // session that was being deleted, because pickType's "is there already a
  // planned session today?" list still returned it — so a duration or equipment
  // choice made in the start sheet was silently dropped and the abandoned plan
  // came back instead. Remembering the in-flight delete lets pickType wait for
  // it and skip that id outright.
  const abandonRef = useRef<{ id: string; done: Promise<void> } | null>(null);

  function abandonSession(id: string) {
    const done = apiFetch(`/api/strength/sessions/${id}`, {
      method: "DELETE",
      // Survives the page being navigated away from or closed right after
      // Back — otherwise an abandoned session lingers on today as a phantom
      // "missed" session, which is exactly what this delete exists to prevent.
      keepalive: true,
    })
      .then(() => undefined)
      .catch(() => undefined);
    abandonRef.current = { id, done };
  }

  /** Waits for any in-flight abandon-delete and returns the id it removed. */
  async function settleAbandon(): Promise<string | null> {
    const pending = abandonRef.current;
    if (!pending) return null;
    await pending.done;
    abandonRef.current = null;
    return pending.id;
  }

  // Deep-link from a session detail screen's "Start session" (Today, the plan,
  // the feed): /strength?session=<id> jumps straight to THIS session's overview
  // — weights, reorder, then start guided — instead of the picker landing.
  const deepLinkRef = useRef(false);
  const router = useRouter();
  // True while the current overview was opened via deep-link, so its Back
  // button returns to the detail screen we came from — not the Kraft picker.
  const fromDeepLinkRef = useRef(false);

  // Overview Back: to the detail screen when we deep-linked in, else the picker.
  function overviewBack() {
    if (fromDeepLinkRef.current) {
      haptic("light");
      fromDeepLinkRef.current = false;
      router.back();
      return;
    }
    backToPicker();
  }

  // opts.deepLink: opened from a detail screen (Back → router.back()); the
  // Kraft "today" card opens the same overview but Back returns to the picker.
  async function openSessionOverview(sessionId: string, opts?: { deepLink?: boolean }) {
    setBusy(true);
    setError(null);
    setPhase("overview"); // show the overview shell immediately (loading, then filled)
    fromDeepLinkRef.current = opts?.deepLink ?? false;
    try {
      adHocIdRef.current = null; // an existing planned session, never ad-hoc
      setAppliedOverride(null); // no per-session override on an already-existing session
      const detailRes = await apiFetch(`/api/strength/sessions/${sessionId}`);
      if (!detailRes.ok) {
        setError("Couldn't load the session. Try again.");
        fromDeepLinkRef.current = false;
        setPhase("picker");
        return;
      }
      const detail: SessionDetail = await detailRes.json();
      setSession(detail);
      setExercises(detail.plannedExercises);
      setSortMode("custom");
    } catch {
      setError("Network error. Couldn't load the session.");
      fromDeepLinkRef.current = false;
      setPhase("picker");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (deepLinkRef.current) return;
    const sid = new URLSearchParams(window.location.search).get("session");
    if (!sid) return;
    deepLinkRef.current = true;
    // Strip the param so a later back/refresh doesn't reopen this session.
    window.history.replaceState(null, "", "/strength");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only deep-link open, async load
    openSessionOverview(sid, { deepLink: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Picker → adopt today's planned session of this type, or create one ──────
  // Tapping a programme card (e.g. "Upper") used to sit on the picker doing
  // nothing visible while up to three API calls ran in sequence (list check,
  // create, then a full detail refetch) — a silent 1+ second wait right
  // before the screen the athlete needs to reorder from. Show the overview
  // shell (skeleton) immediately, the same way the deep-link path already
  // does, so the tap feels instant and the real content fills in as it loads.
  async function pickType(
    type: SessionType,
    start?: SessionStartOptions,
    startDisplay?: { durationMinutes?: number; accessLabel?: string }
  ) {
    setBusy(true);
    setError(null);
    fromDeepLinkRef.current = false; // picker-started → Back returns to picker
    setPhase("overview"); // shell now, session fills in below
    setAppliedOverride(null); // cleared until we know a fresh session actually used it
    try {
      let sessionId: string | null = null;
      adHocIdRef.current = null;

      // Let a just-abandoned session finish disappearing before asking what's
      // already planned for today, and never adopt it even if that delete
      // failed. Without this, Back followed by a quick restart re-adopts the
      // abandoned plan and drops the start sheet's duration/equipment choice.
      const abandonedId = await settleAbandon();

      // Adopt: a planned session of this type scheduled for today. An
      // already-planned session (e.g. from auto-scheduling) keeps its own
      // committed plan — a chosen start-sheet override only applies when
      // this tap is what creates the session below.
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date();
      dayEnd.setHours(23, 59, 59, 999);
      const listRes = await apiFetch(
        `/api/strength/sessions?from=${dayStart.toISOString()}&to=${dayEnd.toISOString()}`
      );
      if (listRes.ok) {
        const todays = (await listRes.json()) as Array<{ id: string; type: string; status: string }>;
        sessionId =
          todays.find((s) => s.type === type && s.status === "planned" && s.id !== abandonedId)?.id ??
          null;
      }

      if (!sessionId) {
        const res = await apiFetch("/api/strength/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            date: new Date().toISOString(),
            force: true,
            ...(start?.durationOverrideMinutes != null
              ? { durationOverrideMinutes: start.durationOverrideMinutes }
              : {}),
            ...(start?.equipmentOverride != null
              ? { equipmentOverride: start.equipmentOverride }
              : {}),
          }),
        });
        if (!res.ok) {
          setError("Couldn't start the session. Try again.");
          setPhase("picker");
          return;
        }
        // The create response already carries the freshly-built plan — a
        // brand-new session has no sets, overrides or linked activity yet,
        // so build the detail straight from it instead of immediately
        // re-fetching the exact same thing via GET /sessions/[id].
        const { session: s, plannedExercises: created } = await res.json();
        const detail: SessionDetail = {
          id: s.id,
          type: s.type,
          title: s.title,
          status: s.status,
          targetDurationMinutes: s.targetDurationMinutes,
          plannedExercises: created,
          exerciseOverrides: s.exerciseOverrides ?? [],
          equipmentOverride: s.equipmentOverride ?? null,
        };
        adHocIdRef.current = s.id as string;
        setSession(detail);
        setExercises(detail.plannedExercises);
        setSortMode("custom");
        if (startDisplay && (startDisplay.durationMinutes != null || startDisplay.accessLabel != null)) {
          setAppliedOverride(startDisplay);
        }
        return;
      }

      const detailRes = await apiFetch(`/api/strength/sessions/${sessionId}`);
      if (!detailRes.ok) {
        setError("Couldn't load the session. Try again.");
        setPhase("picker");
        return;
      }
      const detail: SessionDetail = await detailRes.json();
      setSession(detail);
      setExercises(detail.plannedExercises);
      setSortMode("custom");
    } catch {
      setError("Network error. Couldn't start the session.");
      setPhase("picker");
    } finally {
      setBusy(false);
    }
  }

  function backToPicker() {
    haptic("light");
    // Abandoning a just-created ad-hoc session before logging anything? Remove
    // it again (adopted planned sessions are left untouched).
    if (phase === "overview" && adHocIdRef.current && session?.id === adHocIdRef.current) {
      abandonSession(adHocIdRef.current);
    }
    adHocIdRef.current = null;
    setPhase("picker");
    setSession(null);
    setExercises([]);
    setSummary(null);
    setError(null);
  }

  async function handleSaveCustomWorkout(input: CustomWorkoutInput) {
    if (editingTemplate) {
      await updateWorkout(editingTemplate.id, input);
      setEditingTemplate(null);
    } else {
      await createWorkout(input);
    }
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
    fromDeepLinkRef.current = false; // picker-started → Back returns to picker
    setAppliedOverride(null); // custom workouts don't go through the length/equipment sheet
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
          dumbbells: ex?.dumbbells,
          holdNote: ex?.holdNote,
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
      setSortMode("custom");
      setPhase("overview");
    } catch {
      setError("Network error. Couldn't start the session.");
    } finally {
      setBusy(false);
    }
  }

  function removeExercise(slug: string) {
    if (exercises.length <= 1) {
      haptic("warning");
      setError("Add another exercise before removing this one.");
      return;
    }
    haptic("light");
    setError(null);
    setExercises((exs) => exs.filter((e) => e.slug !== slug));
    setActionsSlug(null);
  }

  // The order the athlete lands on is stored on the session (see handleStart),
  // so it outlives today. Checked here, at the moment it is made, rather than
  // letting the server reject the save later with nothing on screen to
  // explain it: within an Achilles session, explosive work comes before slow
  // heavy (HSR) calf work. Returns true when `next` was applied.
  function applyOrderedList(next: PlannedExercise[]): boolean {
    const check = validateAchillesOrdering(next.map((x) => x.slug));
    if (!check.valid) {
      haptic("warning");
      setError(check.message);
      return false;
    }
    setError(null);
    setExercises(next);
    return true;
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = exercises.findIndex((x) => x.slug === active.id);
    const to = exercises.findIndex((x) => x.slug === over.id);
    if (from < 0 || to < 0) return;
    if (!applyOrderedList(arrayMove(exercises, from, to))) return;
    haptic("light");
    setSortMode("custom");
  }

  // Applying a sort reorders the actual list — same state a manual drag edits,
  // so whatever the guided session sees is exactly what's on screen.
  async function applySort(mode: ExerciseSortMode) {
    setSortMode(mode);
    if (mode === "custom") return;
    let f = freq;
    if (mode === "frequency" && !f) {
      try {
        const res = await apiFetch("/api/strength/exercises");
        if (res.ok) {
          const rows: ExerciseCatalogRow[] = await res.json();
          f = Object.fromEntries(rows.map((r) => [r.slug, r.timesPerformed ?? 0]));
          setFreq(f);
        }
      } catch {
        /* sort with zero counts */
      }
    }
    const sorted = sortExerciseList(exercises, mode, {
      name: (x) => x.name,
      weightKg: (x) => x.suggestedWeightKg,
      timesPerformed: (x) => f?.[x.slug] ?? 0,
    });
    // A sort that would put slow heavy calf work ahead of explosive work is
    // refused the same way a drag is (see applyOrderedList), and the chip
    // goes back to the order actually on screen.
    if (!applyOrderedList(sorted)) setSortMode("custom");
  }

  async function ensureCatalog() {
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

  async function openAddSheet() {
    setAddOpen(true);
    await ensureCatalog();
  }

  async function openActionsFor(slug: string) {
    haptic("light");
    setActionsSlug(slug);
    await ensureCatalog();
  }

  // Exchange: keep the slot's sets/reps/rest (same training stimulus), swap
  // the exercise identity and its load prefill. Not yet started, so the
  // exercise LIST edit is local-only here, same as add/remove — but the
  // override itself is recorded on overridesRef so persistExerciseOrder can
  // send it to the server at Start (same durability point as the order),
  // instead of silently dropping it the way this used to. Session-detail
  // page.tsx and the guided session both re-derive the plan from the same
  // stored exerciseOverrides column (lib/strength/session.ts
  // applyExerciseOverrides), so a swap made here is indistinguishable from
  // one made mid-session once it lands.
  function exchangeExercise(originalSlug: string, replacementSlug: string) {
    haptic("light");
    const cat = EXERCISES.find((e) => e.slug === replacementSlug);
    const row = catalog.find((r) => r.slug === replacementSlug);
    if (!cat) return;
    setExercises((exs) =>
      exs.map((e) => {
        if (e.slug !== originalSlug) return e;
        return {
          ...e,
          slug: cat.slug,
          name: cat.name,
          category: cat.category,
          equipmentNote: cat.equipmentNote,
          tempoNote: cat.tempoNote,
          flatGroundOnly: cat.flatGroundOnly ?? false,
          dumbbells: cat.dumbbells,
          holdNote: cat.holdNote,
          suggestedWeightKg: row?.lastWeightKg ?? cat.startWeightKg ?? null,
          lastWeightKg: null,
          painGated: false,
          progression: { action: "same", reason: "Exchanged" },
        };
      })
    );
    overridesRef.current = [
      ...overridesRef.current,
      { slug: originalSlug, action: "swapped", replacementSlug: cat.slug },
    ];
    setActionsSlug(null);
  }

  function addExercise(row: ExerciseCatalogRow) {
    haptic("light");
    const sets = row.defaultSets ?? 3;
    // Prefer what the athlete actually did last time; catalogue default next;
    // 8–12 as the final fallback.
    const repLow = row.lastRepLow ?? row.repLow ?? 8;
    const repHigh = row.lastRepHigh ?? row.repHigh ?? 12;
    const cat = EXERCISES.find((e) => e.slug === row.slug);
    const planned: PlannedExercise = {
      slug: row.slug,
      name: row.name,
      category: row.category,
      equipmentNote: row.equipmentNote ?? undefined,
      tempoNote: row.tempoNote ?? undefined,
      flatGroundOnly: row.flatGroundOnly ?? false,
      perSide: false,
      dumbbells: cat?.dumbbells,
      holdNote: cat?.holdNote,
      sets,
      repLow,
      repHigh,
      restSeconds: 90,
      prescription: repLow === repHigh ? `${sets} × ${repLow}` : `${sets} × ${repLow}–${repHigh}`,
      suggestedWeightKg: row.lastWeightKg ?? row.startWeightKg ?? null,
      lastWeightKg: null,
      painGated: false,
      progression: { action: "same", reason: "Manually added" },
    };
    setExercises((exs) => [...exs, planned]);
    setAddOpen(false);
  }

  // Store the order the athlete is about to work through, so a resume, a
  // reload or a second device rebuilds the plan in THIS order instead of the
  // template's (the plan itself is re-derived on every read, see
  // lib/strength/session.ts). Sent alongside exerciseOverrides in the same
  // PATCH — an exchange made in this sheet (exchangeExercise) is recorded on
  // overridesRef but, same as the order itself, only reaches the server here
  // at Start, not on every tap. A plain add stays purely local/ephemeral: a
  // slug the rebuilt plan does not contain is ignored on read, and a plan
  // exercise not in the stored order keeps its place rather than
  // disappearing.
  //
  // Deliberately not awaited. Starting the workout must not wait on the
  // network, and must not fail because of it: if this call never lands, the
  // session runs in the chosen order/exchanges today exactly as it did
  // before this was stored at all.
  function persistExerciseOrder() {
    const sessionId = session?.id;
    if (!sessionId) return;
    const order = exercises.map((e) => e.slug);
    apiFetch(`/api/strength/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseOrder: order, exerciseOverrides: overridesRef.current }),
    }).catch(() => {});
  }

  function handleStart() {
    if (exercises.length === 0) {
      setError("Add at least one exercise before starting.");
      return;
    }
    setError(null);
    persistExerciseOrder();
    setResume(null); // fresh start — the mount overwrites any old snapshot
    unlockGuidedAudio();
    setPhase("guided");
  }

  // Reopen the saved in-progress session at its saved position.
  function resumeGuided() {
    const snap = resumeSnap;
    if (!snap) return;
    haptic("light");
    adHocIdRef.current = null;
    setSession({
      id: snap.session.id,
      type: snap.session.type,
      title: snap.session.title,
      status: "planned",
      targetDurationMinutes: snap.session.targetDurationMinutes,
      plannedExercises: snap.exercises,
    });
    setExercises(snap.exercises);
    setResume({ exIndex: snap.exIndex, work: snap.work, startedAt: snap.startedAt });
    setError(null);
    unlockGuidedAudio();
    setPhase("guided");
  }

  // Dismiss the resume card without touching the server: the logged sets
  // stay on the (still "planned") session — the auto-close sweep picks it up
  // after the idle threshold, so nothing is silently lost by tapping away
  // (see lib/strength/schedule.ts autoCloseAbandonedSessions). Real deletion
  // goes through discardUnfinished below, which the athlete has to choose
  // explicitly.
  function discardResume() {
    haptic("light");
    clearGuidedSnapshot();
    setResumeSnap(null);
  }

  const [resumeActionBusy, setResumeActionBusy] = useState<"complete" | "discard" | null>(null);

  // Complete-in-place, without reopening the guided view: the server derives
  // the real duration from the session's own startedAt/endedAt (see the
  // sessions PATCH route), so there's nothing client-side left to compute.
  async function completeResume() {
    const snap = resumeSnap;
    if (!snap || resumeActionBusy) return;
    haptic("success");
    setResumeActionBusy("complete");
    try {
      const res = await apiFetch(`/api/strength/sessions/${snap.session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) {
        setError("Couldn't complete the workout. Try again.");
        return;
      }
      clearGuidedSnapshot();
      setResumeSnap(null);
    } catch {
      setError("Network error. Couldn't complete the workout.");
    } finally {
      setResumeActionBusy(null);
    }
  }

  // Deletes every set logged this session and puts it back to "planned" —
  // the same server call GuidedSession's own Discard makes. Unrecoverable,
  // which is why this sits behind its own explicit button, never the default.
  async function discardUnfinished() {
    const snap = resumeSnap;
    if (!snap || resumeActionBusy) return;
    haptic("warning");
    setResumeActionBusy("discard");
    try {
      const res = await apiFetch(`/api/strength/sessions/${snap.session.id}/sets`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Couldn't discard the workout. Try again.");
        return;
      }
      clearGuidedSnapshot();
      setResumeSnap(null);
    } catch {
      setError("Network error. Couldn't discard the workout.");
    } finally {
      setResumeActionBusy(null);
    }
  }

  function handleFinish(s: GuidedFinishSummary) {
    setResume(null);
    setSummary(s);
    setPainLogged(false);
    setPainError(null);
    setCutShortAnswered(false);
    setPhase("summary");
  }

  function handleExitGuided(_setsLogged: number) {
    // Minimize: the workout stays parked (snapshot intact, ad-hoc session
    // kept) even with zero sets logged — the resume card and the floating
    // pill are the way back in. Discard is the cleanup path.
    adHocIdRef.current = null;
    setResume(null);
    setPhase("picker");
    setSession(null);
    setExercises([]);
    setResumeSnap(loadGuidedSnapshot());
  }

  // Discard: GuidedSession already deleted the logged sets and cleared the
  // snapshot — remove an ad-hoc session entirely so nothing lingers on today.
  function handleDiscardGuided() {
    if (adHocIdRef.current && session?.id === adHocIdRef.current) {
      abandonSession(adHocIdRef.current);
    }
    adHocIdRef.current = null;
    setResume(null);
    setResumeSnap(null);
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
            href="/plan/rearrange"
            aria-label="Calendar"
            className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
          >
            <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
          </TransitionLink>
        } />
        <div className="px-4 pb-tabbar">
          {(() => {
            const todayPlanned = todaySessions.filter((s) => s.status === "planned");
            const [hero, ...rest] = todayPlanned;
            if (!hero) return null;
            return (
              <div className="mb-4 mt-1">
                {/* Next session — hero card, matches the Volt "Next session" tile */}
                <motion.button
                  type="button"
                  disabled={busy}
                  onClick={() => openSessionOverview(hero.id)}
                  whileTap={{ scale: busy ? 1 : 0.97 }}
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  style={{ touchAction: "manipulation" }}
                  className="k-card flex w-full items-center justify-between p-5 text-left disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span
                      className="block text-[10px] font-extrabold uppercase tracking-[0.14em]"
                      style={{ color: "var(--vi-lift)" }}
                    >
                      Next session
                    </span>
                    <span className="mt-1 block text-[21px] font-extrabold text-text-1">
                      {hero.title || TYPE_META[hero.type]?.title || "Strength"}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-text-3">
                      {hero.targetDurationMinutes ? `~${hero.targetDurationMinutes} min est.` : "Scheduled for today"}
                    </span>
                  </span>
                  <span className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-accent">
                    <Play className="h-[22px] w-[22px] text-on-accent" strokeWidth={2} fill="currentColor" />
                  </span>
                </motion.button>

                {rest.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2.5">
                    {rest.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={busy}
                        onClick={() => openSessionOverview(s.id)}
                        style={{ touchAction: "manipulation" }}
                        className="press flex items-center gap-3 k-card p-3.5 text-left disabled:opacity-50"
                      >
                        <span
                          className="h-9 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: TYPE_META[s.type]?.color ?? "var(--accent)" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-bold text-text-1">
                            {s.title || TYPE_META[s.type]?.title || "Strength"}
                          </span>
                          <span className="block text-[12px] text-text-3">Also scheduled today</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.9} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* What running phase strength is following, in one line — the
              engine already backs sets off by phase (phase-policy.ts); this
              is just saying so, not a new decision. Absent with no active
              running plan (standalone block has no phase to report). */}
          {hubStats?.phase && (
            <p className="mb-4 text-[13px] text-text-3">
              <span className="font-bold text-text-2">{hubStats.phase.phaseLabel} phase.</span>{" "}
              {hubStats.phase.note}
            </p>
          )}

          {/* Stat row — real aggregates only; no invented numbers. Loaded
              volume (kg) and bodyweight work (reps) are two separate tiles,
              not summed into one figure — they're not the same unit (see
              lib/strength/volume.ts). */}
          {(hubStats?.sessionsPerWeek != null ||
            hubStats?.volumeKg != null ||
            hubStats?.bodyweightReps != null) && (
            <div className="mb-5 flex gap-2.5">
              {hubStats.sessionsPerWeek != null && (
                <div className="flex-1 k-card p-3.5">
                  <p className="font-display text-[26px] leading-none text-text-1">
                    {hubStats.sessionsPerWeek}
                    <span className="text-[13px] font-sans font-semibold text-text-3">/wk</span>
                  </p>
                  <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-text-3">Sessions</p>
                </div>
              )}
              {hubStats.volumeKg != null && (
                <div className="flex-1 k-card p-3.5">
                  <p className="font-display text-[26px] leading-none text-text-1">
                    {(displayWeight(hubStats.volumeKg) / 1000).toFixed(1)}
                    <span className="text-[13px] font-sans font-semibold text-text-3">
                      {" "}
                      {weightUnitLabel() === "kg" ? "t" : "k lbs"}
                    </span>
                  </p>
                  <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-text-3">Volume · 7d</p>
                </div>
              )}
              {hubStats.bodyweightReps != null && (
                <div className="flex-1 k-card p-3.5">
                  <p className="font-display text-[26px] leading-none text-text-1">
                    {hubStats.bodyweightReps}
                  </p>
                  <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-text-3">
                    Bodyweight reps · 7d
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="text-[15px] text-text-2">
            {todaySessions.some((s) => s.status === "planned")
              ? "Or start another workout, or create a custom one."
              : "Select a workout or create a custom one to get started."}
          </p>

          {/* No strength_plan_settings row yet — sessions use unfiltered
              equipment and no ability adjustment (see service.ts
              derivePlanSettingsForLoads). One line, not a modal or gate: an
              athlete who wants to lift now still can. */}
          {showSetupPrompt && (
            <TransitionLink
              href="/strength/setup"
              className="press mt-3 flex items-center justify-between gap-2 rounded-[var(--radius-input)] bg-accent/10 px-3.5 py-2.5 text-[13px] font-semibold text-accent-fg"
            >
              <span>Set up equipment, injuries and session length for better sessions</span>
              <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2} />
            </TransitionLink>
          )}

          {error && (
            <div className="mt-3 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
              {error}
            </div>
          )}

          {resumeSnap && (
            <div className="mt-4 k-card p-4" data-testid="unfinished-session-prompt">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-[20px]">⏱️</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-bold text-text-1">Unfinished session</p>
                  <p className="text-[13px] text-text-3">
                    {resumeSnap.session.title} ·{" "}
                    {Object.values(resumeSnap.work).flat().filter((s) => s.logged).length} of{" "}
                    {Object.values(resumeSnap.work).flat().length} sets logged
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Hide this reminder"
                  onClick={discardResume}
                  className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated"
                >
                  <X className="h-4 w-4 text-text-3" strokeWidth={1.9} />
                </button>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Button variant="primary" full onClick={resumeGuided}>
                  Continue workout
                </Button>
                <Button variant="secondary" full busy={resumeActionBusy === "complete"} onClick={completeResume}>
                  Complete workout · keeps the {Object.values(resumeSnap.work).flat().filter((s) => s.logged).length} logged set{Object.values(resumeSnap.work).flat().filter((s) => s.logged).length === 1 ? "" : "s"}
                </Button>
                <Button variant="danger" full busy={resumeActionBusy === "discard"} onClick={discardUnfinished}>
                  Discard workout · deletes every logged set, can&apos;t be undone
                </Button>
              </div>
            </div>
          )}

          <p className="mb-2 mt-5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-text-3">
            Programme
          </p>
          <div className="flex flex-col gap-2" data-testid="kraft-programme-list">
            {PICKER_TYPES.map((t) => {
              const meta = TYPE_META[t];
              const Icon = meta.icon;
              // Tapping this card either adopts today's already-planned
              // session of this type or creates a fresh one (see pickType
              // below) — the "+ rehab work" promise has to match whichever
              // one actually happens, not just whether the complaint is
              // reported. If today already has a planned session of this
              // type, its own achillesAttached flag is the fact (the weekly
              // rehab pass decides per-session, not per-complaint — most
              // sessions in a week don't carry it, see reconcile.ts
              // computeAchillesRehabDays). Only when there's no session to
              // adopt yet does the complaint list decide, because a
              // freshly-created session really does fall back to it (see
              // service.ts buildPlannedSession's hasHsrWork).
              const todaysOfType = todaySessions.find((s) => s.type === t && s.status === "planned");
              const hasRehabWork = todaysOfType
                ? Boolean(todaysOfType.achillesAttached)
                : complaints.includes("achilles");
              const sub = hasRehabWork ? `${meta.sub} + Rehab work` : meta.sub;
              return (
                <motion.button
                  key={t}
                  type="button"
                  data-testid={`kraft-programme-card-${t}`}
                  disabled={busy}
                  onClick={() => {
                    setStartType(t);
                    setStartDuration(null);
                    setStartAccess(null);
                  }}
                  whileTap={{ scale: busy ? 1 : 0.97 }}
                  transition={{ type: "spring", stiffness: 500, damping: 32 }}
                  style={{ touchAction: "manipulation" }}
                  className="flex items-center gap-3 k-card p-3.5 text-left disabled:opacity-50"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${meta.color}24` }}
                  >
                    <Icon className="h-[19px] w-[19px]" strokeWidth={2} style={{ color: meta.color }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-text-1">{meta.title}</span>
                    <span className="block text-[12px] text-text-3">{sub}</span>
                  </span>
                  <ChevronRight className="h-[19px] w-[19px] shrink-0 text-text-3" strokeWidth={1.9} />
                </motion.button>
              );
            })}
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
                    aria-label={`Edit ${t.name}`}
                    onClick={() => { haptic("light"); setEditingTemplate(t); setCustomBuilderOpen(true); }}
                    className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated"
                  >
                    <Pencil className="h-4 w-4 text-text-3" strokeWidth={1.9} />
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
              <Button
                variant="secondary"
                full
                data-testid="kraft-create-custom-workout"
                onClick={() => setCustomBuilderOpen(true)}
              >
                <Plus className="h-4 w-4" strokeWidth={2.2} />
                Create custom workout
              </Button>
            </div>
          </div>

          <TransitionLink
            href="/strength/history"
            className="mt-5 block text-center text-[15px] font-semibold text-accent-fg"
          >
            View history →
          </TransitionLink>
        </div>

        <CustomWorkoutBuilder
          open={customBuilderOpen}
          onClose={() => { setCustomBuilderOpen(false); setEditingTemplate(null); }}
          onSave={handleSaveCustomWorkout}
          initial={editingTemplate ? { name: editingTemplate.name, slots: editingTemplate.slots } : null}
        />

        {/* Pre-start sheet: "this session only" length/equipment — see
            SessionStartOptions. Selections default to "Usual" (no override,
            the profile's own Kraft settings apply, same as before this
            existed). */}
        <Sheet
          open={startType != null}
          onClose={() => setStartType(null)}
          title={startType ? TYPE_META[startType].title : undefined}
        >
          {startType && (
            <div className="px-4 pb-6">
              <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-text-3">
                Length today
              </p>
              <div className="flex flex-wrap gap-1.5" data-testid="kraft-duration-chips">
                <button
                  type="button"
                  aria-pressed={startDuration == null}
                  data-testid="kraft-duration-usual"
                  onClick={() => { haptic("light"); setStartDuration(null); }}
                  className={`press rounded-full px-3.5 py-2 text-[13px] font-bold ${
                    startDuration == null ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                  }`}
                >
                  Usual
                </button>
                {START_DURATIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={startDuration === m}
                    data-testid={`kraft-duration-${m}`}
                    onClick={() => { haptic("light"); setStartDuration(m); }}
                    className={`press rounded-full px-3.5 py-2 text-[13px] font-bold ${
                      startDuration === m ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                    }`}
                  >
                    {m} min
                  </button>
                ))}
              </div>

              <p className="mb-2 mt-5 text-[12px] font-bold uppercase tracking-wide text-text-3">
                Equipment today
              </p>
              <div className="flex flex-wrap gap-1.5" data-testid="kraft-equipment-chips">
                <button
                  type="button"
                  aria-pressed={startAccess == null}
                  data-testid="kraft-equipment-usual"
                  onClick={() => { haptic("light"); setStartAccess(null); }}
                  className={`press rounded-full px-3.5 py-2 text-[13px] font-bold ${
                    startAccess == null ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                  }`}
                >
                  Usual
                </button>
                {ACCESS_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={startAccess === level}
                    data-testid={`kraft-equipment-${level}`}
                    onClick={() => { haptic("light"); setStartAccess(level); }}
                    className={`press rounded-full px-3.5 py-2 text-[13px] font-bold ${
                      startAccess === level ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                    }`}
                  >
                    {ACCESS_PRESETS[level].label}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                <Button
                  variant="primary"
                  size="lg"
                  full
                  data-testid="kraft-start-session"
                  onClick={() => {
                    const t = startType;
                    const duration = startDuration;
                    const access = startAccess;
                    setStartType(null);
                    if (!t) return;
                    pickType(
                      t,
                      {
                        durationOverrideMinutes: duration ?? undefined,
                        equipmentOverride: access ? ACCESS_PRESETS[access].equipment : undefined,
                      },
                      {
                        durationMinutes: duration ?? undefined,
                        accessLabel: access ? ACCESS_PRESETS[access].label : undefined,
                      }
                    );
                  }}
                >
                  Start
                </Button>
              </div>
            </div>
          )}
        </Sheet>

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
        exerciseOverrides={session.exerciseOverrides ?? []}
        complaints={complaints}
        resume={resume}
        onExit={handleExitGuided}
        onDiscard={handleDiscardGuided}
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

          {/* Cut-short reason — only when GuidedSession left prescribed sets
              unlogged at Finish, never for a fully completed session (that
              would be a nag with nothing to ask about) and never per
              exercise (see progression.ts for why one session-level answer
              is enough). One tap, always dismissible via "Not sure". */}
          {session && summary.skippedWorkingSets > 0 && !cutShortAnswered && (
            <div className="mt-4 rounded-[var(--radius-input)] bg-elevated p-4 text-left">
              <p className="text-[13px] font-semibold text-text-2">
                Didn&apos;t finish every set — why?
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  busy={cutShortSaving === "time"}
                  disabled={cutShortSaving != null}
                  onClick={() => logCutShortReason("time")}
                >
                  Ran out of time
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  busy={cutShortSaving === "fatigue"}
                  disabled={cutShortSaving != null}
                  onClick={() => logCutShortReason("fatigue")}
                >
                  Too fatigued
                </Button>
              </div>
              <button
                type="button"
                className="press mt-2 text-[12px] font-semibold text-text-3"
                disabled={cutShortSaving != null}
                onClick={() => setCutShortAnswered(true)}
              >
                Not sure
              </button>
            </div>
          )}

          {/* Complaint-driven pain check-in — only for the areas the athlete
              flagged (feeds the pain gate + history sparkline). No complaints,
              no prompt. */}
          {session && complaints.length > 0 && (
            <div className="mt-6 rounded-[var(--radius-input)] bg-elevated p-4 text-left">
              <p className="text-[13px] font-semibold text-text-2">
                {painLogged
                  ? "Pain logged, thanks."
                  : `Any ${complaints
                      .map((c) => COMPLAINT_SHORT_LABELS[c])
                      .join(" / ")} pain right now? (0 = none, 10 = worst)`}
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
  // Deep-link overview while the session detail is still loading — show the
  // overview chrome (never a flash of the picker) with a light placeholder.
  if (phase === "overview" && !session) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar
          title=""
          large={false}
          left={
            <button
              type="button"
              onClick={overviewBack}
              aria-label="Back"
              data-testid="kraft-overview-back"
              style={{ touchAction: "manipulation" }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-text-1"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
          }
        />
        <div className="px-4 pb-tabbar">
          <div className="h-7 w-40 animate-pulse rounded-md bg-elevated" />
          <div className="mt-2 h-4 w-28 animate-pulse rounded-md bg-elevated" />
          <div className="mt-5 space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-[var(--radius-input)] bg-elevated" />
            ))}
          </div>
          {error && <p className="mt-4 text-[13px] font-medium text-danger">{error}</p>}
        </div>
        <BottomNav active="strength" />
      </main>
    );
  }

  if (phase === "overview" && session) {
    const addable = catalog.filter(
      (r) =>
        ADD_CATEGORIES[session.type].includes(r.category) &&
        !exercises.some((e) => e.slug === r.slug)
    );
    // Group the add sheet by primary muscle (metadata lives in the code
    // catalogue; the DB rows carry the last-used numbers).
    // "Arms" split into "Biceps"/"Triceps" as raw primaryMuscle values (see
    // program.ts) — kept both here so this unrelated add-exercise sheet
    // doesn't regress to sorting them ahead of every other group.
    const MUSCLE_ORDER = ["Shoulders", "Chest", "Back", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves & Achilles", "Core", "Other"];
    const addGroups = new Map<string, ExerciseCatalogRow[]>();
    for (const row of addable) {
      const muscle = EXERCISES.find((e) => e.slug === row.slug)?.primaryMuscle ?? "Other";
      const list = addGroups.get(muscle) ?? [];
      list.push(row);
      addGroups.set(muscle, list);
    }
    const sortedGroups = [...addGroups.entries()].sort(
      (x, y) => MUSCLE_ORDER.indexOf(x[0]) - MUSCLE_ORDER.indexOf(y[0])
    );
    // Total time follows the current exercise list, not the stock template.
    // Pass the full exercises (never a stripped-down slot) so perSide accessories
    // are counted the same way the detail screen and scheduler count them —
    // dropping perSide here is what made this read 37 min for a 44 min session.
    const liveEstimate = estimateWorkoutDuration(exercises);
    // Prescribed volume (not logged reality — nothing's been done yet): top
    // of the rep range at the suggested load, summed across working sets.
    // Bodyweight/unloaded exercises contribute 0, same as the detail screen's
    // logged-volume tile once the session is actually recorded.
    const plannedVolumeKg = exercises.reduce(
      (sum, e) => sum + e.sets * e.repHigh * (e.suggestedWeightKg ?? 0),
      0
    );

    return (
      <main className="min-h-dvh bg-bg">
        <NavBar
          title={session.title}
          large={false}
          left={
            <button
              type="button"
              onClick={overviewBack}
              aria-label="Back"
              data-testid="kraft-overview-back"
              style={{ touchAction: "manipulation" }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-text-1"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
            </button>
          }
          right={
            garminConnected ? (
              <button
                type="button"
                onClick={sendToWatch}
                disabled={watchSend === "sending"}
                aria-label={watchSend === "sent" ? "Sent to watch" : "Send to watch"}
                title={watchSend === "sent" ? "Sent, start it on your watch" : "Send to watch"}
                style={{ touchAction: "manipulation" }}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-60 ${
                  watchSend === "sent"
                    ? "bg-accent text-on-accent"
                    : watchSend === "error"
                    ? "bg-danger/15 text-danger"
                    : "bg-elevated text-text-1 active:bg-hairline"
                }`}
              >
                {watchSend === "sent" ? (
                  <Check className="h-[18px] w-[18px]" strokeWidth={2.6} />
                ) : (
                  <span className="relative flex items-center">
                    <Watch className="h-[18px] w-[18px]" strokeWidth={2} />
                    <ArrowUpRight className="-ml-1 -mt-2 h-3 w-3" strokeWidth={2.8} />
                  </span>
                )}
              </button>
            ) : undefined
          }
        />
        <div className="px-4 pb-tabbar">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-text-3">Session setup</p>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight text-text-1">{session.title}</h1>

          {/* Confirms the pre-start sheet's "this session only" choice actually
              applied — it used to vanish here with nothing to show for it.
              Only shown when an override is actually set (see appliedOverride). */}
          {appliedOverride && (appliedOverride.durationMinutes != null || appliedOverride.accessLabel != null) && (
            <p className="mt-1 text-[13px] font-semibold text-accent-fg">
              {[
                appliedOverride.durationMinutes != null ? `${appliedOverride.durationMinutes} min today` : null,
                appliedOverride.accessLabel != null ? `${appliedOverride.accessLabel} today` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}

          <div className="mt-3 flex gap-2.5">
            <div className="flex-1 k-card p-3.5" data-testid="kraft-overview-exercise-count">
              <p className="font-display text-[24px] leading-none text-text-1">{exercises.length}</p>
              <p className="mt-1.5 text-[9.5px] font-bold uppercase tracking-wide text-text-3">Exercises</p>
            </div>
            <div className="flex-1 k-card p-3.5" data-testid="kraft-overview-estimate">
              <p className="font-display text-[24px] leading-none text-text-1">
                {liveEstimate}
                <span className="text-[12px] font-sans font-semibold text-text-3">min</span>
              </p>
              <p className="mt-1.5 text-[9.5px] font-bold uppercase tracking-wide text-text-3">Est.</p>
            </div>
            <div className="flex-1 k-card p-3.5">
              <p className="font-display text-[24px] leading-none text-text-1">
                {(displayWeight(plannedVolumeKg) / 1000).toFixed(1)}
                <span className="text-[12px] font-sans font-semibold text-text-3">
                  {weightUnitLabel() === "kg" ? "t" : "k lbs"}
                </span>
              </p>
              <p className="mt-1.5 text-[9.5px] font-bold uppercase tracking-wide text-text-3">Volume</p>
            </div>
          </div>

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

          <p className="mb-2 mt-5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-text-3">Order</p>

          {exercises.length > 1 && (
            <div className="mb-2">
              <SortChips mode={sortMode} onSelect={applySort} />
              <p className="mt-1.5 text-[12px] text-text-3">Hold and drag a card to reorder.</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <DndContext
              sensors={dndSensors}
              collisionDetection={closestCenter}
              onDragStart={() => haptic("light")}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={exercises.map((x) => x.slug)} strategy={verticalListSortingStrategy}>
            {exercises.map((ex, ei) => {
              // Achilles rehab work is tinted cyan and never reads as an
              // ordinary accessory row ("rehab, not filler" — see Volt
              // session-start spec).
              const isRehab = Boolean(EXERCISES.find((e) => e.slug === ex.slug)?.achillesRole);
              return (
              <SortableItem
                key={ex.slug}
                id={ex.slug}
                data-testid={`kraft-exercise-${ex.slug}`}
                className={`flex items-start gap-3 rounded-[var(--radius-card)] p-3.5 ${
                  isRehab ? "bg-warn/10 ring-1 ring-inset ring-warn/30" : "k-card"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-elevated font-display text-[13px] text-text-2">
                  {ei + 1}
                </span>
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => { haptic("light"); setEditIdx(ei); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") setEditIdx(ei); }}
                  aria-label={`Edit ${ex.name}`}
                >
                  <p className="text-[15px] font-bold leading-tight text-text-1">{ex.name}</p>
                  <p className="mt-0.5 text-[12px] text-text-3">
                    {ex.sets} sets × {ex.repLow === ex.repHigh ? ex.repLow : `${ex.repLow}–${ex.repHigh}`} reps · {ex.restSeconds}s rest
                  </p>
                  <p className="mt-0.5 text-[12px] font-medium text-text-2">
                    {formatLoad(ex.suggestedWeightKg, { dumbbells: ex.dumbbells, holdNote: ex.holdNote, perSide: ex.perSide })}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ex.flatGroundOnly && (
                      <span className="rounded-md bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">
                        ⚠ Flat ground only
                      </span>
                    )}
                    {ex.painGated && (
                      <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger">
                        Eased (pain gate)
                      </span>
                    )}
                    {ex.progression.action === "increase" && (
                      <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-bold text-accent-fg">
                        ↑ Level up
                      </span>
                    )}
                  </div>
                </div>
                {/* Video preview + swap + remove, 44×44 tap targets — sweaty-hands
                    sizing, not a combined menu (see Volt session-start spec). */}
                <div className="flex shrink-0 items-start gap-1.5">
                  {getVideoId(ex.slug) && (
                    <button
                      type="button"
                      onClick={() => { haptic("light"); setVideoSlug(ex.slug); }}
                      aria-label={`Watch ${ex.name} form demo`}
                      style={{ touchAction: "manipulation" }}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-3"
                    >
                      <Video className="h-4 w-4" strokeWidth={2.2} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openActionsFor(ex.slug)}
                    aria-label={`Exchange ${ex.name}`}
                    style={{ touchAction: "manipulation" }}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-3"
                  >
                    <Repeat className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeExercise(ex.slug)}
                    aria-label={`Remove ${ex.name}`}
                    style={{ touchAction: "manipulation" }}
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-3"
                  >
                    <X className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                </div>
              </SortableItem>
              );
            })}
              </SortableContext>
            </DndContext>

            <motion.button
              type="button"
              onClick={openAddSheet}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              style={{ touchAction: "manipulation" }}
              className="flex items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-hairline bg-transparent p-3.5 text-[15px] font-semibold text-accent-fg"
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
            <div className="max-h-[60dvh] overflow-y-auto px-4 pb-6">
              {sortedGroups.map(([muscle, list]) => (
                <div key={muscle} className="mb-4">
                  <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">{muscle}</p>
                  <div className="flex flex-col gap-1.5">
                    {list.map((row) => (
                      <button
                        key={row.slug}
                        type="button"
                        onClick={() => addExercise(row)}
                        className="press rounded-[var(--radius-input)] bg-elevated px-3.5 py-2.5 text-left"
                      >
                        <span className="block text-[15px] font-semibold text-text-1">{row.name}</span>
                        <span className="block text-[12px] text-text-3">
                          {row.lastWeightKg != null
                            ? `Last: ${formatWeightKg(row.lastWeightKg)} × ${row.lastRepLow === row.lastRepHigh ? row.lastRepLow : `${row.lastRepLow}–${row.lastRepHigh}`}${row.lastDate ? ` · ${formatRecency(row.lastDate)}` : ""}`
                            : `${row.defaultSets ?? 3} × ${row.repLow ?? 8}–${row.repHigh ?? 12}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Sheet>

        <Sheet open={editIdx != null} onClose={() => setEditIdx(null)} title="Edit exercise">
          {editIdx != null && exercises[editIdx] && (
            <ExerciseEditor
              exercise={exercises[editIdx]}
              onChange={(patch) =>
                setExercises((exs) =>
                  exs.map((e, i) => {
                    if (i !== editIdx) return e;
                    const next = { ...e, ...patch };
                    next.prescription =
                      next.repLow === next.repHigh
                        ? `${next.sets} × ${next.repLow}`
                        : `${next.sets} × ${next.repLow}–${next.repHigh}`;
                    return next;
                  })
                )
              }
              onDone={() => setEditIdx(null)}
            />
          )}
        </Sheet>

        <ExerciseActionsSheet
          open={actionsSlug != null}
          onClose={() => setActionsSlug(null)}
          exercise={actionsSlug ? exercises.find((e) => e.slug === actionsSlug) ?? null : null}
          otherSlugsInSession={exercises.filter((e) => e.slug !== actionsSlug).map((e) => e.slug)}
          // This session's own equipment choice (pre-start sheet, "gym today")
          // wins over the profile's usual equipment for alternatives, exactly
          // like it already wins when the plan itself gets built — otherwise
          // Exchange would offer machines the athlete just said aren't
          // available today.
          equipment={session?.equipmentOverride ?? equipment}
          hasLoggedSets={false}
          onExchange={(replacementSlug) => actionsSlug && exchangeExercise(actionsSlug, replacementSlug)}
        />

        <VideoSheet
          slug={videoSlug}
          title={videoSlug ? exercises.find((e) => e.slug === videoSlug)?.name : undefined}
          onClose={() => setVideoSlug(null)}
        />

        <BottomNav active="strength" />
      </main>
    );
  }

  return null;
}

// ── Inline exercise editor (overview) ────────────────────────────────────────

const REST_PRESETS = [30, 60, 90];

function Stepper({
  label,
  value,
  unit,
  onDelta,
}: {
  label: string;
  value: string;
  unit?: string;
  onDelta: (d: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] font-semibold text-text-2">{label}</span>
      <div className="flex items-center gap-3">
        <StepperButton ariaLabel={`Less ${label}`} onClick={() => { haptic("light"); onDelta(-1); }}>
          <Minus className="h-4 w-4" strokeWidth={2.5} />
        </StepperButton>
        <span className="min-w-[72px] text-center text-[17px] font-extrabold tabular-nums text-text-1">
          {value}{unit && <span className="text-[12px] font-semibold text-text-3"> {unit}</span>}
        </span>
        <StepperButton ariaLabel={`More ${label}`} onClick={() => { haptic("light"); onDelta(1); }}>
          <Plus className="h-4 w-4" strokeWidth={2.5} />
        </StepperButton>
      </div>
    </div>
  );
}

function ExerciseEditor({
  exercise,
  onChange,
  onDone,
}: {
  exercise: PlannedExercise;
  onChange: (patch: Partial<PlannedExercise>) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <p className="text-[15px] font-bold text-text-1">{exercise.name}</p>
      <Stepper
        label="Sets"
        value={String(exercise.sets)}
        onDelta={(d) => onChange({ sets: Math.min(10, Math.max(1, exercise.sets + d)) })}
      />
      <Stepper
        label="Reps from"
        value={String(exercise.repLow)}
        onDelta={(d) => onChange({ repLow: Math.min(exercise.repHigh, Math.max(1, exercise.repLow + d)) })}
      />
      <Stepper
        label="Reps to"
        value={String(exercise.repHigh)}
        onDelta={(d) => onChange({ repHigh: Math.min(100, Math.max(exercise.repLow, exercise.repHigh + d)) })}
      />
      <Stepper
        label="Weight"
        value={
          exercise.suggestedWeightKg != null && exercise.suggestedWeightKg > 0
            ? String(displayWeight(exercise.suggestedWeightKg))
            : "BW"
        }
        unit={exercise.suggestedWeightKg != null && exercise.suggestedWeightKg > 0 ? weightUnitLabel() : undefined}
        onDelta={(d) =>
          onChange({
            // Steps along the standard ladder; 0 = bodyweight.
            suggestedWeightKg: stepWeight(exercise.suggestedWeightKg, d > 0 ? 1 : -1),
          })
        }
      />
      <div>
        <p className="mb-2 text-[13px] font-semibold text-text-2">Rest between sets</p>
        <div className="flex gap-2">
          {REST_PRESETS.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => { haptic("light"); onChange({ restSeconds: sec }); }}
              className={`press flex-1 rounded-[var(--radius-input)] py-2.5 text-[15px] font-bold ${
                exercise.restSeconds === sec ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
              }`}
            >
              {sec}s
            </button>
          ))}
          {!REST_PRESETS.includes(exercise.restSeconds) && (
            <span className="flex flex-1 items-center justify-center rounded-[var(--radius-input)] bg-accent text-[15px] font-bold text-on-accent">
              {exercise.restSeconds}s
            </span>
          )}
        </div>
      </div>
      <Button full onClick={onDone}>Done</Button>
    </div>
  );
}
