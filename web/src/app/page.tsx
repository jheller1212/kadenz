"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { formatPace } from "@/lib/plan-engine/pace-zones";

// ── Types ────────────────────────────────────────────────────────────────────

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
  planName?: string;
  currentWeek?: number;
  totalWeeks?: number;
  todayWorkout?: TodayApiWorkout | null;
  weekWorkouts?: TodayApiWorkout[];
  stats?: TodayStats;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const typeColors: Record<string, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
  race: "#FF4D4D",
};

const BLOCK_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  work: "Work",
  recovery: "Recovery",
  cooldown: "Cool-down",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

interface DayInfo {
  date: Date;
  dayNum: number;
  isToday: boolean;
  workout: TodayApiWorkout | null;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildWeekDaysForDate(weekMonday: Date, weekWorkouts: TodayApiWorkout[]): DayInfo[] {
  const now = new Date();

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekMonday);
    date.setDate(weekMonday.getDate() + i);

    const workout = weekWorkouts.find((wo) => {
      const d = new Date(wo.date);
      return (
        d.getFullYear() === date.getFullYear() &&
        d.getMonth() === date.getMonth() &&
        d.getDate() === date.getDate()
      );
    }) ?? null;

    return {
      date,
      dayNum: date.getDate(),
      isToday:
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear(),
      workout,
    };
  });
}

// ── Top Header (user icon, week selector, calendar) ─────────────────────────

function TopHeader({
  currentWeek,
  totalWeeks,
  viewingToday,
  onBackToToday,
}: {
  currentWeek: number;
  totalWeeks: number;
  viewingToday: boolean;
  onBackToToday: () => void;
}) {
  const todayDate = new Date().getDate();

  return (
    <header className="flex items-center justify-between px-1">
      {/* User icon → settings */}
      <Link href="/settings" className="flex items-center gap-2" aria-label="Settings">
        <div className="w-8 h-8 rounded-full bg-elevated border border-hairline flex items-center justify-center">
          <svg className="w-4 h-4 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <circle cx="12" cy="8" r="4" />
            <path strokeLinecap="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </div>
      </Link>

      {/* Week selector */}
      <Link href="/plan" className="flex items-center gap-1.5 active:opacity-70 transition-opacity">
        <span className="text-sm font-bold text-text-1">
          Week {currentWeek}/{totalWeeks}
        </span>
        <svg className="w-3 h-3 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </Link>

      {/* Right side: calendar icon + back-to-today */}
      <div className="flex items-center gap-2">
        {!viewingToday && (
          <button
            onClick={onBackToToday}
            className="w-8 h-8 rounded-lg bg-elevated border border-hairline flex items-center justify-center relative"
            aria-label="Back to today"
          >
            <span className="text-[10px] font-extrabold text-accent">{todayDate}</span>
          </button>
        )}
        <Link
          href="/plan"
          className="w-8 h-8 rounded-lg bg-elevated border border-hairline flex items-center justify-center"
          aria-label="Training calendar"
        >
          <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </Link>
      </div>
    </header>
  );
}

// ── Day Selector Strip (swipeable) ──────────────────────────────────────────

