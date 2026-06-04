"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// ── Types ───────────────────────────────────────────────────────────────────

interface MileageType {
  type: string;
  label: string;
  plannedKm: number;
  completedKm: number;
  pct: number;
  color: string;
}

interface WeeklyWorkout {
  weekNumber: number;
  workouts: Array<{ status: string; type: string }>;
}

interface InsightsData {
  activePlan: boolean;
  planName: string;
  startDate: string;
  overallPct: number;
  totalPlanRuns: number;
  completedRuns: number;
  missedRuns: number;
  mileageByType: MileageType[];
  behindTypes: string[];
  weeklyWorkouts: WeeklyWorkout[];
  currentWeekNum: number;
}

// ── Tab toggle ──────────────────────────────────────────────────────────────

function TabToggle({
  value,
  onChange,
}: {
  value: "all" | "current";
  onChange: (v: "all" | "current") => void;
}) {
  return (
    <div className="flex gap-2">
      {(["all", "current"] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${
            value === tab
              ? "bg-text-1 text-bg"
              : "bg-elevated text-text-3 border border-hairline"
          }`}
        >
          {tab === "all" ? "All" : "Current period"}
        </button>
      ))}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const router = useRouter();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mileageTab, setMileageTab] = useState<"all" | "current">("current");
  const [workoutsTab, setWorkoutsTab] = useState<"all" | "current">("current");

  useEffect(() => {
    fetch("/api/insights")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!data?.activePlan) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-text-2">No active plan</p>
        <button onClick={() => router.back()} className="text-accent text-sm font-semibold">
          Go back
        </button>
      </div>
    );
  }

  const startDateStr = new Date(data.startDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-md mx-auto w-full px-4 pt-10 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div />
        </div>

        <h1 className="text-2xl font-extrabold text-text-1">Mileage Insights</h1>

        {/* Warning banner */}
        {data.behindTypes.length > 0 ? (
          <div className="mt-5 rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-warn/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-warn" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-base font-bold text-text-1">
                  Behind {data.behindTypes.join(" & ").toLowerCase()} mileage
                </p>
                <p className="text-sm text-text-2 mt-1 leading-relaxed">
                  Your recent {data.behindTypes[0].toLowerCase()} mileage is below what we normally recommend at this stage of your plan. Stay consistent from now on, and you&apos;ll soon be back on track.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-base font-bold text-text-1">Mileage on track</p>
                <p className="text-sm text-text-2 mt-1 leading-relaxed">
                  You&apos;re keeping up with your plan across all workout types. Keep it up!
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Completed mileage */}
        <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
          <h2 className="text-lg font-bold text-text-1 mb-4">Completed mileage</h2>
          <TabToggle value={mileageTab} onChange={setMileageTab} />

          <div className="mt-4">
            <p className="text-xs text-text-3">
              {startDateStr} - Today
            </p>
            <p className="text-4xl font-extrabold text-text-1 mt-1">{data.overallPct}%</p>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            {data.mileageByType.map((m) => (
              <div key={m.type}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-text-2">{m.label}</span>
                  <span className="text-sm font-bold text-text-1 tabular-nums">{m.pct}%</span>
                </div>
                <div className="h-3 rounded-full bg-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all relative"
                    style={{
                      width: `${Math.min(100, m.pct)}%`,
                      backgroundColor: m.color,
                    }}
                  >
                    {m.pct > 100 && (
                      <div className="absolute right-1 top-0.5 flex gap-0.5">
                        <svg className="w-2 h-2 text-white/80" viewBox="0 0 8 8" fill="currentColor">
                          <path d="M1 7L4 1l3 6H1z" />
                        </svg>
                        <svg className="w-2 h-2 text-white/80" viewBox="0 0 8 8" fill="currentColor">
                          <path d="M1 7L4 1l3 6H1z" />
                        </svg>
                        <svg className="w-2 h-2 text-white/80" viewBox="0 0 8 8" fill="currentColor">
                          <path d="M1 7L4 1l3 6H1z" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Completed workouts */}
        <section className="mt-6 rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
          <h2 className="text-lg font-bold text-text-1 mb-4">Completed workouts</h2>
          <TabToggle value={workoutsTab} onChange={setWorkoutsTab} />

          <div className="mt-4">
            <p className="text-xs text-text-3">
              {startDateStr} - Today
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-4xl font-extrabold text-text-1">
                {data.completedRuns}/{data.totalPlanRuns}
              </p>
              <span className="text-sm text-text-3">plan runs</span>
            </div>
          </div>

          {/* Per-week rows */}
          <div className="mt-5 flex flex-col gap-4">
            {[...data.weeklyWorkouts].reverse().map((week) => (
              <div key={week.weekNumber} className="flex items-center justify-between">
                <span className="text-sm text-text-2 w-16 shrink-0">Week {week.weekNumber}</span>
                <div className="flex gap-1.5">
                  {week.workouts.map((wo, i) => {
                    const completed = wo.status === "completed";
                    const missed = wo.status === "missed" || wo.status === "skipped";
                    return (
                      <div
                        key={i}
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          missed
                            ? "bg-text-1"
                            : completed
                            ? "bg-elevated"
                            : "bg-elevated/50 border border-hairline"
                        }`}
                      >
                        {completed && (
                          <svg className="w-4 h-4 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                        {missed && (
                          <svg className="w-4 h-4 text-bg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                        {!completed && !missed && (
                          <div className="w-2 h-2 rounded-full bg-hairline" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
