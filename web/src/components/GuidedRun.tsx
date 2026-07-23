"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronRight, ChevronDown, Play, Pause, Check, MapPin, MapPinOff } from "lucide-react";
import { formatPace } from "@/lib/plan-engine/pace-zones";
import { CUE_VOLUME_GAIN, loadSettings, type UserSettings } from "@/lib/settings";
import { haptic } from "@/lib/haptics";
import {
  clearRunSnapshot,
  saveRunSnapshot,
  type RunSnapshot,
} from "@/lib/run-snapshot";

// ── Guided run player ─────────────────────────────────────────────────────────
// Walks a run's blocks step-by-step with spoken/beeped coaching, background-safe
// timestamp timers, an optional GPS layer for live distance/pace/splits, and a
// Wake Lock so the screen stays on. Self-contained (its own audio + wake-lock)
// so it never entangles with the strength GuidedSession.

export interface GuidedRunBlock {
  type: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  targetPaceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceKm?: number | null;
  repRestSeconds?: number | null;
  sortOrder: number;
}

export interface GuidedRunFinish {
  elapsedSeconds: number;
  distanceKm: number | null; // null when GPS was off/unavailable
}

interface Step {
  kind: "segment" | "interval" | "rest";
  label: string;
  detail: string;
  targetKm?: number;
  targetSeconds?: number;
  paceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  restSeconds?: number;
  speech: string;
}

const BLOCK_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  work: "Main set",
  recovery: "Recovery jog",
  cooldown: "Cool-down",
};

function paceSpeech(secKm?: number | null): string {
  if (!secKm) return "";
  const m = Math.floor(secKm / 60);
  const s = Math.round(secKm % 60);
  const pace = s === 0 ? `${m} minute` : `${m} ${s < 10 ? "oh " : ""}${s}`;
  return ` at ${pace} per kilometre`;
}

// Flatten workout blocks into an ordered step list.
function buildSteps(blocks: GuidedRunBlock[]): Step[] {
  const steps: Step[] = [];
  const sorted = [...blocks].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const b of sorted) {
    const isInterval = b.type === "work" && (b.reps ?? 0) > 1 && b.repDistanceKm;
    if (isInterval) {
      const reps = b.reps!;
      const repKm = b.repDistanceKm!;
      const meters = Math.round(repKm * 1000);
      for (let r = 1; r <= reps; r++) {
        steps.push({
          kind: "interval",
          label: `Interval ${r} of ${reps}`,
          detail: `${meters}m`,
          targetKm: repKm,
          paceSecKm: b.targetPaceSecKm ?? null,
          minPaceSecKm: b.minPaceSecKm ?? null,
          maxPaceSecKm: b.maxPaceSecKm ?? null,
          speech: `Interval ${r} of ${reps}. ${meters} metres${paceSpeech(b.targetPaceSecKm)}. Go!`,
        });
        if (r < reps && (b.repRestSeconds ?? 0) > 0) {
          steps.push({
            kind: "rest",
            label: "Recover",
            detail: `${b.repRestSeconds}s easy`,
            restSeconds: b.repRestSeconds!,
            speech: `Recover for ${b.repRestSeconds} seconds.`,
          });
        }
      }
      continue;
    }

    // Single segment (warmup / cooldown / recovery / easy / tempo / long).
    const label = BLOCK_LABEL[b.type] ?? "Run";
    const km = b.distanceKm ?? undefined;
    const mins = b.durationMinutes ?? undefined;
    const detail = km ? `${km} km` : mins ? `${mins} min` : "";
    const target =
      km != null
        ? `${km} kilometre${km === 1 ? "" : "s"}`
        : mins != null
        ? `${mins} minute${mins === 1 ? "" : "s"}`
        : "";
    steps.push({
      kind: "segment",
      label,
      detail,
      targetKm: km,
      targetSeconds: mins != null ? mins * 60 : undefined,
      paceSecKm: b.targetPaceSecKm ?? null,
      minPaceSecKm: b.minPaceSecKm ?? null,
      maxPaceSecKm: b.maxPaceSecKm ?? null,
      speech: `${label}. ${target}${paceSpeech(b.targetPaceSecKm)}.`,
    });
  }

  // Fallback: a workout with no structured blocks → one open segment.
  if (steps.length === 0) {
    steps.push({
      kind: "segment",
      label: "Run",
      detail: "",
      speech: "Start your run.",
    });
  }
  return steps;
}

