"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Minus, Plus, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";

// ── Types (mirrors src/app/strength/page.tsx) ─────────────────────────────────

export type SessionType = "upper" | "lower" | "lower_achilles";

export interface PlannedExercise {
  slug: string;
  name: string;
  category: "upper" | "lower" | "achilles";
  equipmentNote?: string;
  tempoNote?: string;
  flatGroundOnly: boolean;
  perSide: boolean;
  sets: number;
  repLow: number;
  repHigh: number;
  restSeconds?: number;
  prescription: string;
  suggestedWeightKg: number | null;
  lastWeightKg: number | null;
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

interface WorkSet {
  kg: number;
  reps: number;
  logged: boolean;
}

interface Props {
  session: GuidedSessionInfo;
  exercises: PlannedExercise[];
  onExit: () => void;
  onFinish: (summary: GuidedFinishSummary) => void;
}

// Dumbbell ladder (mirrors the server) for the +/- steppers.
const LEVELS = [2.5, 4, 5, 6.5, 8, 9, 10.5, 12, 13, 14.5, 16, 17, 18, 19.5, 21, 22, 23, 23.5];
const snap = (kg: number) => LEVELS.reduce((a, b) => (Math.abs(b - kg) < Math.abs(a - kg) ? b : a), LEVELS[0]);
const stepW = (kg: number, d: number) => {
  const i = LEVELS.indexOf(snap(kg));
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i + d))];
};
const REST_DEFAULT = 90;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

const MUTE_KEY = "kadenz_kraft_muted";
const isMutedFromStorage = (): boolean => {
  try {
    return typeof window !== "undefined" && localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

// ── Audio: Web Speech + a tiny Web Audio beep, both best-effort ───────────────
// iOS Safari gates both speechSynthesis and AudioContext behind a user
// gesture. `unlockGuidedAudio` must be called synchronously from the Start
// button's onClick — before this component mounts — so the very first
// utterance/beep isn't silently dropped.

let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

/** Call from the Start button's onClick (same tick, real user gesture). */
export function unlockGuidedAudio() {
  try {
    if (!isMutedFromStorage() && typeof window !== "undefined" && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance("Let's go");
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* speechSynthesis is best-effort */
  }
  try {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === "suspended") ctx.resume();
  } catch {
    /* Web Audio is best-effort */
  }
}

// Small spring-driven +/- stepper button, matching the overview logger.
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
    }));
  }
  return w;
}

