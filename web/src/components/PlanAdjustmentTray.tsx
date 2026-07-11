"use client";

import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarClock, Scale, XCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";

// ── Plan adjustment tray ──────────────────────────────────────────────────────
// Benchmark-style prompt shown on Today when run sessions were missed. Offers to
// redistribute the missed volume across the week's remaining runs, or simply
// mark the sessions as missed so the plan moves on.

interface MissedWorkout {
  id: string;
  date: string;
  type: string;
  title: string;
  targetKm: number;
}
interface Adjustments {
  hasMissed: boolean;
  missed: MissedWorkout[];
  missedKm: number;
  remainingThisWeek: number;
  canRedistribute: boolean;
}

export function PlanAdjustmentTray({
  onApplied,
}: {
  onApplied?: () => void;
}) {
  const [adj, setAdj] = useState<Adjustments | null>(null);
  const [busy, setBusy] = useState<"skip" | "redistribute" | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/plan/adjustments");
      if (!res.ok) return;
      const json: Adjustments = await res.json();
      if (json.hasMissed) setAdj(json);
    } catch {
      /* silent — the tray is non-critical */
    }
  }, []);

  useEffect(() => {
    // setAdj runs only after the awaited fetch resolves — not a sync cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function apply(action: "skip" | "redistribute") {
    if (!adj || busy) return;
    setBusy(action);
    setError(false);
    try {
      const res = await apiFetch("/api/plan/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          workoutIds: adj.missed.map((m) => m.id),
        }),
      });
      if (res.ok) {
        haptic("success");
        setDismissed(true);
        onApplied?.();
      } else {
        haptic("warning");
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  }

  if (!adj || dismissed) return null;

  const count = adj.missed.length;

  return (
    <AnimatePresence>
      <motion.section
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        className="mx-4 overflow-hidden rounded-[var(--radius-card)] border border-warn/40 bg-warn/10 p-4"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn/20">
            <CalendarClock className="h-5 w-5 text-warn" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-text-1">
              {count} missed {count === 1 ? "session" : "sessions"}
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-text-2">
              {adj.missedKm > 0
                ? `${adj.missedKm} km didn't get logged. Realign your week or let the plan move on.`
                : "Realign your week or let the plan move on."}
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-2 text-[12px] text-danger">Couldn&apos;t apply that — try again.</p>
        )}

        <div className="mt-3.5 flex gap-2">
          {adj.canRedistribute && (
            <button
              onClick={() => apply("redistribute")}
              disabled={busy != null}
              className="press flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-input)] bg-accent text-[14px] font-bold text-on-accent disabled:opacity-60"
            >
              <Scale className="h-4 w-4" strokeWidth={2.2} />
              {busy === "redistribute" ? "Adjusting…" : "Redistribute"}
            </button>
          )}
          <button
            onClick={() => apply("skip")}
            disabled={busy != null}
            className="press flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-input)] bg-elevated text-[14px] font-semibold text-text-1 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4 text-text-2" strokeWidth={2} />
            {busy === "skip" ? "Updating…" : "Mark missed"}
          </button>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