function DayStrip({
  days,
  selectedDate,
  onSelectDate,
  onSwipeLeft,
  onSwipeRight,
}: {
  days: DayInfo[];
  selectedDate: Date | null;
  onSelectDate: (d: DayInfo) => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}) {
  const touchStartX = useRef(0);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) onSwipeLeft();  // swiped left → next week
      else onSwipeRight();           // swiped right → prev week
    }
  }

  return (
    <div
      className="flex justify-between px-1 py-2"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      role="list"
      aria-label="Week days"
    >
      {days.map((day, i) => {
        const hasWorkout = day.workout && day.workout.type !== "rest";
        const completed = day.workout?.status === "completed";
        const color = day.workout?.type ? typeColors[day.workout.type] : null;
        const isSelected = selectedDate &&
          day.date.getDate() === selectedDate.getDate() &&
          day.date.getMonth() === selectedDate.getMonth();

        return (
          <button
            key={i}
            className="flex flex-col items-center gap-1 w-11"
            onClick={() => onSelectDate(day)}
            role="listitem"
            aria-label={`${DAY_LABELS_SHORT[i]} ${day.dayNum}`}
          >
            <span className={`text-[10px] font-semibold ${day.isToday ? "text-accent" : "text-text-3"}`}>
              {DAY_LABELS_SHORT[i]}
            </span>
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                day.isToday
                  ? "bg-text-1 text-bg"
                  : isSelected
                  ? "bg-elevated text-text-1"
                  : "text-text-2"
              }`}
            >
              {day.dayNum}
            </div>
            {/* Workout dot */}
            <div className="h-2 flex items-center justify-center">
              {hasWorkout && completed && (
                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
              )}
              {hasWorkout && !completed && (
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color ?? "#FAFAFA" }} />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Today's Workout Card ────────────────────────────────────────────────────

function WorkoutCard({
  workout,
}: {
  workout: TodayApiWorkout;
  onComplete: () => void;
  completing: boolean;
}) {
  const router = useRouter();
  const isCompleted = workout.status === "completed";
  const color = typeColors[workout.type] ?? "#FAFAFA";
  const dateStr = new Date(workout.date).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });

  return (
    <button
      className="w-full text-left rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden active:bg-elevated/30 transition-colors"
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
      onClick={() => router.push(`/workout/${workout.id}`)}
    >
      <div className="px-4 py-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-text-1">{workout.title}</p>
          <p className="text-xs text-text-3 mt-0.5">{dateStr} · {workout.targetDurationMinutes ? `${workout.targetDurationMinutes - 5}m - ${workout.targetDurationMinutes + 5}m` : ""}</p>
          <p className="text-xs text-text-2 mt-1.5">
            {workout.type.charAt(0).toUpperCase() + workout.type.slice(1)} · {workout.targetKm ?? "—"}km
          </p>
        </div>

        {/* Completion circle */}
        {isCompleted ? (
          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full border-2 border-hairline shrink-0 mt-0.5" />
        )}
      </div>
    </button>
  );
}

// ── Week Overview Link ──────────────────────────────────────────────────────

function WeekOverviewLink({ stats, currentWeek }: { stats: TodayStats; currentWeek: number }) {
  return (
    <Link
      href="/plan"
      className="rounded-[var(--radius-card)] border border-hairline bg-surface px-4 py-3.5 flex items-center justify-between active:bg-elevated/50 transition-colors"
    >
      <div>
        <p className="text-sm font-bold text-text-1">Week {currentWeek} Overview</p>
        <p className="text-xs text-text-3 mt-0.5">
          Workouts: <span className="font-semibold text-text-2">{stats.daysCompleted}/{stats.totalDays}</span>
          <span className="mx-2">·</span>
          Distance: <span className="font-semibold text-text-2">{stats.completedKm}/{stats.plannedKm}km</span>
        </p>
      </div>
      <svg className="w-5 h-5 text-text-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// ── Insights Cards ──────────────────────────────────────────────────────────

function InsightsCards({ stats }: { stats: TodayStats }) {
  const pct = stats.plannedKm > 0 ? Math.round((stats.completedKm / stats.plannedKm) * 100) : 0;

  return (
    <div>
      <p className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-3">My insights</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
          <p className="text-sm font-semibold text-text-1">Mileage</p>
          <p className="text-xs text-text-3 mt-1">{pct}% · {stats.completedKm}/{stats.plannedKm} km</p>
          <div className="mt-2 h-1.5 rounded-full bg-elevated overflow-hidden">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
          <p className="text-sm font-semibold text-text-1">Workouts</p>
          <p className="text-xs text-text-3 mt-1">{stats.daysCompleted}/{stats.totalDays} done</p>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: stats.totalDays }).map((_, i) => (
              <div key={i} className={`h-1.5 flex-1 rounded-full ${i < stats.daysCompleted ? "bg-accent" : "bg-elevated"}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Rest Day ────────────────────────────────────────────────────────────────

function RestDayCard() {
  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6 flex flex-col items-center gap-3 text-center">
      <div className="w-12 h-12 rounded-full bg-elevated flex items-center justify-center">
        <svg className="w-6 h-6 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v9l3 3M3 12a9 9 0 1 0 18 0A9 9 0 0 0 3 12z" />
        </svg>
      </div>
      <p className="text-base font-semibold text-text-1">Rest day</p>
      <p className="text-sm text-text-3">Recovery is part of the plan.</p>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-8 pb-28 gap-4">
        <div className="flex justify-between">
          <div className="w-8 h-8 rounded-full bg-elevated animate-pulse" />
          <div className="h-5 w-24 rounded bg-elevated animate-pulse" />
          <div className="w-8 h-8 rounded-lg bg-elevated animate-pulse" />
        </div>
        <div className="flex justify-between px-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="h-3 w-6 rounded bg-elevated animate-pulse" />
              <div className="w-9 h-9 rounded-full bg-elevated animate-pulse" />
            </div>
          ))}
        </div>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface h-36 animate-pulse" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface h-16 animate-pulse" />
      </main>
      <BottomNav active="today" />
    </div>
  );
}