// Full-screen, one-exercise-at-a-time guided walkthrough. Owns the running
// session clock (only ticks while this component is mounted), the rest
// countdown, and the audio prompts.
export default function GuidedSession({ session, exercises, onExit, onFinish }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [exIndex, setExIndex] = useState(0);
  const [work, setWork] = useState<Record<string, WorkSet[]>>(() => buildWork(exercises));
  const [rest, setRest] = useState<number | null>(null);
  const [muted, setMuted] = useState<boolean>(() => isMutedFromStorage());
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutedRef = useRef(muted);
  const workRef = useRef(work);
  const exIndexRef = useRef(exIndex);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);
  useEffect(() => {
    workRef.current = work;
  }, [work]);
  useEffect(() => {
    exIndexRef.current = exIndex;
  }, [exIndex]);

  // Session clock — only runs while the guided player is mounted.
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () => () => {
      if (restTimer.current) clearInterval(restTimer.current);
    },
    []
  );

  function speak(text: string) {
    if (mutedRef.current) return;
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    } catch {
      /* best-effort */
    }
  }

  function beep(freq = 660, durationMs = 80) {
    if (mutedRef.current) return;
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
    } catch {
      /* best-effort */
    }
  }

  function announce(ex: PlannedExercise) {
    const repPart = ex.repLow === ex.repHigh ? `${ex.repLow}` : `${ex.repLow} to ${ex.repHigh}`;
    const bits = [`${ex.name}.`, `${ex.sets} sets of ${repPart} reps.`];
    if (ex.perSide) bits.push("Per side.");
    if (ex.tempoNote) bits.push(`${ex.tempoNote}.`);
    speak(bits.join(" "));
  }

  // Announce whenever the current exercise changes (mount, prev/next, auto-advance).
  useEffect(() => {
    const ex = exercises[exIndex];
    if (ex) announce(ex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exIndex]);

  function toggleMute() {
    haptic("light");
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function advanceIfExerciseDone() {
    const idx = exIndexRef.current;
    const ex = exercises[idx];
    if (!ex) return;
    const sets = workRef.current[ex.slug] ?? [];
    const allLogged = sets.length > 0 && sets.every((s) => s.logged);
    if (!allLogged) return;
    const next = exercises[idx + 1];
    if (next) {
      speak(`Next up: ${next.name}.`);
      setExIndex(idx + 1);
    } else {
      speak("Session complete. Great work.");
      haptic("success");
    }
  }

  function startRest(seconds: number) {
    if (restTimer.current) clearInterval(restTimer.current);
    setRest(seconds);
    speak(`Rest ${seconds} seconds.`);
    restTimer.current = setInterval(() => {
      setRest((r) => {
        if (r === null) return null;
        const next = r - 1;
        if (next > 0 && next <= 3) beep(660, 80);
        if (next <= 0) {
          if (restTimer.current) clearInterval(restTimer.current);
          restTimer.current = null;
          haptic("warning");
          speak("Go.");
          advanceIfExerciseDone();
          return null;
        }
        return next;
      });
    }, 1000);
  }

  function stopRestSilently() {
    if (restTimer.current) clearInterval(restTimer.current);
    restTimer.current = null;
    setRest(null);
  }

  function skipRest() {
    haptic("light");
    stopRestSilently();
    advanceIfExerciseDone();
  }

  function logSet() {
    const ex = exercises[exIndex];
    if (!ex) return;
    const arr = work[ex.slug] ?? [];
    const si = arr.findIndex((s) => !s.logged);
    if (si === -1) return;
    const set = arr[si];
    setWork((w) => ({
      ...w,
      [ex.slug]: (w[ex.slug] ?? []).map((s, i) => (i === si ? { ...s, logged: true } : s)),
    }));
    haptic("light");
    apiFetch(`/api/strength/sessions/${session.id}/sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exerciseSlug: ex.slug,
        setNumber: si + 1,
        weightKg: set.kg,
        reps: set.reps,
      }),
    }).catch(() => {});
    startRest(ex.restSeconds || REST_DEFAULT);
  }

  function adjust(field: "kg" | "reps", d: number) {
    const ex = exercises[exIndex];
    if (!ex) return;
    haptic("light");
    setWork((w) => {
      const arr = w[ex.slug] ?? [];
      const si = arr.findIndex((s) => !s.logged);
      if (si === -1) return w;
      return {
        ...w,
        [ex.slug]: arr.map((s, i) =>
          i === si
            ? field === "kg"
              ? { ...s, kg: stepW(s.kg, d) }
              : { ...s, reps: Math.max(1, s.reps + d) }
            : s
        ),
      };
    });
  }

  function goTo(idx: number) {
    if (idx < 0 || idx >= exercises.length) return;
    stopRestSilently();
    setExIndex(idx);
  }

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    haptic("success");
    const setsLogged = Object.values(work).flat().filter((s) => s.logged).length;
    const totalSets = Object.values(work).flat().length;
    const durationMinutes = Math.max(1, Math.round(elapsed / 60));
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
      onFinish({ setsLogged, totalSets, durationMinutes });
    } catch {
      setError("Network error — couldn't finish the session.");
      setFinishing(false);
    }
  }

  const ex = exercises[exIndex];
  if (!ex) return null;
  const arr = work[ex.slug] ?? [];
  const currentSi = arr.findIndex((s) => !s.logged);
  const allLogged = currentSi === -1;
  const displaySi = allLogged ? arr.length : currentSi;
  const current = allLogged ? arr[arr.length - 1] : arr[currentSi];
  const isLast = exIndex === exercises.length - 1;
  const restPct = rest !== null ? Math.max(0, Math.min(100, (rest / (ex.restSeconds || REST_DEFAULT)) * 100)) : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-bg"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 8px)",
        paddingBottom: "max(env(safe-area-inset-bottom), 8px)",
      }}
    >
      <div className="flex items-center justify-between px-4 pb-1">
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onExit();
          }}
          style={{ touchAction: "manipulation" }}
          className="text-[15px] font-semibold text-text-2"
        >
          Exit
        </button>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-danger animate-pulse" />
          <span className="text-[17px] font-extrabold tabular-nums text-text-1">{fmt(elapsed)}</span>
        </div>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute audio cues" : "Mute audio cues"}
          style={{ touchAction: "manipulation" }}
          className="text-text-2"
        >
          {muted ? <VolumeX className="h-5 w-5" strokeWidth={2} /> : <Volume2 className="h-5 w-5" strokeWidth={2} />}
        </button>
      </div>

      <p className="px-4 text-center text-[13px] font-medium text-text-3">
        Exercise {exIndex + 1} of {exercises.length}
      </p>

      {session.type === "lower_achilles" && (
        <div className="mx-4 mt-2 rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2 text-center text-[12px] font-medium text-warn">
          Order locked: explosive work first, slow heavy HSR calf work last.
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2 text-center text-[13px] font-medium text-danger">
          {error}
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-4 text-center">
        <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-text-1">{ex.name}</h1>
        <p className="mt-1 text-[15px] font-semibold text-text-2">
          Set {Math.min(displaySi + 1, ex.sets)} of {ex.sets}
        </p>
        <p className="mt-2 text-[13px] text-text-3">
          Target: {ex.repLow === ex.repHigh ? ex.repLow : `${ex.repLow}–${ex.repHigh}`} reps
          {ex.perSide ? " · per side" : ""}
        </p>
        {ex.tempoNote && <p className="mt-0.5 text-[12px] text-text-3">{ex.tempoNote}</p>}

        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
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
        </div>

        {rest === null ? (
          <>
            <div className="mt-7 flex items-center gap-5">
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated p-1">
                  <Stepper onClick={() => adjust("kg", -1)}>
                    <Minus className="h-5 w-5" strokeWidth={2.5} />
                  </Stepper>
                  <span className="w-16 text-center leading-none">
                    <b className="text-[26px] font-extrabold tabular-nums text-text-1">{current.kg}</b>
                    <span className="block text-[10px] uppercase tracking-wide text-text-3">
                      kg{ex.perSide ? "/side" : ""}
                    </span>
                  </span>
                  <Stepper onClick={() => adjust("kg", 1)}>
                    <Plus className="h-5 w-5" strokeWidth={2.5} />
                  </Stepper>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated p-1">
                  <Stepper onClick={() => adjust("reps", -1)}>
                    <Minus className="h-5 w-5" strokeWidth={2.5} />
                  </Stepper>
                  <span className="w-14 text-center leading-none">
                    <b className="text-[26px] font-extrabold tabular-nums text-text-1">{current.reps}</b>
                    <span className="block text-[10px] uppercase tracking-wide text-text-3">reps</span>
                  </span>
                  <Stepper onClick={() => adjust("reps", 1)}>
                    <Plus className="h-5 w-5" strokeWidth={2.5} />
                  </Stepper>
                </div>
              </div>
            </div>

            <div className="mt-8 w-full max-w-xs">
              <Button variant="primary" size="lg" full onClick={logSet} disabled={allLogged}>
                {allLogged ? "All sets logged" : `Log set ${displaySi + 1}`}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-8 w-full max-w-xs">
            <div className="text-[48px] font-extrabold tabular-nums text-accent">{fmt(rest)}</div>
            <p className="mt-1 text-[13px] text-text-3">Rest — next set</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-accent transition-all duration-1000 ease-linear"
                style={{ width: `${restPct}%` }}
              />
            </div>
            <div className="mt-4">
              <Button variant="secondary" size="md" full onClick={skipRest}>
                Skip rest
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-2">
        <div className="mb-3 flex justify-center gap-1.5">
          {exercises.map((e, i) => (
            <button
              key={e.slug}
              type="button"
              aria-label={`Go to ${e.name}`}
              onClick={() => goTo(i)}
              style={{ touchAction: "manipulation" }}
              className={`h-1.5 rounded-full transition-all ${
                i === exIndex ? "w-5 bg-accent" : "w-1.5 bg-text-3/40"
              }`}
            />
          ))}
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => goTo(exIndex - 1)} disabled={exIndex === 0} full>
            Prev
          </Button>
          {isLast ? (
            <Button variant="primary" onClick={finish} busy={finishing} full>
              Finish
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => goTo(exIndex + 1)} full>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
