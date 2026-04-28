"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { TodayWorkoutCard, type TodayWorkout } from "@/components/TodayWorkoutCard";
import { WeekOverview, type WeekDay } from "@/components/WeekOverview";
import { QuickStats } from "@/components/QuickStats";
import { BottomNav } from "@/components/BottomNav";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ── API response types ────────────────────────────────────────────────────────

interface TodayStats {
  plannedKm: number;
  completedKm: number;
  daysCompleted: number;
  totalDays: number;
}

interface TodayApiWorkout {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  targetKm?: number | null;
  targetDurationMinutes?: number | null;
  status: string;
  date: string;
  dayOfWeek: number;
  blocks: Array<{
    type: string;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    targetPaceSecKm?: number | null;
    reps?: number | null;
    repDistanceKm?: number | null;
  }>;
}

interface TodayApiResponse {
  activePlan: boolean;
  planId?: string;
  todayWorkout?: TodayApiWorkout | null;
  weekWorkouts?: TodayApiWorkout[];
  stats?: TodayStats;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWeekDays(weekWorkouts: TodayApiWorkout[]): WeekDay[] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now);
    date.setDate(now.getDate() + mondayOffset + i);
    date.setHours(0, 0, 0, 0);

    const workout = weekWorkouts.find((wo) => {
      const d = new Date(wo.date);
      return (
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
      );
    });

    return {
      date,
      type: workout?.type ?? null,
      status: workout?.status ?? "planned",
      targetKm: workout?.targetKm ?? null,
    };
  });
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-12 pb-28 gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="h-7 w-24 rounded bg-elevated animate-pulse" />
            <div className="h-4 w-40 rounded bg-elevated animate-pulse" />
          </div>
          <div className="w-9 h-9 rounded-full bg-elevated animate-pulse" />
        </div>
        <div className="h-4 w-32 rounded bg-elevated animate-pulse mt-2" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface h-48 animate-pulse" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface h-24 animate-pulse" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface h-20 animate-pulse" />
      </main>
      <BottomNav active="today" />
    </div>
  );
}

// ── No plan CTA ───────────────────────────────────────────────────────────────

function NoPlanCTA() {
  const today = new Date();
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-12 pb-28 gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-accent leading-none">Kadenz</h1>
            <p className="text-sm text-text-3 mt-0.5">{formatDate(today)}</p>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <section className="w-full rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-3">No active plan</p>
            <h2 className="mt-2 text-2xl font-extrabold text-text-1">Ready to train?</h2>
            <p className="mt-2 text-sm text-text-2 leading-relaxed">
              Create a personalised race plan to see today&apos;s workout here.
            </p>
            <Link
              href="/create"
              className="mt-6 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-bold text-on-accent active:scale-95 transition-transform"
            >
              Create plan
            </Link>
          </section>
        </div>
      </main>
      <BottomNav active="today" />
    </div>
  );
}

// ── Rest day card ─────────────────────────────────────────────────────────────

function RestDayCard() {
  return (
    <div
      className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 flex flex-col items-center gap-3 text-center"
      role="region"
      aria-label="Today's workout"
    >
      <div className="w-12 h-12 rounded-full bg-elevated flex items-center justify-center">
        <svg className="w-6 h-6 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v9l3 3M3 12a9 9 0 1 0 18 0A9 9 0 0 0 3 12z" />
        </svg>
      </div>
      <div>
        <p className="text-base font-semibold text-text-1">Rest day</p>
        <p className="text-sm text-text-3 mt-0.5">Recovery is part of the plan.</p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const today = new Date();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TodayApiResponse | null>(null);
  const [weekDays, setWeekDays] = useState<WeekDay[]>([]);
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [completing, setCompleting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/today");
      if (!res.ok) throw new Error("Failed to fetch");
      const json: TodayApiResponse = await res.json();
      setData(json);

      if (json.activePlan && json.weekWorkouts) {
        setWeekDays(buildWeekDays(json.weekWorkouts));
      }

      if (json.todayWorkout) {
        const wo = json.todayWorkout;
        setTodayWorkout({
          id: wo.id,
          type: wo.type,
          title: wo.title,
          description: wo.description,
          targetKm: wo.targetKm,
          targetDurationMinutes: wo.targetDurationMinutes,
          status: wo.status,
          blocks: wo.blocks,
        });
      }
    } catch {
      // Silent fail — show no plan state
      setData({ activePlan: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleComplete(actualKm?: number) {
    if (!todayWorkout || completing) return;
    setCompleting(true);

    // Optimistic update
    setTodayWorkout((prev) => prev ? { ...prev, status: "completed" } : prev);
    setWeekDays((prev) =>
      prev.map((d) => {
        const isToday =
          d.date.getDate() === today.getDate() &&
          d.date.getMonth() === today.getMonth() &&
          d.date.getFullYear() === today.getFullYear();
        return isToday ? { ...d, status: "completed" } : d;
      })
    );

    try {
      const res = await fetch(`/api/workouts/${todayWorkout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(actualKm != null ? { actualKm } : {}),
      });

      if (!res.ok) throw new Error("Failed to complete workout");

      // Refresh stats
      await loadData();
    } catch {
      // Revert optimistic update on failure
      setTodayWorkout((prev) => prev ? { ...prev, status: "planned" } : prev);
      setWeekDays((prev) =>
        prev.map((d) => {
          const isToday =
            d.date.getDate() === today.getDate() &&
            d.date.getMonth() === today.getMonth() &&
            d.date.getFullYear() === today.getFullYear();
          return isToday ? { ...d, status: "planned" } : d;
        })
      );
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <Skeleton />;
  if (!data?.activePlan) return <NoPlanCTA />;

  const isRestDay = !todayWorkout || todayWorkout.type === "rest";
  const stats = data.stats ?? { plannedKm: 0, completedKm: 0, daysCompleted: 0, totalDays: 0 };

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-12 pb-28 gap-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-accent leading-none">
              Kadenz
            </h1>
            <p className="text-sm text-text-3 mt-0.5">{formatDate(today)}</p>
          </div>
          <Link
            href="/create"
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center"
            aria-label="Create new plan"
          >
            <svg
              className="w-5 h-5 text-text-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        </header>

        {/* Section label */}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">
            Today&apos;s Workout
          </span>
        </div>

        {/* Today's workout card */}
        {isRestDay ? (
          <RestDayCard />
        ) : (
          <TodayWorkoutCard
            workout={todayWorkout!}
            onComplete={handleComplete}
            completing={completing}
          />
        )}

        {/* Week overview */}
        {weekDays.length > 0 && <WeekOverview days={weekDays} />}

        {/* Quick stats */}
        <QuickStats
          completedKm={stats.completedKm}
          plannedKm={stats.plannedKm}
          daysCompleted={stats.daysCompleted}
          totalDays={stats.totalDays}
        />
      </main>

      <BottomNav active="today" />
    </div>
  );
}
