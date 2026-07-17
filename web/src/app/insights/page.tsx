"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";

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

interface PeriodSummary {
  overallPct: number;
  totalPlanRuns: number;
  completedRuns: number;
  missedRuns: number;
  mileageByType: MileageType[];
}

interface InsightsData {
  activePlan: boolean;
  planName: string;
  startDate: string;
  weekStart: string;
  weekStatus: "complete" | "on_track" | "behind";
  behindTypes: string[];
  all: PeriodSummary;
  current: PeriodSummary;
  weeklyWorkouts: WeeklyWorkout[];
  currentWeekNum: number;
}

// ── Back button ─────────────────────────────────────────────────────────────

function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        haptic("light");
        router.back();
      }}
      className="press flex h-11 items-center gap-0.5 text-accent"
      aria-label="Back"
    >
      <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
      <span className="text-[17px]">Back</span>
    </button>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function InsightsPage() {
  useSwipeBack();
  const router = useRouter();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mileageTab, setMileageTab] = useState<"all" | "current">("current");
  const [workoutsTab, setWorkoutsTab] = useState<"all" | "current">("current");

  useEffect(() => {
    apiFetch("/api/insights")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load insights");
        return r.json();
      })
      .then(setData)
      .catch(() => setError("Couldn't load insights. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Mileage Insights" large={false} left={<BackButton />} />
        <div className="px-4 pb-tabbar flex flex-col gap-3 pt-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Mileage Insights" large={false} left={<BackButton />} />
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center pb-tabbar">
          <p className="text-[15px] text-text-2">{error}</p>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
      </main>
    );
  }

  if (!data?.activePlan) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Mileage Insights" large={false} left={<BackButton />} />
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center pb-tabbar">
          <p className="text-[15px] text-text-2">No active plan</p>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
      </main>
    );
  }

  const fmtDay = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const rangeFor = (tab: "all" | "current") =>
    tab === "current" ? `${fmtDay(data.weekStart)} - Today` : `${fmtDay(data.startDate)} - Today`;
  const mileageData = mileageTab === "current" ? data.current : data.all;
  const workoutsData = workoutsTab === "current" ? data.current : data.all;
  const shownWeeks =
    workoutsTab === "current"
      ? data.weeklyWorkouts.filter((w) => w.weekNumber === data.currentWeekNum)
      : data.weeklyWorkouts;
  const behind = data.weekStatus === "behind";

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Mileage Insights" large={false} left={<BackButton />} />

      <div className="px-4 pb-tabbar flex flex-col gap-4 pt-2">
        <h1 className="text-[22px] font-bold tracking-tight text-text-1">Mileage Insights</h1>

        {/* Status banner */}
        {behind ? (
          <div className="k-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warn/10">
                <AlertTriangle className="h-5 w-5 text-warn" strokeWidth={1.9} />
              </div>
              <div>
                <p className="text-[15px] font-bold text-text-1">
                  {data.behindTypes.length > 0
                    ? `Behind ${data.behindTypes.join(" & ").toLowerCase()} mileage`
                    : "Mileage behind plan"}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-text-2">
                  {data.behindTypes.length > 0
                    ? `Your recent ${data.behindTypes[0].toLowerCase()} mileage is below what we normally recommend at this stage of your plan. Stay consistent from now on, and you\u2019ll soon be back on track.`
                    : "You\u2019re behind on this week\u2019s planned mileage. Stay consistent from now on, and you\u2019ll soon be back on track."}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="k-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10">
                <CheckCircle2 className="h-5 w-5 text-accent" strokeWidth={1.9} />
              </div>
              <div>
                <p className="text-[15px] font-bold text-text-1">
                  {data.weekStatus === "complete" ? "Mileage complete" : "Mileage on track"}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-text-2">
                  {data.weekStatus === "complete"
                    ? "You\u2019ve completed all of this week\u2019s planned mileage. Great work!"
                    : "You\u2019re keeping up with your plan across all workout types. Keep it up!"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Completed mileage */}
        <section className="k-card p-4">
          <h2 className="text-[17px] font-bold text-text-1 mb-3">Completed mileage</h2>
          <Segmented
            options={[
              { value: "current", label: "Current period" },
              { value: "all", label: "All" },
            ]}
            value={mileageTab}
            onChange={setMileageTab}
          />

          <div className="mt-4">
            <p className="text-[13px] text-text-3">
              {rangeFor(mileageTab)}
            </p>
            <p className="mt-1 text-[34px] font-extrabold tabular-nums leading-none text-text-1">{mileageData.overallPct}%</p>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            {mileageData.mileageByType.map((m) => (
              <div key={m.type}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] text-text-2">{m.label}</span>
                  <span className="text-[13px] font-bold tabular-nums text-text-1">{m.pct}%</span>
                </div>
                <div className="h-3 rounded-full bg-elevated overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, m.pct)}%`,
                      backgroundColor: m.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Completed workouts */}
        <section className="k-card p-4">
          <h2 className="text-[17px] font-bold text-text-1 mb-3">Completed workouts</h2>
          <Segmented
            options={[
              { value: "current", label: "Current period" },
              { value: "all", label: "All" },
            ]}
            value={workoutsTab}
            onChange={setWorkoutsTab}
          />

          <div className="mt-4">
            <p className="text-[13px] text-text-3">
              {rangeFor(workoutsTab)}
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-[34px] font-extrabold tabular-nums leading-none text-text-1">
                {workoutsData.completedRuns}/{workoutsData.totalPlanRuns}
              </p>
              <span className="text-[13px] text-text-3">plan runs</span>
            </div>
          </div>

          {/* Per-week rows */}
          <div className="mt-5 flex flex-col gap-4">
            {[...shownWeeks].reverse().map((week) => (
              <div key={week.weekNumber} className="flex items-center justify-between">
                <span className="text-[13px] text-text-2 w-16 shrink-0">Week {week.weekNumber}</span>
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
                            : "bg-elevated/50"
                        }`}
                      >
                        {completed && (
                          <CheckCircle2 className="h-4 w-4 text-text-3" strokeWidth={2.2} />
                        )}
                        {missed && (
                          <X className="h-4 w-4 text-bg" strokeWidth={2.5} />
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
      </div>
    </main>
  );
}
