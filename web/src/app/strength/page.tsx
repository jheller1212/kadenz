"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ChevronRight, Minus, Plus, Check, X } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";

// ── Types (API shapes) ────────────────────────────────────────────────────────

type SessionType = "upper" | "lower" | "lower_achilles";

interface PlannedExercise {
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
  prescription: string;
  suggestedWeightKg: number | null;
  lastWeightKg: number | null;
  painGated: boolean;
  progression: { action: string; reason: string };
}

interface SessionDetail {
  id: string;
  type: SessionType;
  title: string;
  status: string;
  targetDurationMinutes: number | null;
  plannedExercises: PlannedExercise[];
  sets: Array<{ exerciseId: string; setNumber: number; weightKg: number | null; reps: number | null }>;
}

const TYPE_META: Record<SessionType, { title: string; sub: string; color: string }> = {
  upper: { title: "Upper", sub: "5 lifts · ~35 min", color: "#60A5FA" },
  lower: { title: "Lower", sub: "4 lifts · ~28 min", color: "#C084FC" },
  lower_achilles: { title: "Lower + Achilles", sub: "7 lifts · ~46 min", color: "#FFB547" },
};

// Dumbbell ladder (mirrors the server) for the +/- steppers.
const LEVELS = [2.5, 4, 5, 6.5, 8, 9, 10.5, 12, 13, 14.5, 16, 17, 18, 19.5, 21, 22, 23, 23.5];
const snap = (kg: number) => LEVELS.reduce((a, b) => (Math.abs(b - kg) < Math.abs(a - kg) ? b : a), LEVELS[0]);
const stepW = (kg: number, d: number) => {
  const i = LEVELS.indexOf(snap(kg));
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, i + d))];
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ── Local working-set state for the logger ────────────────────────────────────

interface WorkSet {
  kg: number;
  reps: number;
  logged: boolean;
}

// Small spring-driven +/- stepper button used throughout the logger.
function Stepper({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      style={{ touchAction: "manipulation" }}
      className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-input)] bg-surface text-text-1"
    >
      {children}
    </motion.button>
  );
}

