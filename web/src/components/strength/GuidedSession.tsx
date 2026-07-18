"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Minus, Plus, Volume2, VolumeX, Check, Pause, Play, History } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { haptic } from "@/lib/haptics";
import { formatRecency } from "@/lib/recency";
import {
  clearGuidedSnapshot,
  saveGuidedSnapshot,
  type GuidedWorkSet,
} from "@/lib/strength/guided-snapshot";
import { VideoSheet } from "@/components/strength/VideoSheet";
import { getVideoId } from "@/lib/strength/videos";
import { displayWeight, weightUnitLabel } from "@/lib/units";
import { apiFetch } from "@/lib/api";
import { CUE_VOLUME_GAIN, loadSettings, saveSettings, type UserSettings } from "@/lib/settings";
import { formatLoad, loadUnitLabel, stepWeight } from "@/lib/strength/weights";

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

// ── Audio (Web Speech + a tiny Web Audio beep), both best-effort ──────────────
// iOS gates both behind a user gesture, so `unlockGuidedAudio` must be called
// synchronously from the Start button's onClick before this component mounts.

let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AC();
    } catch {
      return null;
    }
  }
  return sharedAudioCtx;
}

export function unlockGuidedAudio() {
  const s = loadSettings();
  try {
    if (s.kraftAudio && s.kraftVoice && CUE_VOLUME_GAIN[s.cueVolume] > 0 && typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance("Let's go");
      u.volume = CUE_VOLUME_GAIN[s.cueVolume];
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* best-effort */
  }
  try {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume();
  } catch {
    /* best-effort */
  }
}

function Stepper({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      style={{ touchAction: "manipulation" }}
      className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-input)] bg-elevated text-text-1"
    >
      {children}
    </motion.button>
  );
}

function buildWork(exercises: PlannedExercise[]): Record<string, WorkSet[]> {
  const w: Record<string, WorkSet[]> = {};
  for (const ex of exercises) {
    w[ex.slug] = Array.from({ length: ex.sets }, () => ({
      kg: ex.suggestedWeightKg ?? 0,
      reps: ex.repHigh,
      logged: false,
      durationSec: 0,
    }));
  }
  return w;
}

// Previous performance of one exercise (dated per-set detail from history).
interface LastPerf {
  date: string;
  sets: Array<{ setNumber: number; weightKg: number | null; reps: number | null }>;
}