// Haversine distance between two lat/lng points, in metres.
function haversine(a: GeolocationCoordinates, b: GeolocationCoordinates): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function GuidedRun({
  workoutId,
  title,
  blocks,
  useMiles,
  resumeFrom,
  onFinish,
  onMinimize,
  onClose,
}: {
  workoutId: string;
  title: string;
  blocks: GuidedRunBlock[];
  useMiles: boolean;
  /** When set, restore an in-progress run instead of running the pre-run phase. */
  resumeFrom?: RunSnapshot | null;
  onFinish: (summary: GuidedRunFinish) => void;
  /** Park the run (keep the snapshot) and leave the overlay. */
  onMinimize?: () => void;
  onClose: () => void;
}) {
  const prefsRef = useRef<UserSettings>(loadSettings());
  const [steps] = useState<Step[]>(() => buildSteps(blocks));
  // Resuming a parked run restores its position + skips the pre-run phase, so
  // both seed from resumeFrom at first render (the effect only restores refs).
  const [stepIdx, setStepIdx] = useState(() =>
    resumeFrom ? Math.min(buildSteps(blocks).length - 1, Math.max(0, resumeFrom.stepIdx)) : 0
  );
  const [paused, setPaused] = useState(false);
  // "started" gates the clock: while false we're in the pre-run phase
  // (numeric countdown, or waiting for motion). The elapsed clock, step audio
  // and auto-advance only begin once the run actually starts.
  const [started, setStarted] = useState(() => !!resumeFrom);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [awaitingMotion, setAwaitingMotion] = useState(false);
  const autoPausedRef = useRef(false); // paused by auto-pause, not by the user
  const lastMoveAtRef = useRef<number>(0); // ms of the last detected movement
  // All render-facing derived values live in state, updated by the ticker —
  // render never reads mutable refs directly (React purity rules).
  const [view, setView] = useState<{
    elapsed: number;
    distKm: number;
    pace: number | null;
    paceInRange: boolean | null;
    restRem: number | null;
  }>({ elapsed: 0, distKm: 0, pace: null, paceInRange: null, restRem: null });

  // Timestamp-based clocks (survive re-renders / backgrounding).
  const startRef = useRef<number | null>(null); // run start (ms), minus paused time
  const pausedAtRef = useRef<number | null>(null);
  const stepStartRef = useRef<number>(0); // elapsed seconds at current step start
  const restEndRef = useRef<number | null>(null);
  const lastRestBeepRef = useRef<number>(-1);

  // GPS state.
  const [gpsOn, setGpsOn] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const watchRef = useRef<number | null>(null);
  const lastFixRef = useRef<GeolocationCoordinates | null>(null);
  const distanceMRef = useRef(0); // total metres
  const stepStartDistRef = useRef(0);
  const livePaceRef = useRef<number | null>(null);
  const lastTickDistRef = useRef(0); // metres seen at the previous auto-pause check
  const splitUnitM = useMiles ? 1609.344 : 1000;
  const nextSplitRef = useRef(1); // next split index to announce
  const splitStartTimeRef = useRef(0);

  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  // ── Audio (best-effort, own instance) ──────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const beep = useCallback((freq = 660, ms = 80) => {
    const p = prefsRef.current;
    if (!p.runAudio) return;
    const peak = CUE_VOLUME_GAIN[p.cueVolume];
    if (peak <= 0) return;
    try {
      if (!audioCtxRef.current) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
    } catch {
      /* ignore */
    }
  }, []);

  const speak = useCallback((text: string) => {
    const p = prefsRef.current;
    if (!p.runAudio || !p.runVoice) return;
    const vol = CUE_VOLUME_GAIN[p.cueVolume];
    if (vol <= 0) return;
    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.volume = vol;
        window.speechSynthesis.speak(u);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const elapsed = useCallback(() => {
    if (startRef.current == null) return 0;
    const now = pausedAtRef.current ?? Date.now();
    return (now - startRef.current) / 1000;
  }, []);

  // Freeze/unfreeze the clock. Shared by the manual pause button and auto-pause
  // so the timestamp-shift on resume happens in exactly one place.
  const doPause = useCallback(() => {
    if (pausedAtRef.current != null) return;
    pausedAtRef.current = Date.now();
    setPaused(true);
  }, []);
  const doResume = useCallback(() => {
    if (pausedAtRef.current != null && startRef.current != null) {
      const delta = Date.now() - pausedAtRef.current;
      startRef.current += delta;
      if (restEndRef.current != null) restEndRef.current += delta;
    }
    pausedAtRef.current = null;
    setPaused(false);
  }, []);

  // ── Start / step transitions ───────────────────────────────────────────────
  const enterStep = useCallback(
    (idx: number) => {
      const step = steps[idx];
      if (!step) return;
      stepStartRef.current = elapsed();
      stepStartDistRef.current = distanceMRef.current;
      restEndRef.current =
        step.kind === "rest" && step.restSeconds
          ? Date.now() + step.restSeconds * 1000
          : null;
      lastRestBeepRef.current = -1;
      haptic("medium");
      beep(step.kind === "rest" ? 520 : 780, 120);
      speak(step.speech);
    },
    [steps, elapsed, beep, speak]
  );

  const goToStep = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(steps.length - 1, idx));
      setStepIdx(clamped);
      enterStep(clamped);
    },
    [steps.length, enterStep]
  );

  const finish = useCallback(() => {
    beep(880, 200);
    speak("Workout complete. Great work!");
    haptic("success");
    clearRunSnapshot();
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    wakeRef.current?.release().catch(() => {});
    onFinish({
      elapsedSeconds: Math.round(elapsed()),
      distanceKm: gpsOn ? Math.round((distanceMRef.current / 1000) * 100) / 100 : null,
    });
  }, [beep, speak, elapsed, gpsOn, onFinish]);

  const nextStep = useCallback(() => {
    if (stepIdx >= steps.length - 1) {
      finish();
      return;
    }
    goToStep(stepIdx + 1);
  }, [stepIdx, steps.length, finish, goToStep]);

  // Leave the pre-run phase and start the clock. Idempotent — countdown tick,
  // motion detection and a tap-to-skip can all race to call it.
  const beginRun = useCallback(() => {
    if (startRef.current != null) return;
    startRef.current = Date.now();
    splitStartTimeRef.current = 0;
    stepStartRef.current = 0;
    stepStartDistRef.current = distanceMRef.current;
    lastMoveAtRef.current = Date.now();
    setCountdown(null);
    setAwaitingMotion(false);
    setStarted(true);
    haptic("success");
    beep(880, 140);
    speak(steps[0]?.speech ?? "Start your run.");
  }, [beep, speak, steps]);

  // ── Mount: start clock, wake lock; unmount: cleanup ─────────────────────────
  useEffect(() => {
    prefsRef.current = loadSettings();
    const p = prefsRef.current;
    // Prime the audio graph within the launching gesture chain — a later beep
    // from a timer callback can't unlock it on iOS.
    beep(700, 60);

    if (resumeFrom) {
      // Resuming a parked/reloaded run: restore the clock and position, skip the
      // pre-run phase entirely. The clock kept counting while parked (its start
      // is timestamp-based), matching a minimized lift session.
      startRef.current = resumeFrom.startedAt;
      distanceMRef.current = resumeFrom.distanceM;
      nextSplitRef.current = resumeFrom.nextSplit;
      splitStartTimeRef.current = resumeFrom.splitStartSec;
      stepStartRef.current = resumeFrom.stepStartSec;
      stepStartDistRef.current = resumeFrom.stepStartDistM;
      lastMoveAtRef.current = Date.now();
      // stepIdx + started were seeded from resumeFrom at first render.
    } else if (p.runStartOnMotion && p.runGps && "geolocation" in navigator) {
      setAwaitingMotion(true);
    } else if (p.runCountdown) {
      setCountdown(3);
    } else {
      beginRun();
    }

    if (prefsRef.current.runKeepAwake) {
      const nav = navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      nav.wakeLock
        ?.request("screen")
        .then((w) => (wakeRef.current = w))
        .catch(() => {});
    }

    if (prefsRef.current.runGps && "geolocation" in navigator) {
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsOn(true);
          const c = pos.coords;
          if (typeof c.speed === "number" && c.speed > 0.3) {
            livePaceRef.current = 1000 / c.speed;
          }
          const prev = lastFixRef.current;
          if (prev && (c.accuracy == null || c.accuracy < 35)) {
            const d = haversine(prev, c);
            // Reject GPS jitter / teleports.
            if (d > 1 && d < 60) distanceMRef.current += d;
          }
          lastFixRef.current = c;
        },
        () => setGpsDenied(true),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    }

    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      wakeRef.current?.release().catch(() => {});
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-acquire wake lock on visibility return ───────────────────────────────
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible" && prefsRef.current.runKeepAwake) {
        const nav = navigator as unknown as {
          wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
        };
        nav.wakeLock
          ?.request("screen")
          .then((w) => (wakeRef.current = w))
          .catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── Pre-run countdown (3-2-1-Go) ────────────────────────────────────────────
  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) {
      beginRun();
      return;
    }
    beep(countdown === 1 ? 900 : 620, countdown === 1 ? 160 : 90);
    haptic("light");
    const id = setTimeout(
      () => setCountdown((c) => (c == null ? null : c - 1)),
      1000
    );
    return () => clearTimeout(id);
  }, [countdown, beep, beginRun]);

  // ── Start-on-motion: begin once GPS shows real movement ─────────────────────
  useEffect(() => {
    if (!awaitingMotion) return;
    const startDist = distanceMRef.current;
    const id = setInterval(() => {
      if (distanceMRef.current - startDist > 5) beginRun();
    }, 400);
    return () => clearInterval(id);
  }, [awaitingMotion, beginRun]);

  // ── Ticker: drives clocks, rest countdown, auto-advance, split cues ─────────
  useEffect(() => {
    const id = setInterval(() => {
      // Auto-pause runs even while paused so resumed motion can un-pause.
      if (started && gpsOn && prefsRef.current.runAutoPause) {
        const moved = distanceMRef.current - lastTickDistRef.current > 1.5;
        lastTickDistRef.current = distanceMRef.current;
        const now = Date.now();
        if (moved) {
          lastMoveAtRef.current = now;
          if (autoPausedRef.current) {
            autoPausedRef.current = false;
            doResume();
          }
        } else if (!paused && now - lastMoveAtRef.current > 6000) {
          autoPausedRef.current = true;
          doPause();
        }
      }

      if (paused || !started) return;
      const step = steps[stepIdx];
      if (!step) return;

      // Rest countdown → beep last 3s, auto-advance at 0.
      if (step.kind === "rest" && restEndRef.current != null) {
        const remMs = restEndRef.current - Date.now();
        const remSec = Math.ceil(remMs / 1000);
        if (remSec <= 3 && remSec > 0 && remSec !== lastRestBeepRef.current) {
          lastRestBeepRef.current = remSec;
          beep(remSec === 1 ? 900 : 620, remSec === 1 ? 160 : 80);
        }
        if (remMs <= 0) {
          nextStep();
          return;
        }
      }

      // Distance-target auto-advance (GPS only).
      if (gpsOn && step.targetKm != null) {
        const coveredKm = (distanceMRef.current - stepStartDistRef.current) / 1000;
        if (coveredKm >= step.targetKm) {
          nextStep();
          return;
        }
      }

      // Duration-target auto-advance.
      if (step.targetSeconds != null) {
        const inStep = elapsed() - stepStartRef.current;
        if (inStep >= step.targetSeconds) {
          nextStep();
          return;
        }
      }

      // Split announcements (GPS).
      if (gpsOn && prefsRef.current.runSplitCues) {
        const units = Math.floor(distanceMRef.current / splitUnitM);
        if (units >= nextSplitRef.current) {
          const now = elapsed();
          const splitSecs = now - splitStartTimeRef.current;
          splitStartTimeRef.current = now;
          nextSplitRef.current = units + 1;
          const m = Math.floor(splitSecs / 60);
          const s = Math.round(splitSecs % 60);
          const unitWord = useMiles ? "mile" : "kilometre";
          speak(`${units} ${unitWord}${units === 1 ? "" : "s"}. ${m} ${s < 10 ? "oh " : ""}${s}.`);
          beep(760, 90);
        }
      }

      // Publish derived display values to state.
      const totalElapsed = elapsed();
      let pace: number | null = null;
      if (gpsOn) {
        pace = livePaceRef.current;
        if (pace == null) {
          const coveredKm = (distanceMRef.current - stepStartDistRef.current) / 1000;
          const inStep = totalElapsed - stepStartRef.current;
          if (coveredKm > 0.05 && inStep > 5) pace = inStep / coveredKm;
        }
      }
      const paceInRange =
        pace != null && step.minPaceSecKm != null && step.maxPaceSecKm != null
          ? pace >= step.minPaceSecKm && pace <= step.maxPaceSecKm
          : null;
      const restRem =
        step.kind === "rest" && restEndRef.current != null
          ? Math.max(0, Math.ceil((restEndRef.current - Date.now()) / 1000))
          : null;
      setView({
        elapsed: totalElapsed,
        distKm: distanceMRef.current / 1000,
        pace,
        paceInRange,
        restRem,
      });
    }, 500);
    return () => clearInterval(id);
  }, [paused, started, stepIdx, steps, gpsOn, elapsed, beep, nextStep, speak, splitUnitM, useMiles, doPause, doResume]);

  function togglePause() {
    haptic("light");
    autoPausedRef.current = false; // a manual tap owns the pause state
    if (paused) doResume();
    else doPause();
  }

  // ── Hold-to-finish (shown while paused) ─────────────────────────────────────
  // A deliberate press-and-hold ends the run early — no accidental finish from a
  // stray tap while paused mid-run.
  const HOLD_MS = 900;
  const [holding, setHolding] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const startHold = useCallback(() => {
    haptic("light");
    setHolding(true);
    holdTimerRef.current = window.setTimeout(() => {
      setHolding(false);
      finish();
    }, HOLD_MS);
  }, [finish]);
  const cancelHold = useCallback(() => {
    if (holdTimerRef.current != null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHolding(false);
  }, []);
  useEffect(() => () => {
    if (holdTimerRef.current != null) clearTimeout(holdTimerRef.current);
  }, []);

  // ── Resumable snapshot ──────────────────────────────────────────────────────
  const buildSnapshot = useCallback((): RunSnapshot | null => {
    if (startRef.current == null) return null;
    return {
      v: 1,
      savedAt: Date.now(),
      workoutId,
      title,
      useMiles,
      startedAt: startRef.current,
      stepIdx,
      distanceM: distanceMRef.current,
      nextSplit: nextSplitRef.current,
      splitStartSec: splitStartTimeRef.current,
      stepStartSec: stepStartRef.current,
      stepStartDistM: stepStartDistRef.current,
    };
  }, [workoutId, title, useMiles, stepIdx]);

  // Persist on start, on every step change, and every 5s — so a minimize OR a
  // hard reload can resume from a recent position.
  useEffect(() => {
    if (!started) return;
    const persist = () => {
      const snap = buildSnapshot();
      if (snap) saveRunSnapshot(snap);
    };
    persist();
    const id = setInterval(persist, 5000);
    return () => clearInterval(id);
  }, [started, buildSnapshot]);

  const minimize = useCallback(() => {
    haptic("light");
    // A parked run keeps counting (like a lift session), so drop any pause.
    if (paused) doResume();
    const snap = buildSnapshot();
    if (snap) saveRunSnapshot(snap);
    onMinimize?.();
  }, [paused, doResume, buildSnapshot, onMinimize]);

  const closeAndDiscard = useCallback(() => {
    haptic("light");
    clearRunSnapshot();
    onClose();
  }, [onClose]);

  const step = steps[stepIdx];
  const totalElapsed = view.elapsed;
  const dispDist = useMiles ? view.distKm * 0.621371 : view.distKm;
  const displayPace = view.pace;
  const paceInRange = view.paceInRange;
  const restRem = view.restRem;

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col bg-bg"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 pt-3 pb-2"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={closeAndDiscard}
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated"
          aria-label="Discard guided run"
        >
          <X className="h-5 w-5 text-text-2" strokeWidth={2} />
        </button>
        <p className="text-[13px] font-semibold text-text-2 truncate px-2">{title}</p>
        <div className="flex items-center gap-2">
          {started && (
            <button
              onClick={minimize}
              className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated"
              aria-label="Minimize — keep running in the background"
              title="Minimize"
            >
              <ChevronDown className="h-5 w-5 text-text-2" strokeWidth={2} />
            </button>
          )}
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full"
            aria-label={gpsOn ? "GPS active" : gpsDenied ? "GPS unavailable" : "Acquiring GPS"}
            title={gpsOn ? "GPS active" : gpsDenied ? "GPS unavailable" : "Acquiring GPS"}
          >
            {gpsDenied ? (
              <MapPinOff className="h-5 w-5 text-text-3" strokeWidth={2} />
            ) : (
              <MapPin
                className={`h-5 w-5 ${gpsOn ? "text-accent-fg" : "text-text-3"}`}
                strokeWidth={2}
              />
            )}
          </div>
        </div>
      </div>

      {/* Big clock + distance */}
      <div className="px-4 pt-2">
        <div className="flex items-baseline justify-center gap-6">
          <div className="text-center">
            <p className="text-[52px] font-extrabold tabular-nums leading-none text-text-1">
              {fmtClock(totalElapsed)}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-text-3">Elapsed</p>
          </div>
        </div>
        {gpsOn && (
          <div className="mt-4 flex items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-[24px] font-extrabold tabular-nums leading-none text-text-1">
                {dispDist.toFixed(2)}
                <span className="text-[13px] font-semibold text-text-3">
                  {useMiles ? " mi" : " km"}
                </span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-text-3">Distance</p>
            </div>
            <div className="text-center">
              <p
                className="text-[24px] font-extrabold tabular-nums leading-none"
                style={{
                  color:
                    paceInRange == null
                      ? "var(--k-text-1)"
                      : paceInRange
                      ? "var(--k-accent)"
                      : "#FFB547",
                }}
              >
                {displayPace ? formatPace(displayPace, useMiles) : "—:—"}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-text-3">
                {useMiles ? "/mi" : "/km"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Current step card */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={stepIdx}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm k-card p-6 text-center"
          >
            <p className="text-[13px] font-semibold uppercase tracking-wider text-accent-fg">
              Step {stepIdx + 1} of {steps.length}
            </p>
            <h2 className="mt-2 text-[28px] font-extrabold tracking-tight text-text-1">
              {step?.label}
            </h2>
            {step?.kind === "rest" && restRem != null ? (
              <p className="mt-3 text-[56px] font-extrabold tabular-nums leading-none text-text-1">
                {restRem}
                <span className="text-[18px] font-semibold text-text-3">s</span>
              </p>
            ) : (
              <>
                {step?.detail && (
                  <p className="mt-2 text-[20px] font-bold text-text-1">{step.detail}</p>
                )}
                {step?.paceSecKm != null && (
                  <p className="mt-1 text-[15px] text-text-2">
                    Target {formatPace(step.paceSecKm, useMiles)}
                    {useMiles ? "/mi" : "/km"}
                  </p>
                )}
                {step?.minPaceSecKm != null && step?.maxPaceSecKm != null && (
                  <p className="mt-0.5 text-[13px] text-text-3">
                    {formatPace(step.minPaceSecKm, useMiles)}–
                    {formatPace(step.maxPaceSecKm, useMiles)}
                    {useMiles ? "/mi" : "/km"}
                  </p>
                )}
              </>
            )}

            {/* Next-up preview */}
            {stepIdx < steps.length - 1 && (
              <p className="mt-5 text-[12px] text-text-3">
                Next: {steps[stepIdx + 1].label}
                {steps[stepIdx + 1].detail ? ` · ${steps[stepIdx + 1].detail}` : ""}
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        {paused && (
          <p className="mt-4 text-[13px] font-semibold uppercase tracking-wider text-warn">
            Paused
          </p>
        )}
      </div>

      {/* Controls */}
      <div
        className="flex items-center gap-3 px-4 pb-6"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {paused ? (
          <>
            {/* Hold-to-finish: a fill sweeps left→right over HOLD_MS, then ends. */}
            <button
              onPointerDown={startHold}
              onPointerUp={cancelHold}
              onPointerLeave={cancelHold}
              onPointerCancel={cancelHold}
              className="press relative flex h-14 flex-1 items-center justify-center gap-2 overflow-hidden rounded-full bg-elevated text-[15px] font-bold text-text-1 select-none"
              aria-label="Hold to finish"
            >
              <span
                className="pointer-events-none absolute inset-y-0 left-0 bg-accent"
                style={{
                  width: holding ? "100%" : "0%",
                  transition: `width ${holding ? HOLD_MS : 150}ms linear`,
                }}
              />
              <span className="relative z-10 flex items-center gap-2">
                <Check className="h-5 w-5" strokeWidth={2.4} /> Hold to finish
              </span>
            </button>
            <button
              onClick={togglePause}
              className="press flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent"
              aria-label="Resume"
            >
              <Play className="h-6 w-6" strokeWidth={2} fill="currentColor" />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={togglePause}
              className="press flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-elevated"
              aria-label="Pause"
            >
              <Pause className="h-6 w-6 text-text-1" strokeWidth={2} fill="currentColor" />
            </button>
            <button
              onClick={() => {
                haptic("medium");
                nextStep();
              }}
              className="press flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-bold text-on-accent"
            >
              {stepIdx >= steps.length - 1 ? (
                <>
                  <Check className="h-5 w-5" strokeWidth={2.4} /> Finish
                </>
              ) : (
                <>
                  Next step <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
                </>
              )}
            </button>
          </>
        )}
      </div>

      {/* Pre-run overlay: countdown or wait-for-motion, tap to start now */}
      <AnimatePresence>
        {!started && (
          <motion.button
            type="button"
            onClick={beginRun}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg/95 backdrop-blur-sm"
            aria-label={awaitingMotion ? "Start now" : "Skip countdown"}
          >
            {awaitingMotion ? (
              <>
                <p className="text-[13px] font-semibold uppercase tracking-wider text-text-3">
                  Waiting for motion
                </p>
                <p className="text-[40px] font-extrabold tracking-tight text-text-1">
                  Start moving
                </p>
                <p className="mt-2 text-[13px] text-text-3">Tap anywhere to start now</p>
              </>
            ) : (
              <AnimatePresence mode="wait">
                <motion.p
                  key={countdown ?? "go"}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.6 }}
                  transition={{ duration: 0.25 }}
                  className="font-display text-[120px] leading-none tabular-nums text-accent-fg"
                >
                  {countdown != null && countdown > 0 ? countdown : "GO"}
                </motion.p>
              </AnimatePresence>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