// ── No Plan CTA ──────────────────────────────────────────────────────────────

function NoPlanCTA() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-12 pb-28 items-center justify-center">
        <section className="w-full rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
          <h1 className="text-2xl font-extrabold text-accent">Kadenz</h1>
          <h2 className="mt-3 text-xl font-extrabold text-text-1">Ready to train?</h2>
          <p className="mt-2 text-sm text-text-2 leading-relaxed">
            Create a personalised race plan to see your workouts here.
          </p>
          <Link
            href="/create"
            className="mt-6 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-bold text-on-accent active:scale-95 transition-transform"
          >
            Create plan
          </Link>
        </section>
      </main>
      <BottomNav active="today" />
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TodayApiResponse | null>(null);
  const [days, setDays] = useState<DayInfo[]>([]);
  const [completing, setCompleting] = useState(false);

  // Track which week we're viewing (offset from current week)
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<TodayApiWorkout | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/today");
      if (!res.ok) throw new Error("Failed to fetch");
      const json: TodayApiResponse = await res.json();
      setData(json);
      if (json.activePlan && json.weekWorkouts) {
        const monday = getMondayOfWeek(new Date());
        setDays(buildWeekDaysForDate(monday, json.weekWorkouts));
        // Set today's workout as selected
        if (json.todayWorkout) {
          setSelectedWorkout(json.todayWorkout);
          setSelectedDate(new Date());
        }
      }
    } catch {
      setData({ activePlan: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // When week offset changes, rebuild the day strip
  useEffect(() => {
    if (!data?.weekWorkouts) return;
    const today = new Date();
    const monday = getMondayOfWeek(today);
    monday.setDate(monday.getDate() + weekOffset * 7);
    setDays(buildWeekDaysForDate(monday, data.weekWorkouts));
  }, [weekOffset, data]);

  function handleSelectDate(day: DayInfo) {
    setSelectedDate(day.date);
    setSelectedWorkout(day.workout);
  }

  function handleBackToToday() {
    setWeekOffset(0);
    setSelectedDate(new Date());
    if (data?.todayWorkout) {
      setSelectedWorkout(data.todayWorkout);
    }
  }

  async function handleComplete() {
    const wo = selectedWorkout ?? data?.todayWorkout;
    if (!wo || completing) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/workouts/${wo.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error("Failed");
      await loadData();
    } catch {
      // silent
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <Skeleton />;
  if (!data?.activePlan) return <NoPlanCTA />;

  const activeWorkout = selectedWorkout ?? data.todayWorkout;
  const isRestDay = !activeWorkout || activeWorkout.type === "rest";
  const stats = data.stats ?? { plannedKm: 0, completedKm: 0, daysCompleted: 0, totalDays: 0 };
  const currentWeek = data.currentWeek ?? 1;
  const totalWeeks = data.totalWeeks ?? 1;
  const viewingToday = weekOffset === 0 && (
    !selectedDate ||
    (selectedDate.getDate() === new Date().getDate() &&
     selectedDate.getMonth() === new Date().getMonth())
  );

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-8 pb-28 gap-4">
        {/* Top header: user icon, Week X/Y, calendar */}
        <TopHeader
          currentWeek={currentWeek + weekOffset}
          totalWeeks={totalWeeks}
          viewingToday={viewingToday}
          onBackToToday={handleBackToToday}
        />

        {/* Swipeable day selector */}
        <DayStrip
          days={days}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onSwipeLeft={() => setWeekOffset((o) => Math.min(o + 1, totalWeeks - currentWeek))}
          onSwipeRight={() => setWeekOffset((o) => Math.max(o - 1, -(currentWeek - 1)))}
        />

        {/* Divider */}
        <div className="h-px bg-hairline -mt-2" />

        {/* Today's workout section label */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">
            {viewingToday ? "Today\u2019s workout" : selectedDate?.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          </span>
        </div>

        {/* Workout card */}
        {isRestDay ? (
          <RestDayCard />
        ) : (
          <WorkoutCard
            workout={activeWorkout!}
            onComplete={handleComplete}
            completing={completing}
          />
        )}

        {/* Week overview link */}
        <WeekOverviewLink stats={stats} currentWeek={currentWeek + weekOffset} />

        {/* Insights */}
        <InsightsCards stats={stats} />
      </main>

      <BottomNav active="today" />
    </div>
  );
}
