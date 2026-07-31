"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, Volume2, VolumeX, Check, Pause, Play, History, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { StepperButton } from "@/components/ui/StepperButton";
import { ExerciseActionsSheet } from "@/components/strength/ExerciseActionsSheet";
import { haptic } from "@/lib/haptics";
import { formatRecency } from "@/lib/recency";
import {
  clearGuidedSnapshot,
  saveGuidedSnapshot,
  loadGuidedSnapshot,
  type GuidedWorkSet,
} from "@/lib/strength/guided-snapshot";
import { VideoSheet } from "@/components/strength/VideoSheet";
import { AdjustLoadSheet } from "@/components/strength/AdjustLoadSheet";
import { PrMoment, type PrMomentEvent } from "@/components/strength/PrMoment";
import { deriveWarmupRampIfEnabled } from "@/lib/strength/warmup";
import { appendExtraSet, removeLastExtraSet } from "@/lib/strength/guided-sets";
import { getVideoId } from "@/lib/strength/videos";
import { displayWeight, weightUnitLabel } from "@/lib/units";
import { apiFetch } from "@/lib/api";
import { mutateWithQueue, queuedCountFor, dropQueuedFor, flushQueue } from "@/lib/offline-queue";
import { CUE_VOLUME_GAIN, loadSettings, saveSettings, type UserSettings } from "@/lib/settings";
import { getAudioCtx, unlockGuidedAudio } from "@/lib/strength/guided-audio";
export { unlockGuidedAudio };
import { formatLoad, loadUnitLabel, stepWeight } from "@/lib/strength/weights";
import { PAIN_SCORE_THRESHOLD } from "@/lib/strength/progression";
import { EXERCISE_BY_SLUG, isHsrExercise } from "@/lib/strength/program";
import { complaintWorkSlugs, hasAchillesOrdering } from "@/lib/strength/complaint-work";
import { COMPLAINT_SHORT_LABELS, workingSetNumber, type Complaint } from "@/lib/strength/types";
import { useStrengthEquipment } from "@/hooks/useStrengthEquipment";
import type { LoadFeel } from "@/lib/strength/guided-snapshot";
import type { ExerciseOverride } from "@/lib/strength/session";

// ── Types (mirrors src/app/strength/page.tsx) ─────────────────────────────────

export type SessionType = "upper" | "lower" | "lower_achilles" | "upper_achilles" | "achilles" | "full_body";

export interface PlannedExercise {
  slug: string;
  name: string;
  category: "upper" | "lower" | "achilles" | "full_body";
  equipmentNote?: string;
  tempoNote?: string;
  flatGroundOnly: boolean;
  perSide: boolean;
  dumbbells?: 1 | 2;
  holdNote?: string;
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds: number;
  prescription: string;
  suggestedWeightKg: number | null;
  lastWeightKg: number | null;
  /** ISO date of the most recent completed session containing this exercise. */
  lastDate?: string | null;
  painGated: boolean;
  progression: { action: string; reason: string };
  /** Trim priority from session.ts — also the warm-up-ramp eligibility
   *  signal (see lib/strength/warmup.ts): only "primary" compound lifts get
   *  a suggested ramp. Optional because exchangeCurrentExercise's rebuilt
   *  exercise object doesn't set it explicitly (it carries over via spread
   *  from the original slot, same as session.ts's swap override). */
  priority?: "primary" | "accessory" | "achilles" | "targeted";
}

export interface GuidedSessionInfo {
  id: string;
  type: SessionType;
  title: string;
  targetDurationMinutes: number | null;
}

export interface GuidedFinishSummary {
  setsLogged: number;
  totalSets: number;
  durationMinutes: number;
}

type WorkSet = GuidedWorkSet;

interface Props {
  session: GuidedSessionInfo;
  exercises: PlannedExercise[];
  /** Persisted overrides already applied to `exercises` (see the session
   *  detail/overview screens) — Exchange/Remove here append to this same
   *  array so a minimize/resume or a later detail view stays in sync. */
  exerciseOverrides?: ExerciseOverride[];
  /** The athlete's reported complaints — decides which pain wording applies
   *  (see AdjustLoadSheet's easesWorkLabel). Empty when none are reported. */
  complaints?: Complaint[];
  /** Restore a previously saved in-progress session at its saved position. */
  resume?: { exIndex: number; work: Record<string, WorkSet[]>; startedAt: number } | null;
  /**
   * Minimize: leave the guided view without ending the workout. The snapshot
   * stays so the session can be resumed. Receives how many sets are logged.
   */
  onExit: (setsLogged: number) => void;
  /** Discard: the session's sets were deleted and the snapshot cleared. */
  onDiscard: () => void;
  onFinish: (summary: GuidedFinishSummary) => void;
}

// A single running timer, anchored to wall-clock epochs so it stays correct
// across exercise navigation and app backgrounding.
type Timer =
  | { kind: "set"; slug: string; setIndex: number; startMs: number }
  | { kind: "rest"; slug: string; setIndex: number; endMs: number; totalMs: number }
  | { kind: "getready"; slug: string; setIndex: number; endMs: number };

const GET_READY_SECONDS = 5;

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

// Rest countdown ring (state-driven fill, see the render below). Sized down
// from the original 200px board spec — the rest phase competes with the
// weight/reps steppers and the Skip button for the same one-screen budget
// (see the no-scroll requirement at the top of the render), so the ring gives
// up some size before anything below it does.
const REST_RING_D = 168;
const REST_RING_R = 70;
const REST_RING_C = 2 * Math.PI * REST_RING_R;

// ── Audio (Web Speech + a tiny Web Audio beep), both best-effort ──────────────
// iOS gates both behind a user gesture, so `unlockGuidedAudio` must be called
// synchronously from the Start button's onClick before this component mounts.

// Small WU / numbered pill (see the design board's .setrow .tag). Tappable
// to flip warm-up ↔ working when `onToggle` is given; read-only otherwise
// (already-logged rows and the "last time" popup only ever display it).
function SetTag({
  kind,
  number,
  onToggle,
}: {
  kind?: "warmup" | "working";
  number: number;
  onToggle?: () => void;
}) {
  const isWarmup = kind === "warmup";
  const classes = isWarmup
    ? "bg-elevated text-text-3"
    : "bg-[#5AA0FF]/15 text-[#5AA0FF]";
  const content = isWarmup ? "WU" : String(number);
  if (!onToggle) {
    return (
      <span className={`flex h-5 min-w-[24px] shrink-0 items-center justify-center rounded-md px-1 text-[9px] font-extrabold ${classes}`}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isWarmup ? "Mark as a working set" : "Mark as a warm-up set"}
      style={{ touchAction: "manipulation" }}
      className={`press flex h-5 min-w-[24px] shrink-0 items-center justify-center rounded-md px-1 text-[9px] font-extrabold ${classes}`}
    >
      {content}
    </button>
  );
}

function buildWork(exercises: PlannedExercise[], warmupSuggestionsEnabled: boolean): Record<string, WorkSet[]> {
  const w: Record<string, WorkSet[]> = {};
  for (const ex of exercises) {
    // Pre-tag a suggested warm-up ramp ahead of the working sets, so a heavy
    // primary lift arrives with something to correct rather than nothing —
    // see lib/strength/warmup.ts for the eligibility and sizing rule. Gated
    // by the athlete's preference (off = stop suggesting, not "no warm-ups").
    const ramp = deriveWarmupRampIfEnabled(ex.priority, ex.suggestedWeightKg, warmupSuggestionsEnabled);
    const rampSets: WorkSet[] = ramp.map((r) => ({
      kg: r.kg,
      reps: r.reps,
      logged: false,
      durationSec: 0,
      kind: "warmup",
    }));
    const workingSets: WorkSet[] = Array.from({ length: ex.sets }, () => ({
      kg: ex.suggestedWeightKg ?? 0,
      reps: ex.repHigh,
      logged: false,
      durationSec: 0,
      kind: "working",
    }));
    w[ex.slug] = [...rampSets, ...workingSets];
  }
  return w;
}