export default function GuidedSession({ session, exercises, resume, onExit, onDiscard, onFinish }: Props) {
  const [prefs, setPrefs] = useState<UserSettings>(() => loadSettings());
  const [now, setNow] = useState<number>(() => Date.now());
  const [exIndex, setExIndex] = useState(() =>
    resume ? Math.min(Math.max(resume.exIndex, 0), exercises.length - 1) : 0
  );
  const [videoSlug, setVideoSlug] = useState<string | null>(null);
  const [work, setWork] = useState<Record<string, WorkSet[]>>(() => {
    // Fresh plan, overlaid with the snapshot where it still matches — sets
    // already logged to the server stay logged.
    const base = buildWork(exercises);
    if (resume?.work) {
      for (const slug of Object.keys(base)) {
        const saved = resume.work[slug];
        if (saved && saved.length === base[slug].length) base[slug] = saved;
      }
    }
    return base;
  });
  const [timer, setTimer] = useState<Timer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  // Wall-clock ms when the workout was paused, or null while running.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  // slug → previous performance (null = fetched, nothing on record).
  const [lastPerf, setLastPerf] = useState<Record<string, LastPerf | null>>({});
  const [lastPerfOpen, setLastPerfOpen] = useState(false);

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

  // ── Last performance per exercise — fetched lazily, cached for the session ──
  useEffect(() => {
    const ex = exercises[exIndex];
    if (!ex || lastPerfFetched.current.has(ex.slug)) return;
    lastPerfFetched.current.add(ex.slug);
    apiFetch(`/api/strength/history/${ex.slug}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { sessions?: LastPerf[] } | null) => {
        const sessions = json?.sessions ?? [];
        const last = sessions.length > 0 ? sessions[sessions.length - 1] : null;
        setLastPerf((m) => ({ ...m, [ex.slug]: last }));
      })
      .catch(() => setLastPerf((m) => ({ ...m, [ex.slug]: null })));
    // exercises are stable for the lifetime of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIndex]);

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
    // session/exercises are stable for the lifetime of this mount. pausedAt is
    // included so the shifted start time persists after a resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIndex, work, pausedAt]);

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
    if (ex.perSide) bits.push("Per side.");
    if (ex.suggestedWeightKg != null && ex.suggestedWeightKg > 0) {
      const dbs = ex.dumbbells === 1 ? "one dumbbell" : "two dumbbells";
      bits.push(`${dbs}${ex.holdNote ? `, ${ex.holdNote}` : ""}.`);
    }
    if (ex.tempoNote) bits.push(`${ex.tempoNote}.`);
    speak(bits.join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIndex]);

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
    return prefsRef.current.kraftRestSeconds ?? ex?.restSeconds ?? 90;
  }

  // ── Set logging (weight/reps confirmed during rest) ──────────────────────────
  function postSet(slug: string, setIndex: number) {
    const set = (workRef.current[slug] ?? [])[setIndex];
    if (!set) return;
    apiFetch(`/api/strength/sessions/${session.id}/sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exerciseSlug: slug,
        setNumber: setIndex + 1,
        weightKg: set.kg,
        reps: set.reps,
        durationSeconds: set.durationSec || null,
      }),
    }).catch(() => {});
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
      // Carry the working weight forward to later, not-yet-logged sets.
      for (let i = setIndex + 1; i < arr.length; i++) {
        if (!arr[i].logged) arr[i] = { ...arr[i], kg: arr[setIndex].kg };
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
      // Carrying forward keeps future sets in step while you tweak.
      if (!cur.logged) {
        for (let i = setIndex + 1; i < arr.length; i++) {
          if (!arr[i].logged && field === "kg") arr[i] = { ...arr[i], kg: arr[setIndex].kg };
        }
      }
      return { ...w, [slug]: arr };
    });
    if ((workRef.current[slug] ?? [])[setIndex]?.logged) {
      queueMicrotask(() => postSet(slug, setIndex));
    }
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
      setError("Network error — couldn't discard the workout.");
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
      clearGuidedSnapshot();
      onFinish({ setsLogged, totalSets, durationMinutes });
    } catch {
      setError("Network error — couldn't finish the session.");
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

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-bg"
      style={{ paddingTop: "max(env(safe-area-inset-top), 8px)", paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-1">
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

      <p className="px-4 text-center text-[13px] font-medium text-text-3">
        Exercise {exIndex + 1} of {exercises.length}
      </p>

      {/* Background timer running on another exercise */}
      {timerElsewhere && (
        <button
          onClick={() => goTo(exercises.findIndex((e) => e.slug === timerElsewhere.slug))}
          className="mx-4 mt-2 flex items-center justify-center gap-2 rounded-full bg-accent/15 px-3 py-1.5 text-[12px] font-semibold text-accent"
        >
          {timerElsewhere.kind === "set" ? `Set running · ${fmt(setRunSec)}` : `Resting ${fmt(restRemain)}`} · {bgExName} →
        </button>
      )}

      {session.type === "lower_achilles" && (
        <div className="mx-4 mt-2 rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2 text-center text-[12px] font-medium text-warn">
          Order locked: explosive work first, slow heavy HSR calf work last.
        </div>
      )}
      {error && (
        <div className="mx-4 mt-2 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2 text-center text-[13px] font-medium text-danger">{error}</div>
      )}

      <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 py-3 text-center">
        <h1 className="text-[24px] font-extrabold leading-tight tracking-tight text-text-1">{ex.name}</h1>
        <p className="mt-1 text-[14px] font-semibold text-text-2">
          {allLogged ? "All sets done" : `Set ${nextSi + 1} of ${ex.sets}`} · target {ex.repLow === ex.repHigh ? ex.repLow : `${ex.repLow}–${ex.repHigh}`} reps{ex.perSide ? " / side" : ""}
        </p>
        {ex.suggestedWeightKg != null && ex.suggestedWeightKg > 0 && (
          <p className="mt-1 text-[13px] font-semibold text-accent">
            {formatLoad(ex.suggestedWeightKg, { dumbbells: ex.dumbbells, holdNote: ex.holdNote, perSide: ex.perSide })}
          </p>
        )}
        {ex.tempoNote && <p className="mt-0.5 text-[12px] text-text-3">{ex.tempoNote}</p>}
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {ex.flatGroundOnly && <span className="rounded-md bg-warn/15 px-2 py-0.5 text-[11px] font-bold text-warn">⚠ Flat ground only</span>}
          {ex.painGated && <span className="rounded-md bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger">Eased — pain gate</span>}
          {getVideoId(ex.slug) && (
            <button
              type="button"
              onClick={() => { haptic("light"); setVideoSlug(ex.slug); }}
              style={{ touchAction: "manipulation" }}
              className="press rounded-md bg-elevated px-2 py-0.5 text-[11px] font-bold text-accent"
            >
              ▶ Watch demo
            </button>
          )}
        </div>

        {/* Previous performance of THIS exercise — prominent button + popup */}
        {last && last.sets.length > 0 && (
          <button
            type="button"
            onClick={() => { haptic("light"); setLastPerfOpen(true); }}
            style={{ touchAction: "manipulation", backgroundImage: "linear-gradient(135deg, #60A5FA 0%, #2563EB 100%)" }}
            className="press mt-3 flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold text-white shadow-[0_3px_10px_rgba(37,99,235,0.35)]"
          >
            <History className="h-4 w-4" strokeWidth={2.2} />
            Last sets · {formatRecency(last.date)}
          </button>
        )}

        {/* Preceding sets (weight · reps · time) */}
        {loggedSets.length > 0 && (
          <div className="mt-3 w-full max-w-xs k-card p-2">
            {arr.map((s, i) =>
              s.logged ? (
                <div key={i} className="flex items-center justify-between px-2 py-1 text-[13px]">
                  <span className="font-semibold text-text-3">Set {i + 1}</span>
                  <span className="tabular-nums text-text-1">
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
        <div className="mt-5 w-full max-w-xs">
          {timerHere?.kind === "getready" ? (
            <div className="flex flex-col items-center">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">Get ready</p>
              <div className="mt-1 text-[64px] font-extrabold leading-none tabular-nums text-accent">{restRemain}</div>
              <p className="mt-1 text-[13px] text-text-3">Set {timerHere.setIndex + 1} starting…</p>
            </div>
          ) : timerHere?.kind === "rest" ? (
            <div className="flex flex-col items-center">
              <div className="text-[44px] font-extrabold tabular-nums text-accent">{fmt(restRemain)}</div>
              <p className="mt-1 text-[13px] text-text-3">Rest — log your set below</p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-accent" style={{ width: `${restPct}%` }} />
              </div>
              {editSet && <WeightReps set={editSet} perSide={ex.perSide} dumbbells={ex.dumbbells} onAdjust={(f, d) => adjustSet(ex.slug, editIndex, f, d)} />}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Button variant="secondary" size="md" full onClick={() => { adjustRest(-15); }}>−15s</Button>
                <Button variant="secondary" size="md" full onClick={() => { adjustRest(15); }}>+15s</Button>
              </div>
              <div className="mt-2">
                <Button variant="ghost" size="md" full onClick={skipRest}>Skip rest →</Button>
              </div>
            </div>
          ) : timerHere?.kind === "set" ? (
            <div className="flex flex-col items-center">
              {prefs.kraftSetTimer && (
                <>
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">Set {timerHere.setIndex + 1} · time</p>
                  <div className="text-[52px] font-extrabold leading-none tabular-nums text-text-1">{fmt(setRunSec)}</div>
                </>
              )}
              {editSet && <WeightReps set={editSet} perSide={ex.perSide} dumbbells={ex.dumbbells} onAdjust={(f, d) => adjustSet(ex.slug, timerHere.setIndex, f, d)} />}
              <div className="mt-5">
                <Button variant="primary" size="lg" full onClick={doneSet}>Done — set {timerHere.setIndex + 1}</Button>
              </div>
            </div>
          ) : allLogged ? (
            <div className="flex flex-col items-center gap-3">
              <p className="text-[15px] font-semibold text-text-2">Exercise complete 💪</p>
              {!isLast && <Button variant="secondary" size="md" full onClick={() => goTo(exIndex + 1)}>Next exercise →</Button>}
            </div>
          ) : (
            // Idle — ready to start the next set
            <div className="flex flex-col items-center">
              {editSet && <WeightReps set={editSet} perSide={ex.perSide} dumbbells={ex.dumbbells} onAdjust={(f, d) => adjustSet(ex.slug, nextSi, f, d)} />}
              <div className="mt-5">
                <Button variant="primary" size="lg" full onClick={() => beginSet(ex.slug, nextSi)}>Start set {nextSi + 1}</Button>
              </div>
              {ex.suggestedWeightKg != null && loggedSets.length === 0 && (
                <p className="mt-2 text-[12px] text-text-3">
                  Suggested {formatLoad(ex.suggestedWeightKg, { dumbbells: ex.dumbbells, holdNote: ex.holdNote, perSide: ex.perSide })} — carries from last time
                  {ex.lastDate ? ` · ${formatRecency(ex.lastDate)}` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer: dot nav + prev/next/finish */}
      <div className="px-4 pb-2">
        <div className="mb-3 flex justify-center gap-1.5">
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
            <Button variant="primary" onClick={finish} busy={finishing} full>Finish</Button>
          ) : (
            <Button variant="secondary" onClick={() => goTo(exIndex + 1)} full>Next</Button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-text-3">Swipe left/right to move between exercises</p>
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
          return (
            <div className="flex flex-col gap-3 pb-2">
              <div>
                <p className="text-[15px] font-bold text-text-1">{ex.name}</p>
                <p className="mt-0.5 text-[12px] text-text-3">
                  {new Date(lp.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" })}
                  {" · "}{formatRecency(lp.date)}
                </p>
              </div>
              <div className="rounded-[var(--radius-input)] bg-elevated p-2">
                {lp.sets.map((st, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1.5 text-[14px]">
                    <span className="font-semibold text-text-3">Set {st.setNumber ?? i + 1}</span>
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
            Minimize — resume later
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
function WeightReps({
  set,
  perSide,
  dumbbells,
  onAdjust,
}: {
  set: WorkSet;
  perSide: boolean;
  dumbbells?: 1 | 2;
  onAdjust: (field: "kg" | "reps", d: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-center gap-4">
      <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated p-1">
        <Stepper onClick={() => onAdjust("kg", -1)}><Minus className="h-5 w-5" strokeWidth={2.5} /></Stepper>
        <span className="w-16 text-center leading-none">
          <b className="text-[24px] font-extrabold tabular-nums text-text-1">{displayWeight(set.kg)}</b>
          <span className="block text-[10px] uppercase tracking-wide text-text-3">{loadUnitLabel(dumbbells)}{perSide ? " · side" : ""}</span>
        </span>
        <Stepper onClick={() => onAdjust("kg", 1)}><Plus className="h-5 w-5" strokeWidth={2.5} /></Stepper>
      </div>
      <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated p-1">
        <Stepper onClick={() => onAdjust("reps", -1)}><Minus className="h-5 w-5" strokeWidth={2.5} /></Stepper>
        <span className="w-14 text-center leading-none">
          <b className="text-[24px] font-extrabold tabular-nums text-text-1">{set.reps}</b>
          <span className="block text-[10px] uppercase tracking-wide text-text-3">reps</span>
        </span>
        <Stepper onClick={() => onAdjust("reps", 1)}><Plus className="h-5 w-5" strokeWidth={2.5} /></Stepper>
      </div>
    </div>
  );
}
