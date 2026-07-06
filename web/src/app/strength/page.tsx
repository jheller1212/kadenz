"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";

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

export default function StrengthPage() {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [work, setWork] = useState<Record<string, WorkSet[]>>({});
  const [elapsed, setElapsed] = useState(0);
  const [rest, setRest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const buzz = (ms: number | number[]) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* no haptics */
    }
  };

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
          buzz([60, 40, 60]);
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
    try {
      const res = await fetch("/api/strength/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, date: new Date().toISOString(), force: true }),
      });
      if (!res.ok) return;
      const { session: s } = await res.json();
      const detail = await (await fetch(`/api/strength/sessions/${s.id}`)).json();
      hydrate(detail);
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
      buzz(30);
      startRest(90);
      if (session) {
        fetch(`/api/strength/sessions/${session.id}/sets`, {
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
    await fetch(`/api/strength/sessions/${session.id}`, {
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
      <div className="min-h-screen bg-bg">
        <main className="mx-auto w-full max-w-md px-4 pt-10 pb-28">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-3">Strength</p>
          <h1 className="mt-1 text-2xl font-extrabold text-text-1">Start a session</h1>
          <p className="mt-2 text-sm text-text-2">
            Dumbbell program · loads snap to your DH FitLife 18-in-1 (18 levels, 2.5–23.5 kg).
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3">
            {(Object.keys(TYPE_META) as SessionType[]).map((t) => (
              <button
                key={t}
                disabled={busy}
                onClick={() => startSession(t)}
                className="flex items-center gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-4 text-left active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <span className="h-10 w-1.5 rounded-full" style={{ backgroundColor: TYPE_META[t].color }} />
                <span className="flex-1">
                  <span className="block text-base font-extrabold text-text-1">{TYPE_META[t].title}</span>
                  <span className="block text-xs text-text-3">{TYPE_META[t].sub}</span>
                </span>
                <svg className="h-5 w-5 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
          <Link href="/strength/history" className="mt-4 block text-center text-sm font-semibold text-accent">
            View history →
          </Link>
        </main>
        <BottomNav active="strength" />
      </div>
    );
  }

  // ── Active session logger ─────────────────────────────────────────────────────
  const done = Object.values(work).flat().filter((s) => s.logged).length;
  const total = Object.values(work).flat().length;

  return (
    <div className="min-h-screen bg-bg">
      <main className="mx-auto w-full max-w-md px-4 pt-6 pb-40">
        <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between bg-bg px-4 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
            <span className="text-lg font-extrabold tabular-nums">{fmt(elapsed)}</span>
            <span className="text-xs text-text-3">/ ~{session.targetDurationMinutes}m</span>
          </div>
          <button onClick={() => setSession(null)} className="rounded-lg bg-elevated border border-hairline px-3 py-1.5 text-xs font-semibold text-text-2">
            Exit
          </button>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-elevated">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          <h1 className="text-xl font-extrabold text-text-1">{session.title}</h1>
          <span className="text-sm text-text-3 tabular-nums">{done}/{total} sets</span>
        </div>

        {session.type === "lower_achilles" && (
          <div className="mt-2 rounded-[var(--radius-input)] bg-[color-mix(in_srgb,var(--color-warn)_12%,transparent)] px-3 py-2 text-xs font-medium text-warn">
            Order locked: explosive work first, slow heavy HSR calf work last.
          </div>
        )}

        {session.plannedExercises.map((ex, ei) => (
          <div key={ex.slug} className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface">
            <div className="flex items-start gap-3 p-3.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-elevated text-xs font-extrabold text-text-2">{ei + 1}</span>
              <div className="flex-1">
                <p className="text-[15px] font-bold leading-tight text-text-1">{ex.name}</p>
                <p className="mt-0.5 text-[11px] text-text-3">
                  {ex.prescription}
                  {ex.tempoNote ? ` · ${ex.tempoNote}` : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {ex.flatGroundOnly && (
                    <span className="rounded-md bg-[color-mix(in_srgb,var(--color-warn)_18%,transparent)] px-2 py-0.5 text-[11px] font-bold text-warn">⚠ Flat ground only</span>
                  )}
                  {ex.painGated && (
                    <span className="rounded-md bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)] px-2 py-0.5 text-[11px] font-bold text-danger">Eased — pain gate</span>
                  )}
                  {ex.progression.action === "increase" && (
                    <span className="rounded-md bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] px-2 py-0.5 text-[11px] font-bold text-accent">↑ Level up</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 px-3.5 pb-3">
              {(work[ex.slug] ?? []).map((st, si) => (
                <div key={si} className={`flex items-center gap-2 ${st.logged ? "opacity-60" : ""}`}>
                  <span className="w-9 text-[11px] font-extrabold uppercase tracking-wide text-text-3">S{si + 1}</span>
                  <div className="flex flex-1 items-center justify-between rounded-[10px] border border-hairline bg-elevated p-1">
                    <button onClick={() => adjust(ex.slug, si, "kg", -1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-xl">−</button>
                    <span className="text-center leading-none">
                      <b className="text-base font-extrabold tabular-nums">{st.kg}</b>
                      <span className="block text-[9px] uppercase tracking-wide text-text-3">kg{ex.perSide ? "/side" : ""}</span>
                    </span>
                    <button onClick={() => adjust(ex.slug, si, "kg", 1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-xl">+</button>
                  </div>
                  <div className="flex items-center justify-between rounded-[10px] border border-hairline bg-elevated p-1" style={{ maxWidth: 104 }}>
                    <button onClick={() => adjust(ex.slug, si, "reps", -1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-xl">−</button>
                    <span className="text-center leading-none">
                      <b className="text-base font-extrabold tabular-nums">{st.reps}</b>
                      <span className="block text-[9px] uppercase tracking-wide text-text-3">reps</span>
                    </span>
                    <button onClick={() => adjust(ex.slug, si, "reps", 1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-xl">+</button>
                  </div>
                  <button
                    onClick={() => logSet(ex, si)}
                    aria-label="Log set"
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] ${st.logged ? "bg-[#4ADE80]" : "bg-accent"} text-on-accent active:scale-90 transition-transform`}
                  >
                    {st.logged ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 12h14M12 5v14" /></svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <button onClick={finish} className="mt-5 w-full rounded-full bg-accent py-4 text-sm font-extrabold text-on-accent active:scale-[0.98] transition-transform">
          Finish session
        </button>
      </main>

      {/* Rest timer */}
      {rest !== null && (
        <div className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-md px-4">
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-3 shadow-lg">
            <span className="text-2xl font-extrabold tabular-nums text-accent">{fmt(Math.max(0, rest))}</span>
            <span className="flex-1 text-xs text-text-3">Rest — next set</span>
            <button onClick={() => setRest((r) => (r ?? 0) + 15)} className="rounded-lg bg-elevated px-3 py-2 text-xs font-bold text-text-2">+15s</button>
            <button onClick={stopRest} className="rounded-lg bg-text-1 px-3 py-2 text-xs font-bold text-bg">Skip</button>
          </div>
        </div>
      )}

      <BottomNav active="strength" />
    </div>
  );
}