// Previous performance of one exercise (dated per-set detail from history).
// `setNumber` is the raw persisted position (kept for the API's upsert key,
// not display — see workingSetNumber in lib/strength/types.ts); `kind`
// drives what's actually shown. `exerciseSlug`/`exerciseName` are set only
// when this came from `familyLast` (a same-movement variant, e.g. a barbell
// squat session standing in for today's dumbbell squat's "last done") so the
// sheet can say what was actually done instead of implying it was this exact
// exercise — see the API route's movementFamilySlugs comment for why this
// exists (a per-session equipment override can change which slug a movement
// resolves to day to day).
interface LastPerf {
  date: string;
  sets: Array<{ setNumber: number; weightKg: number | null; reps: number | null; kind?: "warmup" | "working" | null }>;
  exerciseSlug?: string;
  exerciseName?: string;
}

export default function GuidedSession({
  session,
  exercises: exercisesProp,
  exerciseOverrides: initialOverrides,
  complaints = [],
  resume,
  onExit,
  onDiscard,
  onFinish,
}: Props) {
  const [prefs, setPrefs] = useState<UserSettings>(() => loadSettings());
  const [now, setNow] = useState<number>(() => Date.now());
  // Local copy: Exchange/Remove mutate the session's live exercise list
  // (never sent as a prop update — see exchangeCurrentExercise/removeCurrentExercise).
  const [exercises, setExercises] = useState<PlannedExercise[]>(exercisesProp);
  const [exIndex, setExIndex] = useState(() =>
    resume ? Math.min(Math.max(resume.exIndex, 0), exercisesProp.length - 1) : 0
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const equipment = useStrengthEquipment();
  // Hand-edit layer this mount has made, seeded from what's already
  // persisted — appended to (never replaced) and PATCHed best-effort, same
  // pattern as the pain-log side-channel below (reportNiggle).
  const overridesRef = useRef<ExerciseOverride[]>(initialOverrides ?? []);
  const [videoSlug, setVideoSlug] = useState<string | null>(null);
  const [work, setWork] = useState<Record<string, WorkSet[]>>(() => {
    // Fresh plan, overlaid with the snapshot where it still matches — sets
    // already logged to the server stay logged. >= not === : a saved array
    // can be longer than freshly built one because the athlete logged one or
    // more extra sets before minimizing (see guided-sets.ts) — those must
    // survive the resume too, not just the prescribed count.
    const base = buildWork(exercises, prefs.kraftWarmupSuggestions);
    if (resume?.work) {
      for (const slug of Object.keys(base)) {
        const saved = resume.work[slug];
        if (saved && saved.length >= base[slug].length) base[slug] = saved;
      }
    }
    return base;
  });
  const [timer, setTimer] = useState<Timer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  // Reaching the end (Finish tapped) asks explicitly rather than completing
  // outright — same reasoning as confirmExit's Discard option, but framed
  // around "you're done" instead of "you're leaving".
  const [finishPrompt, setFinishPrompt] = useState(false);
  // Wall-clock ms when the workout was paused, or null while running.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  // slug → previous performance (null = fetched, nothing on record).
  const [lastPerf, setLastPerf] = useState<Record<string, LastPerf | null>>({});
  const [lastPerfOpen, setLastPerfOpen] = useState(false);
  // Set writes parked by the offline queue — the snapshot stays until they land.
  const [pendingWrites, setPendingWrites] = useState(0);
  // "Adjust load" sheet — which set (by index into the current exercise) it's open for.
  const [adjustOpen, setAdjustOpen] = useState<number | null>(null);
  // Live "new PR" banner (see PrMoment) — set by postSet when the server
  // flags a just-saved set as a new weight or e1rm record.
  const [prMoment, setPrMoment] = useState<PrMomentEvent | null>(null);

  const sessionStartRef = useRef<number>(resume?.startedAt ?? Date.now());
  const prefsRef = useRef(prefs);
  const workRef = useRef(work);
  const timerRef = useRef(timer);
  const exIndexRef = useRef(exIndex);
  const pausedAtRef = useRef(pausedAt);
  const lastBeepRef = useRef<number>(-1);
  const lastPerfFetched = useRef<Set<string>>(new Set());
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  useEffect(() => { workRef.current = work; }, [work]);
  useEffect(() => { timerRef.current = timer; }, [timer]);
  useEffect(() => { exIndexRef.current = exIndex; }, [exIndex]);
  useEffect(() => { pausedAtRef.current = pausedAt; }, [pausedAt]);

  // Keep the queued-writes badge honest: retry on reconnect / foreground and
  // refresh the count whenever the queue drains.
  useEffect(() => {
    function refresh() {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage, client-only
      setPendingWrites(queuedCountFor(session.id));
    }
    function retry() {
      void flushQueue().then(refresh);
    }
    refresh();
    window.addEventListener("online", retry);
    window.addEventListener("kadenz:queue-flushed", refresh);
    document.addEventListener("visibilitychange", retry);
    const interval = setInterval(retry, 30_000);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("kadenz:queue-flushed", refresh);
      document.removeEventListener("visibilitychange", retry);
      clearInterval(interval);
    };
    // session is stable for the lifetime of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Last performance per exercise — fetched lazily, cached for the session ──
  useEffect(() => {
    const ex = exercises[exIndex];
    if (!ex || lastPerfFetched.current.has(ex.slug)) return;
    lastPerfFetched.current.add(ex.slug);
    apiFetch(`/api/strength/history/${ex.slug}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { sessions?: LastPerf[]; familyLast?: LastPerf | null } | null) => {
        const sessions = json?.sessions ?? [];
        const exact = sessions.length > 0 ? sessions[sessions.length - 1] : null;
        // familyLast covers every equipment variant of this movement (see the
        // route) and is always the same session or newer than `exact` — use
        // it so "last done" reflects the movement, not just this exact slug.
        const last = json?.familyLast ?? exact;
        setLastPerf((m) => ({ ...m, [ex.slug]: last }));
      })
      .catch(() => setLastPerf((m) => ({ ...m, [ex.slug]: null })));
    // Re-runs on the current exercise's slug too, so an Exchange re-fetches
    // for the new exercise instead of showing the swapped-out one's history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIndex, exercises[exIndex]?.slug]);

  // ── Resumable snapshot — persist position + logged sets on every change ─────
  useEffect(() => {
    saveGuidedSnapshot({
      v: 1,
      savedAt: Date.now(),
      startedAt: sessionStartRef.current,
      session,
      exercises,
      exIndex,
      work,
    });
    // session is stable for the lifetime of this mount. exercises now can
    // change (Exchange/Remove), so it's a real dependency; pausedAt is
    // included so the shifted start time persists after a resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIndex, work, pausedAt, exercises]);

  // ── Browser back — ask before leaving instead of dropping the workout ───────
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ kadenzGuided: true }, "");
    const onPop = () => {
      // Re-arm the trap and ask; actual leaving goes through onExit.
      window.history.pushState({ kadenzGuided: true }, "");
      setConfirmExit(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Audio helpers ───────────────────────────────────────────────────────────
  function speak(text: string) {
    if (pausedAtRef.current != null) return;
    const p = prefsRef.current;
    if (!p.kraftAudio || !p.kraftVoice) return;
    const vol = CUE_VOLUME_GAIN[p.cueVolume];
    if (vol <= 0) return;
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(text);
        u.volume = vol;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* best-effort */
    }
  }
  function beep(freq = 660, durationMs = 80) {
    if (pausedAtRef.current != null) return;
    if (!prefsRef.current.kraftAudio) return;
    const peak = CUE_VOLUME_GAIN[prefsRef.current.cueVolume];
    if (peak <= 0) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
    } catch {
      /* best-effort */
    }
  }

  // ── Wake Lock — keep the screen on during the session ────────────────────────
  useEffect(() => {
    let released = false;
    async function acquire() {
      if (!prefsRef.current.kraftKeepAwake) return;
      try {
        const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock) wakeRef.current = await nav.wakeLock.request("screen");
      } catch {
        /* Wake Lock is best-effort */
      }
    }
    acquire();
    return () => {
      released = true;
      wakeRef.current?.release().catch(() => {});
      wakeRef.current = null;
      void released;
    };
  }, []);

  // ── The single clock: advance `now`, fire countdown audio, drive transitions ──
  useEffect(() => {
    function tick() {
      // Paused: freeze the displayed clocks and fire no cues or transitions —
      // the anchors are shifted forward on resume instead.
      if (pausedAtRef.current != null) return;
      const t = Date.now();
      setNow(t);
      const tm = timerRef.current;
      if (!tm) return;
      if (tm.kind === "rest" || tm.kind === "getready") {
        const remSec = Math.ceil((tm.endMs - t) / 1000);
        if (remSec <= 5 && remSec >= 1 && remSec !== lastBeepRef.current) {
          lastBeepRef.current = remSec;
          beep(remSec === 1 ? 880 : 660, remSec === 1 ? 150 : 80);
          if (remSec <= 3) speak(String(remSec));
        }
        if (t >= tm.endMs) {
          lastBeepRef.current = -1;
          handleCountdownEnd(tm);
        }
      }
    }
    const iv = setInterval(tick, 250);
    function onVis() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (pausedAtRef.current == null) setNow(Date.now());
        setPrefs(loadSettings());
        // Re-acquire the wake lock (it's dropped when the tab is hidden).
        if (prefsRef.current.kraftKeepAwake && !wakeRef.current) {
          const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
          nav.wakeLock?.request("screen").then((w) => (wakeRef.current = w)).catch(() => {});
        }
      }
    }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Exercise announcements ───────────────────────────────────────────────────
  useEffect(() => {
    const ex = exercises[exIndex];
    if (!ex) return;
    const repPart = ex.repLow === ex.repHigh ? `${ex.repLow}` : `${ex.repLow} to ${ex.repHigh}`;
    const bits = [`${ex.name}.`, `${ex.sets} sets of ${repPart} reps.`];
    const rampCount = (work[ex.slug] ?? []).filter((s) => s.kind === "warmup").length;
    if (rampCount > 0) bits.push(`${rampCount} warm-up set${rampCount > 1 ? "s" : ""} first.`);
    if (ex.perSide) bits.push("Per side.");
    if (ex.suggestedWeightKg != null && ex.suggestedWeightKg > 0) {
      const dbs = ex.dumbbells === 1 ? "one dumbbell" : "two dumbbells";
      bits.push(`${dbs}${ex.holdNote ? `, ${ex.holdNote}` : ""}.`);
    }
    if (ex.tempoNote) bits.push(`${ex.tempoNote}.`);
    speak(bits.join(" "));
    // Re-announce on an Exchange too (the slug at this index changed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIndex, exercises[exIndex]?.slug]);

  // ── Transitions (called from the interval callback — never in an effect body) ─
  function firstUnlogged(slug: string): number {
    const arr = workRef.current[slug] ?? [];
    const i = arr.findIndex((s) => !s.logged);
    return i;
  }

  function beginSet(slug: string, setIndex: number) {
    speak("Go.");
    haptic("warning");
    setTimer({ kind: "set", slug, setIndex, startMs: Date.now() });
  }

  function handleCountdownEnd(tm: Timer) {
    if (tm.kind === "rest") {
      // After rest: optional get-ready lead-in, then start the next set.
      const nextSi = firstUnlogged(tm.slug);
      if (nextSi === -1) {
        // Exercise done — clear the timer; user advances when ready.
        setTimer(null);
        return;
      }
      if (prefsRef.current.kraftGetReady) {
        speak("Get ready.");
        setTimer({ kind: "getready", slug: tm.slug, setIndex: nextSi, endMs: Date.now() + GET_READY_SECONDS * 1000 });
      } else {
        beginSet(tm.slug, nextSi);
      }
    } else if (tm.kind === "getready") {
      beginSet(tm.slug, tm.setIndex);
    }
  }

  function startRest(slug: string, setIndex: number) {
    if (!prefsRef.current.kraftRestTimer) {
      // No rest configured — go straight to the next set (with optional lead-in).
      handleCountdownEnd({ kind: "rest", slug, setIndex, endMs: Date.now(), totalMs: 0 });
      return;
    }
    lastBeepRef.current = -1;
    const secs = exercisesRestSeconds(slug);
    speak(`Rest ${secs} seconds.`);
    setTimer({ kind: "rest", slug, setIndex, endMs: Date.now() + secs * 1000, totalMs: secs * 1000 });
  }

  function exercisesRestSeconds(slug: string): number {
    // The athlete's global rest preference wins so it actually carries over
    // between exercises; the template's per-exercise value is only a fallback.
    const ex = exercises.find((e) => e.slug === slug);
    // Per-exercise rest wins: three UIs let the athlete set it, and the
    // estimator already honours it. The global setting is the fallback for
    // exercises that don't prescribe their own.
    return ex?.restSeconds ?? prefsRef.current.kraftRestSeconds ?? 90;
  }

  // ── Set logging (weight/reps confirmed during rest) ──────────────────────────
  // Logged sets must survive bad gym wifi: the endpoint upserts on
  // (session, exercise, setNumber), so a queued replay is safe, and the
  // workout is never finished while writes are still parked.
  //
  // setNumber below is the raw array position (warm-ups included) — it's
  // only a unique, order-preserving key for the upsert, never what's shown
  // to the athlete. Display always goes through workingSetNumber (see
  // lib/strength/types.ts), which derives the 1/2/3 count from `kind` at
  // read time instead, so it stays correct without needing every already-
  // logged set's setNumber column rewritten.
  function postSet(slug: string, setIndex: number) {
    const set = (workRef.current[slug] ?? [])[setIndex];
    if (!set) return;
    mutateWithQueue(`/api/strength/sessions/${session.id}/sets`, {
      method: "POST",
      body: JSON.stringify({
        exerciseSlug: slug,
        setNumber: setIndex + 1,
        weightKg: set.kg,
        reps: set.reps,
        durationSeconds: set.durationSec || null,
        feel: set.feel ?? null,
        kind: set.kind ?? "working",
      }),
    })
      .then(async (r) => {
        setPendingWrites(queuedCountFor(session.id));
        // Neither sent nor parked — the server refused it outright. Say so;
        // silence here is what lost sets in the first place.
        if (!r.ok && !r.offline) setError("Couldn't save that set. Check your connection.");
        // PR moment: only for a live, online save — a queued write hasn't
        // been compared against history yet (that happens on the server),
        // so there is nothing to celebrate until it actually lands.
        if (r.ok && !r.offline && r.res) {
          try {
            const body = (await r.res.clone().json()) as { pr?: { weight?: boolean; e1rm?: boolean } };
            if (body.pr?.weight || body.pr?.e1rm) {
              const label = body.pr.weight
                ? `New best: ${displayWeight(set.kg ?? 0)} ${weightUnitLabel()}`
                : `New best set: ${set.reps} reps`;
              haptic("success");
              setPrMoment({ label });
            }
          } catch {
            /* response wasn't JSON (e.g. queue shim) — no PR moment, not fatal */
          }
        }
      })
      .catch(() => setPendingWrites(queuedCountFor(session.id)));
  }

  function doneSet() {
    const tm = timerRef.current;
    if (!tm || tm.kind !== "set") return;
    const { slug, setIndex } = tm;
    const durationSec = Math.round((Date.now() - tm.startMs) / 1000);
    haptic("light");
    setWork((w) => {
      const arr = [...(w[slug] ?? [])];
      arr[setIndex] = { ...arr[setIndex], logged: true, durationSec };
      // Carry the weight forward to later, not-yet-logged sets of the SAME
      // kind only — a ramp set's lighter weight must never leak into the
      // working sets that follow it (or vice versa), or the ramp collapses
      // into one flat weight the moment the first set is logged.
      for (let i = setIndex + 1; i < arr.length; i++) {
        if (!arr[i].logged && arr[i].kind === arr[setIndex].kind) {
          arr[i] = { ...arr[i], kg: arr[setIndex].kg };
        }
      }
      return { ...w, [slug]: arr };
    });
    // workRef updates on next render; post from a microtask so it's current.
    queueMicrotask(() => postSet(slug, setIndex));
    startRest(slug, setIndex);
  }

  // Adjust the weight/reps of a specific set (used during rest & before a set).
  function adjustSet(slug: string, setIndex: number, field: "kg" | "reps", d: number) {
    haptic("light");
    setWork((w) => {
      const arr = [...(w[slug] ?? [])];
      const cur = arr[setIndex];
      if (!cur) return w;
      arr[setIndex] =
        field === "kg" ? { ...cur, kg: stepWeight(cur.kg, d > 0 ? 1 : -1) } : { ...cur, reps: Math.max(1, cur.reps + d) };
      // Carrying forward keeps future sets of the SAME kind in step while
      // you tweak — a ramp set's weight must stay isolated from the working
      // sets that follow it (see doneSet for the same rule).
      if (!cur.logged) {
        for (let i = setIndex + 1; i < arr.length; i++) {
          if (!arr[i].logged && field === "kg" && arr[i].kind === cur.kind) {
            arr[i] = { ...arr[i], kg: arr[setIndex].kg };
          }
        }
      }
      return { ...w, [slug]: arr };
    });
    if ((workRef.current[slug] ?? [])[setIndex]?.logged) {
      queueMicrotask(() => postSet(slug, setIndex));
    }
  }

  // Flip a set between warm-up and working — the affordance the suggested
  // ramp (buildWork) only pre-fills. Weight/reps are left as-is: toggling
  // doesn't guess a new number, the athlete already has steppers for that.
  function toggleSetKind(slug: string, setIndex: number) {
    haptic("light");
    setWork((w) => {
      const arr = [...(w[slug] ?? [])];
      const cur = arr[setIndex];
      if (!cur) return w;
      arr[setIndex] = { ...cur, kind: cur.kind === "warmup" ? "working" : "warmup" };
      return { ...w, [slug]: arr };
    });
    if ((workRef.current[slug] ?? [])[setIndex]?.logged) {
      queueMicrotask(() => postSet(slug, setIndex));
    }
  }

  // Log one more set than prescribed. Always appended at the end of the
  // array — see lib/strength/guided-sets.ts for why that's the only safe
  // position (setNumber, the API's upsert key, is the raw array position).
  // Nothing here rewrites `ex.sets`: the prescription is re-derived from the
  // template on every read (session.ts), never persisted per session, so
  // logging a 4th set can't overwrite the fact that 3 were planned — both
  // survive automatically. Becoming unlogged flips `allLogged` back to
  // false, so the existing idle → beginSet → doneSet flow just picks it up.
  function addExtraSet(slug: string) {
    haptic("light");
    const targetEx = exercises.find((e) => e.slug === slug);
    setWork((w) => ({
      ...w,
      [slug]: appendExtraSet(w[slug] ?? [], {
        kg: targetEx?.suggestedWeightKg ?? 0,
        reps: targetEx?.repHigh ?? 0,
      }),
    }));
  }

  // Undo "log one more" — only ever the last set in the array, and only if
  // it's flagged `extra` (see removeLastExtraSet). If it was already posted,
  // it must be deleted server-side too, or it survives as a phantom set on
  // the session summary even though the athlete removed it here.
  function removeLastSet(slug: string) {
    const arr = workRef.current[slug] ?? [];
    const { next, removedIndex, wasLogged } = removeLastExtraSet(arr);
    if (removedIndex == null) return;
    haptic("warning");
    setWork((w) => ({ ...w, [slug]: next }));
    setTimer((t) => (t && t.slug === slug && t.setIndex === removedIndex ? null : t));
    if (wasLogged) {
      const setNumber = removedIndex + 1;
      mutateWithQueue(
        `/api/strength/sessions/${session.id}/sets?exerciseSlug=${encodeURIComponent(slug)}&setNumber=${setNumber}`,
        { method: "DELETE" }
      )
        .then(() => setPendingWrites(queuedCountFor(session.id)))
        .catch(() => setPendingWrites(queuedCountFor(session.id)));
    }
  }

  // "Niggle" is a pain signal, not a load signal: route it to the same
  // pain-log endpoint the post-session pain check-in uses (see
  // src/app/strength/page.tsx logPain), which feeds the Achilles/HSR pain
  // gate (evaluatePainGate) and, per reported complaint, evaluateComplaintPainGates
  // (both in lib/strength/progression.ts) — a score just above its trigger
  // threshold, logged as "during" this set. Best-effort: the reason chip is
  // already saved on the set regardless of this call.
  function reportNiggle(slug: string) {
    const exName = exercises.find((e) => e.slug === slug)?.name ?? "this exercise";
    apiFetch(`/api/strength/sessions/${session.id}/pain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: PAIN_SCORE_THRESHOLD + 1,
        timing: "during",
        note: `Marked "Niggle" during ${exName}.`,
      }),
    }).catch(() => {});
  }

  // Persist an Exchange/Remove decision — best-effort, same pattern as
  // reportNiggle above. Read-side (buildPlannedSession) re-derives the plan
  // from this list on every GET, so a minimize/resume or the detail screen
  // sees the change too.
  function patchOverride(ov: ExerciseOverride) {
    overridesRef.current = [...overridesRef.current, ov];
    apiFetch(`/api/strength/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseOverrides: overridesRef.current }),
    }).catch(() => {});
  }

  // Exchange/Remove only ever act on the CURRENT exercise, and only before
  // any of its sets are logged (see ExerciseActionsSheet's hasLoggedSets —
  // the guard against silently dropping history).
  function exchangeCurrentExercise(replacementSlug: string) {
    const cur = exercises[exIndex];
    const cat = EXERCISE_BY_SLUG[replacementSlug];
    if (!cur || !cat) return;
    haptic("light");
    setExercises((exs) =>
      exs.map((e, i) =>
        i !== exIndex
          ? e
          : {
              ...e,
              slug: cat.slug,
              name: cat.name,
              category: cat.category,
              equipmentNote: cat.equipmentNote,
              tempoNote: cat.tempoNote,
              flatGroundOnly: cat.flatGroundOnly ?? false,
              dumbbells: cat.dumbbells,
              holdNote: cat.holdNote,
              suggestedWeightKg: cat.startWeightKg ?? null,
              lastWeightKg: null,
              lastDate: null,
              painGated: false,
              progression: { action: "same", reason: "Exchanged" },
            }
      )
    );
    setWork((w) => {
      const { [cur.slug]: _dropped, ...rest } = w;
      void _dropped;
      // Same ramp rule as the initial build (see buildWork) — the swap keeps
      // the original slot's priority, so a primary-lift swap still gets a
      // warm-up ramp for the new exercise's own starting weight, unless the
      // athlete has turned suggestions off.
      const ramp = deriveWarmupRampIfEnabled(cur.priority, cat.startWeightKg ?? null, prefsRef.current.kraftWarmupSuggestions);
      const rampSets: WorkSet[] = ramp.map((r) => ({
        kg: r.kg,
        reps: r.reps,
        logged: false,
        durationSec: 0,
        kind: "warmup",
      }));
      const workingSets: WorkSet[] = Array.from({ length: cur.sets }, () => ({
        kg: cat.startWeightKg ?? 0,
        reps: cur.repHigh,
        logged: false,
        durationSec: 0,
        kind: "working",
      }));
      return {
        ...rest,
        [cat.slug]: [...rampSets, ...workingSets],
      };
    });
    lastPerfFetched.current.delete(cat.slug);
    setLastPerf((m) => {
      const { [cur.slug]: _dropped2, ...rest } = m;
      void _dropped2;
      return rest;
    });
    setTimer((t) => (t && t.slug === cur.slug ? null : t));
    setActionsOpen(false);
    patchOverride({ slug: cur.slug, action: "swapped", replacementSlug: cat.slug });
  }

  function removeCurrentExercise() {
    const cur = exercises[exIndex];
    if (!cur) return;
    if (exercises.length <= 1) {
      haptic("warning");
      setError("Add another exercise before removing this one.");
      return;
    }
    haptic("warning");
    setExercises((exs) => exs.filter((e) => e.slug !== cur.slug));
    setWork((w) => {
      const { [cur.slug]: _dropped, ...rest } = w;
      void _dropped;
      return rest;
    });
    setTimer((t) => (t && t.slug === cur.slug ? null : t));
    setExIndex((i) => Math.min(i, exercises.length - 2));
    setActionsOpen(false);
    patchOverride({ slug: cur.slug, action: "removed" });
  }

  // Save a reason chip from the "Adjust load" sheet onto a set. "Too heavy" /
  // "Felt easy" ride along on the set's already-adjusted weightKg — that's
  // what next session's suggested load already reads (see
  // lib/strength/progression.ts suggestProgression), so no separate
  // progression nudge is applied here.
  function saveLoadReason(slug: string, setIndex: number, feel: LoadFeel) {
    haptic("light");
    setWork((w) => {
      const arr = [...(w[slug] ?? [])];
      const cur = arr[setIndex];
      if (!cur) return w;
      arr[setIndex] = { ...cur, feel };
      return { ...w, [slug]: arr };
    });
    queueMicrotask(() => postSet(slug, setIndex));
    if (feel === "niggle") reportNiggle(slug);
  }

  function skipRest() {
    const tm = timerRef.current;
    haptic("light");
    lastBeepRef.current = -1;
    if (tm && (tm.kind === "rest" || tm.kind === "getready")) {
      handleCountdownEnd({ kind: "rest", slug: tm.slug, setIndex: tm.setIndex, endMs: Date.now(), totalMs: 0 });
    }
  }

  function goTo(idx: number) {
    if (idx < 0 || idx >= exercises.length) return;
    haptic("light");
    setExIndex(idx); // NB: does NOT stop the timer — it keeps running in the background.
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      if (dx < 0) goTo(exIndexRef.current + 1);
      else goTo(exIndexRef.current - 1);
    }
  }

  function toggleMute() {
    haptic("light");
    const next = { ...prefsRef.current, kraftAudio: !prefsRef.current.kraftAudio };
    saveSettings(next);
    setPrefs(next);
  }

  // ── Pause / resume — freezes the work timer, rest countdown and cues ─────────
  function togglePause() {
    haptic("light");
    const p = pausedAtRef.current;
    if (p == null) {
      try {
        if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      } catch {
        /* best-effort */
      }
      setPausedAt(Date.now());
    } else {
      // Shift every wall-clock anchor forward by the paused duration so the
      // timers resume exactly where they stopped.
      const dur = Date.now() - p;
      sessionStartRef.current += dur;
      setTimer((tm) =>
        !tm ? tm : tm.kind === "set" ? { ...tm, startMs: tm.startMs + dur } : { ...tm, endMs: tm.endMs + dur }
      );
      setPausedAt(null);
      setNow(Date.now());
    }
  }

  // ── Discard — delete this session's logged sets, back to planned state ───────
  async function discardWorkout() {
    if (discarding) return;
    setDiscarding(true);
    setError(null);
    haptic("warning");
    try {
      // Cancel parked writes FIRST — a queued set replaying after the delete
      // would resurrect the workout the user just threw away.
      dropQueuedFor(session.id);
      const res = await apiFetch(`/api/strength/sessions/${session.id}/sets`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't discard the workout. Try again.");
        setDiscarding(false);
        setConfirmExit(false);
        return;
      }
      clearGuidedSnapshot();
      setConfirmExit(false);
      onDiscard();
    } catch {
      setError("Network error. Couldn't discard the workout.");
      setDiscarding(false);
      setConfirmExit(false);
    }
  }

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    haptic("success");
    const setsLogged = Object.values(work).flat().filter((s) => s.logged).length;
    const totalSets = Object.values(work).flat().length;
    // Sent as a fallback only (a session with zero logged sets has no
    // server-side startedAt/endedAt to derive from). Whenever the session
    // has real logged sets, the PATCH route recomputes and overrides this
    // from strength_sessions.startedAt/endedAt (first/last logged set) —
    // sessionStartRef is a wall-clock ref that doesn't survive a reload, a
    // resume on another device, or storage getting cleared, so it can't be
    // trusted as the source of truth once persisted timestamps exist.
    const durationMinutes = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 60000));
    try {
      const res = await apiFetch(`/api/strength/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", durationMinutes }),
      });
      if (!res.ok) {
        setError("Couldn't save the session. Try again.");
        setFinishing(false);
        return;
      }
      // The server may have overridden durationMinutes with the real
      // startedAt/endedAt gap (see the PATCH route) — read it back so the
      // summary screen shows the same number that got saved, not this
      // wall-clock estimate.
      let savedDurationMinutes = durationMinutes;
      try {
        const updated = (await res.clone().json()) as { durationMinutes?: number | null };
        if (typeof updated.durationMinutes === "number") savedDurationMinutes = updated.durationMinutes;
      } catch {
        /* not JSON — keep the estimate */
      }
      // Only drop the recovery snapshot once every set write has actually
      // reached the server — otherwise a queued set could be lost for good.
      // Scoped to THIS session: an unrelated queued mutation elsewhere in the
      // app must not keep a stale "resume workout" card alive.
      if (queuedCountFor(session.id) === 0) {
        clearGuidedSnapshot();
      } else {
        // Keep it only as insurance for the parked writes, flagged so it is
        // never offered as a resumable workout, and drop it as soon as they land.
        const snap = loadGuidedSnapshot();
        if (snap) saveGuidedSnapshot({ ...snap, finishedAt: Date.now() });
        const sessionId = session.id;
        const clearWhenDrained = () => {
          if (queuedCountFor(sessionId) > 0) return;
          // The snapshot key is global: by the time this fires the user may
          // have started a NEW workout, whose live snapshot must not be wiped.
          const current = loadGuidedSnapshot();
          if (!current || current.session.id === sessionId) clearGuidedSnapshot();
          window.removeEventListener("kadenz:queue-flushed", clearWhenDrained);
        };
        window.addEventListener("kadenz:queue-flushed", clearWhenDrained);
        void flushQueue();
      }
      onFinish({ setsLogged, totalSets, durationMinutes: savedDurationMinutes });
    } catch {
      setError("Network error. Couldn't finish the session.");
      setFinishing(false);
    }
  }

  // ── Derived render state ─────────────────────────────────────────────────────
  const ex = exercises[exIndex];
  if (!ex) return null;
  const arr = work[ex.slug] ?? [];
  const loggedSets = arr.filter((s) => s.logged);
  const nextSi = arr.findIndex((s) => !s.logged);
  const allLogged = nextSi === -1;
  const elapsed = Math.floor((now - sessionStartRef.current) / 1000);

  // Is the running timer for THIS exercise, or another one (background)?
  const t = timer;
  const timerHere = t && t.slug === ex.slug ? t : null;
  const timerElsewhere = t && t.slug !== ex.slug ? t : null;
  const bgExName = timerElsewhere ? exercises.find((e) => e.slug === timerElsewhere.slug)?.name ?? "" : "";

  const restRemain = t && (t.kind === "rest" || t.kind === "getready") ? Math.max(0, Math.ceil((t.endMs - now) / 1000)) : 0;
  const setRunSec = t && t.kind === "set" ? Math.max(0, Math.floor((now - t.startMs) / 1000)) : 0;
  const restPct = timerHere && timerHere.kind === "rest" ? Math.max(0, Math.min(100, ((timerHere.endMs - now) / timerHere.totalMs) * 100)) : 0;

  // The set the weight/reps editor points at (the one just done, or the next up).
  const editIndex = timerHere && (timerHere.kind === "rest" || timerHere.kind === "set") ? timerHere.setIndex : allLogged ? arr.length - 1 : nextSi;
  const editSet = arr[editIndex];
  const isLast = exIndex === exercises.length - 1;
  const paused = pausedAt != null;
  const last = lastPerf[ex.slug];
  const setsLoggedTotal = Object.values(work).flat().filter((s) => s.logged).length;

  // What "Niggle" on THIS exercise actually eases next time, for the
  // AdjustLoadSheet copy (see reportNiggle above + evaluateComplaintPainGates
  // in lib/strength/progression.ts) — null when this exercise isn't any
  // reported complaint's own work, so the sheet falls back to generic wording
  // rather than promising an effect logging pain here won't have.
  const nonAchillesComplaint = complaints
    .filter((c) => c !== "achilles")
    .find((c) => complaintWorkSlugs(c).includes(ex.slug));
  const easesWorkLabel =
    isHsrExercise(ex.slug) && complaints.includes("achilles")
      ? "calf work"
      : nonAchillesComplaint
        ? `${COMPLAINT_SHORT_LABELS[nonAchillesComplaint]} work`
        : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-bg"
      style={{ paddingTop: "max(env(safe-area-inset-top), 8px)", paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Queued set writes — reassure rather than alarm; they replay on reconnect */}
      {pendingWrites > 0 && (
        <div className="mx-4 mb-1 rounded-full bg-elevated px-3 py-1 text-center text-[11px] font-semibold text-text-2">
          Saving {pendingWrites} set{pendingWrites === 1 ? "" : "s"}, will sync when back online
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-0.5">
        <button type="button" onClick={() => { haptic("light"); setConfirmExit(true); }} style={{ touchAction: "manipulation" }} className="text-[15px] font-semibold text-text-2">
          Exit
        </button>
        <div className={`flex items-center gap-2 ${paused ? "opacity-50" : ""}`}>
          <span className={`h-2 w-2 rounded-full bg-danger ${paused ? "" : "animate-pulse"}`} />
          <span className="text-[17px] font-extrabold tabular-nums text-text-1">{fmt(elapsed)}</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={togglePause}
            aria-label={paused ? "Resume workout" : "Pause workout"}
            style={{ touchAction: "manipulation" }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-elevated text-text-1"
          >
            {paused ? <Play className="h-4 w-4" strokeWidth={2.2} /> : <Pause className="h-4 w-4" strokeWidth={2.2} />}
          </button>
          <button type="button" onClick={toggleMute} aria-label={prefs.kraftAudio ? "Mute audio cues" : "Unmute audio cues"} style={{ touchAction: "manipulation" }} className="text-text-2">
            {prefs.kraftAudio ? <Volume2 className="h-5 w-5" strokeWidth={2} /> : <VolumeX className="h-5 w-5" strokeWidth={2} />}
          </button>
        </div>
      </div>

      <p className="px-4 text-center text-[11px] font-medium text-text-3">
        Exercise {exIndex + 1} of {exercises.length}
      </p>

      {/* Background timer running on another exercise */}
      {timerElsewhere && (
        <button
          onClick={() => goTo(exercises.findIndex((e) => e.slug === timerElsewhere.slug))}
          className="mx-4 mt-2 flex items-center justify-center gap-2 rounded-full bg-accent/15 px-3 py-1.5 text-[12px] font-semibold text-accent-fg"
        >
          {timerElsewhere.kind === "set" ? `Set running · ${fmt(setRunSec)}` : `Resting ${fmt(restRemain)}`} · {bgExName} →
        </button>
      )}

      {hasAchillesOrdering(exercises.map((e) => e.slug)) && (
        <div className="mx-4 mt-2 rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2 text-center text-[12px] font-medium text-warn">
          Order locked: explosive work first, slow heavy HSR calf work last.
        </div>
      )}
      <PrMoment event={prMoment} onDone={() => setPrMoment(null)} />
      {error && (
        <div className="mx-4 mt-2 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2 text-center text-[13px] font-medium text-danger">{error}</div>
      )}

      <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-1.5 text-center">
        <h1
          className={`text-[21px] font-extrabold leading-tight tracking-tight text-text-1 transition-opacity ${
            timerHere?.kind === "rest" ? "opacity-50" : ""
          }`}
        >
          {ex.name}
        </h1>
        <p className="mt-0.5 text-[13px] font-semibold text-text-2">
          {allLogged ? "All sets done" : `Set ${nextSi + 1} of ${arr.length}`} · target {ex.repLow === ex.repHigh ? ex.repLow : `${ex.repLow}–${ex.repHigh}`} reps{ex.perSide ? " / side" : ""}
          {ex.suggestedWeightKg != null && ex.suggestedWeightKg > 0 && (
            <span className="text-accent-fg"> · {formatLoad(ex.suggestedWeightKg, { dumbbells: ex.dumbbells, holdNote: ex.holdNote, perSide: ex.perSide })}</span>
          )}
        </p>
        {(ex.flatGroundOnly || ex.painGated) && (
          <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
            {ex.flatGroundOnly && <span className="rounded-md bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">⚠ Flat ground only</span>}
            {ex.painGated && <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger">Eased (pain gate)</span>}
          </div>
        )}

        {/* Swap + remove, 44×44 tap targets (sweaty-hands sizing) — only
            while this exercise has nothing logged yet (see hasLoggedSets on
            ExerciseActionsSheet and removeCurrentExercise's guard). */}
        {loggedSets.length === 0 && !EXERCISE_BY_SLUG[ex.slug]?.achillesRole && (
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => { haptic("light"); setActionsOpen(true); }}
              aria-label={`Exchange ${ex.name}`}
              style={{ touchAction: "manipulation" }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-2"
            >
              <Repeat className="h-4 w-4" strokeWidth={2.2} />
            </button>
            <button
              type="button"
              onClick={removeCurrentExercise}
              aria-label={`Remove ${ex.name}`}
              style={{ touchAction: "manipulation" }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-elevated text-text-2"
            >
              <X className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>
        )}

        {/* Video demo + last-time performance, side by side — both are
            reference info the athlete checks once and moves on from, so they
            share one row instead of stacking (mid-set the controls below
            matter more than either). */}
        {(getVideoId(ex.slug) || (last && last.sets.length > 0)) && (
          <div className="mt-1.5 flex items-center justify-center gap-1.5">
            {getVideoId(ex.slug) && (
              <button
                type="button"
                onClick={() => { haptic("light"); setVideoSlug(ex.slug); }}
                style={{ touchAction: "manipulation" }}
                className="press rounded-md bg-elevated px-2 py-1 text-[11px] font-bold text-accent-fg"
              >
                ▶ Watch demo
              </button>
            )}
            {last && last.sets.length > 0 && (
              <button
                type="button"
                onClick={() => { haptic("light"); setLastPerfOpen(true); }}
                style={{ touchAction: "manipulation" }}
                className="press flex items-center gap-1.5 rounded-full bg-[#2563EB]/12 px-3 py-1 text-[12px] font-bold text-[#2563EB]"
              >
                <History className="h-3.5 w-3.5" strokeWidth={2.2} />
                Last sets · {formatRecency(last.date)}
              </button>
            )}
          </div>
        )}

        {/* Preceding sets (weight · reps · time) */}
        {loggedSets.length > 0 && (
          <div className="mt-2 w-full max-w-xs k-card p-2">
            {arr.map((s, i) =>
              s.logged ? (
                <div key={i} className="flex items-center gap-2 px-2 py-1 text-[13px]">
                  <SetTag kind={s.kind} number={workingSetNumber(arr, i)} />
                  <span className="ml-auto tabular-nums text-text-1">
                    <b>{displayWeight(s.kg)}</b> {weightUnitLabel()} × <b>{s.reps}</b>
                  </span>
                  <span className="tabular-nums text-text-3">{fmt(s.durationSec)}</span>
                  <Check className="h-3.5 w-3.5" style={{ color: "#4ADE80" }} strokeWidth={3} />
                </div>
              ) : null
            )}
          </div>
        )}

        {/* ── Main interaction, by timer phase ── */}
        <div className="mt-3 w-full max-w-xs">
          {timerHere?.kind === "getready" ? (
            <div className="flex flex-col items-center">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">Get ready</p>
              <div className="mt-1 text-[56px] font-extrabold leading-none tabular-nums text-accent-fg">{restRemain}</div>
              <p className="mt-1 text-[13px] text-text-3">Set {timerHere.setIndex + 1} starting…</p>
            </div>
          ) : timerHere?.kind === "rest" ? (
            <div className="flex flex-col items-center">
              {/* Ring fill is driven by restPct (real countdown state), not a
                  CSS animation — legible with motion off, no reduced-motion
                  gating needed (see docs/MOTION.md). */}
              <div className="relative flex items-center justify-center" style={{ height: REST_RING_D, width: REST_RING_D }}>
                <svg width={REST_RING_D} height={REST_RING_D} viewBox={`0 0 ${REST_RING_D} ${REST_RING_D}`} className="absolute inset-0 -rotate-90">
                  <circle cx={REST_RING_D / 2} cy={REST_RING_D / 2} r={REST_RING_R} fill="none" stroke="var(--k-hairline)" strokeWidth="10" />
                  <circle
                    cx={REST_RING_D / 2}
                    cy={REST_RING_D / 2}
                    r={REST_RING_R}
                    fill="none"
                    stroke="var(--k-accent)"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={REST_RING_C}
                    strokeDashoffset={REST_RING_C * (1 - restPct / 100)}
                  />
                </svg>
                <div className="text-center">
                  <div className="font-display text-[44px] leading-none text-text-1">{fmt(restRemain)}</div>
                  <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-text-3">
                    of {fmt(Math.round(timerHere.totalMs / 1000))} prescribed
                  </div>
                </div>
              </div>
              {editSet && (
                <WeightReps
                  set={editSet}
                  perSide={ex.perSide}
                  dumbbells={ex.dumbbells}
                  number={workingSetNumber(arr, editIndex)}
                  onAdjust={(f, d) => adjustSet(ex.slug, editIndex, f, d)}
                  onOpenAdjust={() => { haptic("light"); setAdjustOpen(editIndex); }}
                  onToggleKind={() => toggleSetKind(ex.slug, editIndex)}
                  compact
                />
              )}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Button variant="secondary" size="md" full onClick={() => { adjustRest(-15); }}>−15s</Button>
                <Button variant="secondary" size="md" full onClick={() => { adjustRest(15); }}>+15s</Button>
              </div>
              <div className="mt-1.5">
                <Button variant="ghost" size="md" full onClick={skipRest}>Skip rest →</Button>
              </div>
            </div>
          ) : timerHere?.kind === "set" ? (
            <div className="flex flex-col items-center">
              {prefs.kraftSetTimer && (
                <>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-text-3">Set {timerHere.setIndex + 1} · time</p>
                  <div className="font-display text-[44px] leading-none tabular-nums text-text-1">{fmt(setRunSec)}</div>
                </>
              )}
              {editSet && (
                <WeightReps
                  set={editSet}
                  perSide={ex.perSide}
                  dumbbells={ex.dumbbells}
                  number={workingSetNumber(arr, timerHere.setIndex)}
                  onAdjust={(f, d) => adjustSet(ex.slug, timerHere.setIndex, f, d)}
                  onOpenAdjust={() => { haptic("light"); setAdjustOpen(timerHere.setIndex); }}
                  onToggleKind={() => toggleSetKind(ex.slug, timerHere.setIndex)}
                  compact
                />
              )}
              <div className="mt-3">
                <Button variant="primary" size="lg" full onClick={doneSet}>Done, set {timerHere.setIndex + 1}</Button>
              </div>
            </div>
          ) : allLogged ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[15px] font-semibold text-text-2">Exercise complete 💪</p>
              <Button variant="secondary" size="md" full onClick={() => addExtraSet(ex.slug)}>
                + Log one more set
              </Button>
              {arr[arr.length - 1]?.extra && (
                <Button variant="ghost" size="md" full onClick={() => removeLastSet(ex.slug)}>
                  Remove last set
                </Button>
              )}
              {!isLast && <Button variant="secondary" size="md" full onClick={() => goTo(exIndex + 1)}>Next exercise →</Button>}
            </div>
          ) : (
            // Idle — ready to start the next set. No separate "suggested
            // weight" caption here: it's already shown in the accent-coloured
            // subtitle above, and the "Last sets" pill covers the history —
            // repeating both cost a line this screen doesn't have to spare.
            <div className="flex flex-col items-center">
              {editSet && (
                <WeightReps
                  set={editSet}
                  perSide={ex.perSide}
                  dumbbells={ex.dumbbells}
                  number={workingSetNumber(arr, nextSi)}
                  onAdjust={(f, d) => adjustSet(ex.slug, nextSi, f, d)}
                  onOpenAdjust={() => { haptic("light"); setAdjustOpen(nextSi); }}
                  onToggleKind={() => toggleSetKind(ex.slug, nextSi)}
                  compact
                />
              )}
              <div className="mt-3">
                <Button variant="primary" size="lg" full onClick={() => beginSet(ex.slug, nextSi)}>Start set {nextSi + 1}</Button>
              </div>
              {arr[nextSi]?.extra && (
                <div className="mt-1.5">
                  <Button variant="ghost" size="md" full onClick={() => removeLastSet(ex.slug)}>
                    Remove this set
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer: dot nav + prev/next/finish. No swipe hint here — the dots
          plus Prev/Next already say "there's more than one exercise", and
          this footer is exactly what has to stay reachable without
          scrolling (see the no-scroll requirement above). */}
      <div className="px-4 pb-1.5">
        <div className="mb-2 flex justify-center gap-1.5">
          {exercises.map((e, i) => {
            const done = (work[e.slug] ?? []).every((s) => s.logged) && (work[e.slug] ?? []).length > 0;
            return (
              <button
                key={e.slug}
                type="button"
                aria-label={`Go to ${e.name}`}
                onClick={() => goTo(i)}
                style={{ touchAction: "manipulation" }}
                className={`h-1.5 rounded-full transition-all ${i === exIndex ? "w-5 bg-accent" : done ? "w-1.5 bg-accent/50" : "w-1.5 bg-text-3/40"}`}
              />
            );
          })}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => goTo(exIndex - 1)} disabled={exIndex === 0} full>Prev</Button>
          {isLast ? (
            <Button variant="primary" onClick={() => { haptic("light"); setFinishPrompt(true); }} full>Finish</Button>
          ) : (
            <Button variant="secondary" onClick={() => goTo(exIndex + 1)} full>Next</Button>
          )}
        </div>
      </div>

      {/* Paused overlay — unmistakable, tap anywhere (or Resume) to continue */}
      {paused && (
        <div
          className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-bg/85 backdrop-blur-sm"
          onClick={togglePause}
          role="button"
          aria-label="Resume workout"
        >
          <Pause className="h-10 w-10 text-text-2" strokeWidth={2} />
          <p className="text-[28px] font-extrabold tracking-tight text-text-1">Paused</p>
          <p className="text-[15px] tabular-nums text-text-3">{fmt(elapsed)} elapsed</p>
          <Button variant="primary" size="lg" onClick={togglePause}>
            <Play className="h-4 w-4" strokeWidth={2.2} />
            Resume
          </Button>
        </div>
      )}

      <VideoSheet
        slug={videoSlug}
        title={videoSlug ? exercises.find((e) => e.slug === videoSlug)?.name : undefined}
        onClose={() => setVideoSlug(null)}
      />

      {/* Last-performance popup */}
      <Sheet open={lastPerfOpen} onClose={() => setLastPerfOpen(false)} title="Last time">
        {(() => {
          const ex = exercises[exIndex];
          const lp = ex ? lastPerf[ex.slug] : null;
          if (!ex || !lp) return null;
          // A family match from a different exact exercise (e.g. today's
          // dumbbell squat vs a barbell squat two sessions ago) — say what
          // was actually done, not the current exercise's name, so a
          // different-equipment weight is never read as this exercise's own.
          const isVariant = lp.exerciseSlug != null && lp.exerciseSlug !== ex.slug;
          return (
            <div className="flex flex-col gap-3 pb-2">
              <div>
                <p className="text-[15px] font-bold text-text-1">{isVariant ? lp.exerciseName : ex.name}</p>
                {isVariant && <p className="text-[12px] text-text-3">Different equipment than today</p>}
                <p className="mt-0.5 text-[12px] text-text-3">
                  {new Date(lp.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
                  {" · "}{formatRecency(lp.date)}
                </p>
              </div>
              <div className="rounded-[var(--radius-input)] bg-elevated p-2">
                {lp.sets.map((st, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1.5 text-[14px]">
                    <span className="font-semibold text-text-3">
                      {st.kind === "warmup" ? "WU" : `Set ${workingSetNumber(lp.sets, i)}`}
                    </span>
                    <span className="tabular-nums font-semibold text-text-1">
                      {st.weightKg != null && st.weightKg > 0
                        ? `${displayWeight(st.weightKg)} ${weightUnitLabel()} × ${st.reps ?? "—"}`
                        : `${st.reps ?? "—"} reps`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </Sheet>

      <AdjustLoadSheet
        open={adjustOpen != null}
        onClose={() => setAdjustOpen(null)}
        weightKg={adjustOpen != null ? arr[adjustOpen]?.kg ?? 0 : 0}
        previousWeightKg={ex.suggestedWeightKg ?? null}
        dumbbells={ex.dumbbells}
        easesWorkLabel={easesWorkLabel}
        selected={adjustOpen != null ? arr[adjustOpen]?.feel ?? null : null}
        onSave={(feel) => {
          if (adjustOpen != null) saveLoadReason(ex.slug, adjustOpen, feel);
          setAdjustOpen(null);
        }}
      />

      <ExerciseActionsSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        exercise={ex}
        otherSlugsInSession={exercises.filter((e) => e.slug !== ex.slug).map((e) => e.slug)}
        equipment={equipment}
        hasLoggedSets={loggedSets.length > 0}
        onExchange={exchangeCurrentExercise}
      />

      <Sheet open={finishPrompt} onClose={() => setFinishPrompt(false)} title="Finish workout?">
        <div className="flex flex-col gap-3 px-4 pb-6">
          <p className="text-[14px] text-text-2">
            {setsLoggedTotal > 0
              ? `${setsLoggedTotal} set${setsLoggedTotal === 1 ? "" : "s"} logged. Complete saves them; discard deletes them and can't be undone.`
              : "Nothing logged this session."}
          </p>
          <Button
            variant="primary"
            size="lg"
            full
            busy={finishing}
            onClick={() => { setFinishPrompt(false); finish(); }}
          >
            Complete workout
          </Button>
          <Button variant="secondary" size="lg" full onClick={() => setFinishPrompt(false)}>
            Keep going
          </Button>
          <Button variant="danger" size="lg" full busy={discarding} onClick={() => { setFinishPrompt(false); discardWorkout(); }}>
            Discard workout
          </Button>
        </div>
      </Sheet>

      <Sheet open={confirmExit} onClose={() => setConfirmExit(false)} title="Leave workout?">
        <div className="flex flex-col gap-3 px-4 pb-6">
          <p className="text-[14px] text-text-2">
            {setsLoggedTotal > 0
              ? `${setsLoggedTotal} set${setsLoggedTotal === 1 ? "" : "s"} logged so far.`
              : "Nothing logged yet."}
          </p>
          <Button variant="primary" size="lg" full onClick={() => { haptic("light"); setConfirmExit(false); }}>
            Keep going
          </Button>
          <Button
            variant="secondary"
            size="lg"
            full
            onClick={() => {
              haptic("light");
              setConfirmExit(false);
              onExit(Object.values(workRef.current).flat().filter((s) => s.logged).length);
            }}
          >
            Minimize, resume later
          </Button>
          <Button variant="secondary" size="lg" full busy={finishing} onClick={() => { setConfirmExit(false); finish(); }}>
            Save &amp; end workout
          </Button>
          <Button variant="danger" size="lg" full busy={discarding} onClick={discardWorkout}>
            Discard workout
          </Button>
        </div>
      </Sheet>
    </div>
  );

  function adjustRest(delta: number) {
    haptic("light");
    setTimer((tm) => {
      if (!tm || tm.kind !== "rest") return tm;
      const endMs = Math.max(Date.now() + 1000, tm.endMs + delta * 1000);
      return { ...tm, endMs, totalMs: Math.max(tm.totalMs, endMs - Date.now()) };
    });
  }
}

// One line of previous sets, e.g. "12 kg × 10 · 12 kg × 9 · 10.5 kg × 8".

// ── Weight / reps stepper block ───────────────────────────────────────────────
const FEEL_LABEL: Record<string, string> = {
  too_heavy: "Too heavy",
  easy: "Felt easy",
  niggle: "Niggle",
};

function WeightReps({
  set,
  perSide,
  dumbbells,
  number,
  onAdjust,
  onOpenAdjust,
  onToggleKind,
  compact,
}: {
  set: WorkSet;
  perSide: boolean;
  dumbbells?: 1 | 2;
  /** Working-set number (see workingSetNumber) — only meaningful when
   *  set.kind !== "warmup"; SetTag ignores it otherwise. */
  number?: number;
  onAdjust: (field: "kg" | "reps", d: number) => void;
  onOpenAdjust?: () => void;
  /** Flip this set between warm-up and working (see toggleSetKind). */
  onToggleKind?: () => void;
  /** Tighter surrounding margin for the guided-session no-scroll layout —
   *  the steppers themselves stay 44×44 (sweaty-hands sizing is non-negotiable
   *  even when the layout is under pressure). */
  compact?: boolean;
}) {
  const isWarmup = set.kind === "warmup";
  return (
    <div className="flex flex-col items-center">
      {onToggleKind && (
        <div className="flex items-center gap-1.5">
          <SetTag kind={set.kind} number={number ?? 1} onToggle={onToggleKind} />
          <span className="text-[11px] font-semibold text-text-3">
            {isWarmup ? "Warm-up · tap to make working" : "Working set · tap to make warm-up"}
          </span>
        </div>
      )}
      <div className={`${compact ? "mt-2.5" : "mt-4"} flex items-center justify-center gap-4`}>
        <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated p-1">
          <StepperButton onClick={() => onAdjust("kg", -1)} ariaLabel="Decrease weight"><Minus className="h-5 w-5" strokeWidth={2.5} /></StepperButton>
          <span className="w-[72px] text-center leading-none">
            <b className={`font-display text-[32px] tabular-nums ${isWarmup ? "text-text-3" : "text-text-1"}`}>{displayWeight(set.kg)}</b>
            <span className="block text-[10px] uppercase tracking-wide text-text-3">{loadUnitLabel(dumbbells)}{perSide ? " · side" : ""}</span>
          </span>
          <StepperButton onClick={() => onAdjust("kg", 1)} ariaLabel="Increase weight"><Plus className="h-5 w-5" strokeWidth={2.5} /></StepperButton>
        </div>
        <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated p-1">
          <StepperButton onClick={() => onAdjust("reps", -1)} ariaLabel="Decrease reps"><Minus className="h-5 w-5" strokeWidth={2.5} /></StepperButton>
          <span className="w-16 text-center leading-none">
            <b className={`font-display text-[32px] tabular-nums ${isWarmup ? "text-text-3" : "text-text-1"}`}>{set.reps}</b>
            <span className="block text-[10px] uppercase tracking-wide text-text-3">reps</span>
          </span>
          <StepperButton onClick={() => onAdjust("reps", 1)} ariaLabel="Increase reps"><Plus className="h-5 w-5" strokeWidth={2.5} /></StepperButton>
        </div>
      </div>
      {onOpenAdjust && (
        <button
          type="button"
          onClick={onOpenAdjust}
          style={{ touchAction: "manipulation" }}
          className="press mt-2 text-[12px] font-bold text-accent-fg"
        >
          {set.feel ? `Load reason: ${FEEL_LABEL[set.feel]} · Change` : "Adjust load"}
        </button>
      )}
    </div>
  );
}