export default function StrengthPage() {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [work, setWork] = useState<Record<string, WorkSet[]>>({});
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Session clock
  useEffect(() => {
    if (!session || session.status === "completed") return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [session]);

  // Rest countdown — driven imperatively so we never setState in an effect body.
  function startRest(seconds = 90) {
    if (restTimer.current) clearInterval(restTimer.current);
    setRest(seconds);
    restTimer.current = setInterval(() => {
      setRest((r) => {
        if (r === null || r <= 1) {
          if (restTimer.current) clearInterval(restTimer.current);
          haptic("warning");
          return null;
        }
        return r - 1;
      });
    }, 1000);
  }
  function stopRest() {
    if (restTimer.current) clearInterval(restTimer.current);
    setRest(null);
  }
  useEffect(() => () => {
    if (restTimer.current) clearInterval(restTimer.current);
  }, []);

  async function startSession(type: SessionType) {
    setBusy(true);
    setError(null);
    try {
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
      const detailRes = await apiFetch(`/api/strength/sessions/${s.id}`);
      if (!detailRes.ok) {
        setError("Couldn't load the session. Try again.");
        return;
      }
      const detail = await detailRes.json();
      hydrate(detail);
    } catch {
      setError("Network error — couldn't start the session.");
    } finally {
      setBusy(false);
    }
  }

  function hydrate(detail: SessionDetail) {
    const w: Record<string, WorkSet[]> = {};
    for (const ex of detail.plannedExercises) {
      const reps = ex.repHigh;
      w[ex.slug] = Array.from({ length: ex.sets }, () => ({
        kg: ex.suggestedWeightKg ?? 0,
        reps,
        logged: false,
      }));
    }
    setWork(w);
    setSession(detail);
    setElapsed(0);
  }

  async function logSet(ex: PlannedExercise, si: number) {
    const arr = work[ex.slug];
    const set = arr[si];
    const nextLogged = !set.logged;
    setWork({ ...work, [ex.slug]: arr.map((s, i) => (i === si ? { ...s, logged: nextLogged } : s)) });
    if (nextLogged) {
      haptic("light");
      startRest(90);
      if (session) {
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
      }
    }
  }

  function adjust(slug: string, si: number, field: "kg" | "reps", d: number) {
    haptic("light");
    setWork((w) => ({
      ...w,
      [slug]: w[slug].map((s, i) =>
        i === si
          ? field === "kg"
            ? { ...s, kg: stepW(s.kg, d) }
            : { ...s, reps: Math.max(1, s.reps + d) }
          : s
      ),
    }));
  }

  async function finish() {
    if (!session) return;
    haptic("success");
    await apiFetch(`/api/strength/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed", durationMinutes: Math.max(1, Math.round(elapsed / 60)) }),
    }).catch(() => {});
    setSession(null);
    setWork({});
  }

  // ── Picker ──────────────────────────────────────────────────────────────────
  if (!session) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Kraft" large />
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
                onClick={() => startSession(t)}
                whileTap={{ scale: busy ? 1 : 0.97 }}
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                style={{ touchAction: "manipulation" }}
                className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface p-4 text-left disabled:opacity-50"
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

          <TransitionLink
            href="/strength/history"
            className="mt-5 block text-center text-[15px] font-semibold text-accent"
          >
            View history →
          </TransitionLink>
        </div>
        <BottomNav active="strength" />
      </main>
    );
  }

  // ── Active session logger ─────────────────────────────────────────────────────
  const done = Object.values(work).flat().filter((s) => s.logged).length;
  const total = Object.values(work).flat().length;

  return (
    <main className="min-h-dvh bg-bg">
      <div className="px-4 pb-tabbar pt-[max(env(safe-area-inset-top),8px)]">
        <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between px-4 pb-3 pt-3 material">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
            <span className="text-[19px] font-extrabold tabular-nums text-text-1">{fmt(elapsed)}</span>
            <span className="text-[13px] text-text-3">/ ~{session.targetDurationMinutes}m</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setSession(null)}>
            Exit
          </Button>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <h1 className="text-[22px] font-bold tracking-tight text-text-1">{session.title}</h1>
          <span className="text-[13px] tabular-nums text-text-3">
            {done}/{total} sets
          </span>
        </div>

        {session.type === "lower_achilles" && (
          <div className="mt-2 rounded-[var(--radius-input)] bg-warn/10 px-3.5 py-2.5 text-[13px] font-medium text-warn">
            Order locked: explosive work first, slow heavy HSR calf work last.
          </div>
        )}

        <div className="mt-3 space-y-3">
          {session.plannedExercises.map((ex, ei) => (
            <div key={ex.slug} className="overflow-hidden rounded-[var(--radius-card)] bg-surface p-3.5">
              <div className="flex items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-elevated text-[12px] font-extrabold text-text-2">
                  {ei + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold leading-tight text-text-1">{ex.name}</p>
                  <p className="mt-0.5 text-[12px] text-text-3">
                    {ex.prescription}
                    {ex.tempoNote ? ` · ${ex.tempoNote}` : ""}
                  </p>
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
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {(work[ex.slug] ?? []).map((st, si) => (
                  <div key={si} className={`flex items-center gap-2 ${st.logged ? "opacity-50" : ""}`}>
                    <span className="w-8 shrink-0 text-[11px] font-extrabold uppercase tracking-wide text-text-3">
                      S{si + 1}
                    </span>
                    <div className="flex flex-1 items-center justify-between rounded-[var(--radius-input)] bg-elevated p-1">
                      <Stepper onClick={() => adjust(ex.slug, si, "kg", -1)}>
                        <Minus className="h-4 w-4" strokeWidth={2.5} />
                      </Stepper>
                      <span className="text-center leading-none">
                        <b className="text-[16px] font-extrabold tabular-nums text-text-1">{st.kg}</b>
                        <span className="block text-[9px] uppercase tracking-wide text-text-3">
                          kg{ex.perSide ? "/side" : ""}
                        </span>
                      </span>
                      <Stepper onClick={() => adjust(ex.slug, si, "kg", 1)}>
                        <Plus className="h-4 w-4" strokeWidth={2.5} />
                      </Stepper>
                    </div>
                    <div
                      className="flex items-center justify-between rounded-[var(--radius-input)] bg-elevated p-1"
                      style={{ maxWidth: 104 }}
                    >
                      <Stepper onClick={() => adjust(ex.slug, si, "reps", -1)}>
                        <Minus className="h-4 w-4" strokeWidth={2.5} />
                      </Stepper>
                      <span className="text-center leading-none">
                        <b className="text-[16px] font-extrabold tabular-nums text-text-1">{st.reps}</b>
                        <span className="block text-[9px] uppercase tracking-wide text-text-3">reps</span>
                      </span>
                      <Stepper onClick={() => adjust(ex.slug, si, "reps", 1)}>
                        <Plus className="h-4 w-4" strokeWidth={2.5} />
                      </Stepper>
                    </div>
                    <motion.button
                      type="button"
                      onClick={() => logSet(ex, si)}
                      aria-label="Log set"
                      whileTap={{ scale: 0.88 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      style={{ touchAction: "manipulation" }}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-input)] ${
                        st.logged ? "bg-[#4ADE80]" : "bg-accent"
                      } text-on-accent`}
                    >
                      {st.logged ? (
                        <Check className="h-5 w-5" strokeWidth={3} />
                      ) : (
                        <Plus className="h-5 w-5" strokeWidth={3} />
                      )}
                    </motion.button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <Button variant="primary" size="lg" full onClick={finish}>
            Finish session
          </Button>
        </div>
      </div>

      {/* Rest timer */}
      {rest !== null && (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-[430px] px-4">
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface p-3 shadow-2xl">
            <span className="text-[24px] font-extrabold tabular-nums text-accent">{fmt(Math.max(0, rest))}</span>
            <span className="flex-1 text-[13px] text-text-3">Rest — next set</span>
            <Button variant="secondary" size="sm" onClick={() => setRest((r) => (r ?? 0) + 15)}>
              +15s
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={stopRest}
              className="!bg-text-1 !text-bg"
            >
              <X className="h-4 w-4" strokeWidth={2.5} />
            </Button>
          </div>
        </div>
      )}

      <BottomNav active="strength" />
    </main>
  );
}
