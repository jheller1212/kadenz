"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

// ── Readiness card (Today) ────────────────────────────────────────────────────
// Score ring + band headline + why. Recomputes when the wellness check-in
// below it is saved (kadenz:wellness-saved event).

interface Readiness {
  score: number;
  band: "ready" | "easy" | "rest";
  reasons: { label: string; delta: number }[];
  hasCheckIn: boolean;
  advice: string;
  physiologyWarmup: { daysCollected: number; daysNeeded: number } | null;
}

const BAND_META: Record<Readiness["band"], { label: string; color: string }> = {
  ready: { label: "Ready to train", color: "var(--k-success)" },
  easy: { label: "Take it easy", color: "var(--k-warn)" },
  rest: { label: "Recovery day", color: "var(--k-danger)" },
};

export function ReadinessCard() {
  const [data, setData] = useState<Readiness | null>(null);

  const load = useCallback(() => {
    apiFetch("/api/readiness")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("kadenz:wellness-saved", load);
    return () => window.removeEventListener("kadenz:wellness-saved", load);
  }, [load]);

  if (!data) return null;

  // No check-in AND nothing else adjusted the score means there is zero
  // evidence behind it — BASE alone, dressed up as a number. Don't render a
  // score/band/advice for a constant; ask for the one input that would make
  // it real instead.
  if (!data.hasCheckIn && data.reasons.length === 0) {
    return (
      <div className="k-card p-4" data-testid="readiness-card">
        <p className="text-[15px] font-bold text-text-1">Readiness</p>
        <p className="mt-0.5 text-[13px] leading-snug text-text-2">
          Log today&apos;s check-in below to see how ready you are to train.
        </p>
      </div>
    );
  }

  const meta = BAND_META[data.band];
  const R = 20;
  const C = 2 * Math.PI * R;

  return (
    <div className="k-card p-4" data-testid="readiness-card">
      <div className="flex items-center gap-4">
        <div className="relative h-14 w-14 shrink-0">
          <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
            <circle cx="28" cy="28" r={R} fill="none" stroke="var(--k-elevated)" strokeWidth="5" />
            <circle
              cx="28" cy="28" r={R} fill="none"
              stroke={meta.color} strokeWidth="5" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - data.score / 100)}
              style={{ transition: "stroke-dashoffset 0.6s var(--ease-ios)" }}
            />
          </svg>
          <span
            className="absolute inset-0 flex items-center justify-center text-[15px] font-extrabold tabular-nums text-text-1"
            data-testid="readiness-score"
          >
            {data.score}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold" style={{ color: meta.color }} data-testid="readiness-band">
            {meta.label}
          </p>
          <p className="mt-0.5 text-[13px] leading-snug text-text-2">{data.advice}</p>
          {!data.hasCheckIn && (
            <p className="mt-1 text-[12px] text-text-3">
              Log today&apos;s check-in below for an accurate score.
            </p>
          )}
          {data.physiologyWarmup && (
            <p className="mt-1 text-[12px] text-text-3" data-testid="readiness-physiology-warmup">
              Building your recovery baseline from the watch (
              {data.physiologyWarmup.daysCollected}/{data.physiologyWarmup.daysNeeded} days).
              Sleep and HRV will factor in once it&apos;s ready.
            </p>
          )}
        </div>
      </div>
      {data.reasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.reasons.map((r) => (
            <span
              key={r.label}
              className="rounded-full bg-elevated px-2.5 py-1 text-[11px] font-semibold tabular-nums text-text-2"
            >
              {r.label}
              {r.delta !== 0 && (
                <span className={r.delta > 0 ? "text-success" : "text-danger"}>
                  {" "}{r.delta > 0 ? `+${r.delta}` : r.delta}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
