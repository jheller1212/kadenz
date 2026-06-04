"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";
import { PaceChart, PaceBadge } from "@/components/PaceChart";

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

// ── Weather ─────────────────────────────────────────────────────────────────

interface WeatherData {
  temp: number;
  code: number;
}

function useWeather() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  useEffect(() => {
    function fetchWeather(lat: number, lon: number) {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.current) setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code });
        })
        .catch(() => {});
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => {
          // Fallback: use IP-based location via Open-Meteo geocoding
          fetch("https://ipapi.co/json/")
            .then((r) => r.json())
            .then((d) => { if (d.latitude && d.longitude) fetchWeather(d.latitude, d.longitude); })
            .catch(() => {});
        },
        { timeout: 5000 }
      );
    }
  }, []);
  return weather;
}

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  // WMO weather codes -> simple icons
  if (code <= 1) {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="4" fill="currentColor" opacity={0.2} />
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.07-7.07l-1.41 1.41M6.34 17.66l-1.41 1.41m14.14 0l-1.41-1.41M6.34 6.34L4.93 4.93" />
      </svg>
    );
  }
  if (code <= 3) {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path fill="currentColor" opacity={0.15} d="M6 19a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 10 3.5 3.5 0 0118 17H6z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 19a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 10 3.5 3.5 0 0118 17H6z" />
      </svg>
    );
  }
  if (code <= 49) {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" d="M4 12h16M6 16h12M8 8h8" />
      </svg>
    );
  }
  if (code <= 69 || (code >= 80 && code <= 82)) {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path fill="currentColor" opacity={0.15} d="M6 14a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 5 3.5 3.5 0 0118 12H6z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 14a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 5 3.5 3.5 0 0118 12H6z" />
        <path strokeLinecap="round" d="M10 17v2m4-3v2m-6-1v2" />
      </svg>
    );
  }
  if (code <= 79 || (code >= 85 && code <= 86)) {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path fill="currentColor" opacity={0.15} d="M6 14a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 5 3.5 3.5 0 0118 12H6z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 14a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 5 3.5 3.5 0 0118 12H6z" />
        <circle cx="10" cy="18" r="1" fill="currentColor" /><circle cx="14" cy="16" r="1" fill="currentColor" /><circle cx="8" cy="16" r="1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path fill="currentColor" opacity={0.15} d="M6 14a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 5 3.5 3.5 0 0118 12H6z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 14a4 4 0 01-.99-7.88A5.5 5.5 0 0116.9 5 3.5 3.5 0 0118 12H6z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 14l-2 4h4l-2 4" />
    </svg>
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const workoutDotColor: Record<string, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
  race: "#FF4D4D",
};

const workoutBarColor: Record<string, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
  race: "#FF4D4D",
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

function buildWeekDaysForDate(weekMonday: Date, allWorkouts: TodayApiWorkout[]): DayInfo[] {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekMonday);
    date.setDate(weekMonday.getDate() + i);
    const workout = allWorkouts.find((wo) => {
      const d = new Date(wo.date);
      return d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate();
    }) ?? null;
    return {
      date,
      dayNum: date.getDate(),
      isToday: date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(),
      workout,
    };
  });
}

// ── 1. Top App Bar ──────────────────────────────────────────────────────────

function TopAppBar({
  currentWeek,
  totalWeeks,
  onWeekDropdown,
  viewingToday,
  onBackToToday,
}: {
  currentWeek: number;
  totalWeeks: number;
  onWeekDropdown: () => void;
  viewingToday: boolean;
  onBackToToday: () => void;
}) {
  const todayDate = new Date().getDate();
  return (
    <header className="flex items-center justify-between">
      {/* Left: Profile + notifications */}
      <div className="flex items-center gap-2.5">
        <Link href="/settings" className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center" aria-label="Profile">
          <svg className="w-4 h-4 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <circle cx="12" cy="8" r="4" />
            <path strokeLinecap="round" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        </Link>
        <button className="w-9 h-9 rounded-full flex items-center justify-center" aria-label="Notifications">
          <svg className="w-5 h-5 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </button>
      </div>

      {/* Center: Week selector */}
      <button onClick={onWeekDropdown} className="flex items-center gap-1.5 active:opacity-70 transition-opacity">
        <span className="text-base font-bold text-text-1">Week {currentWeek}/{totalWeeks}</span>
        <svg className="w-3 h-3 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Right: Back-to-today (only when not viewing today) + Calendar */}
      <div className="flex items-center gap-2">
        {!viewingToday && (
          <button onClick={onBackToToday} className="w-9 h-9 rounded-lg bg-elevated border border-hairline flex flex-col items-center justify-center relative" aria-label="Back to today">
            <svg className="w-[18px] h-[18px] text-accent absolute top-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <span className="text-[9px] font-extrabold text-accent mt-3">{todayDate}</span>
          </button>
        )}
        <Link href="/plan" className="w-9 h-9 rounded-lg bg-elevated border border-hairline flex items-center justify-center" aria-label="Calendar">
          <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </Link>
      </div>
    </header>
  );
}

// ── 2. Horizontal Calendar Strip ────────────────────────────────────────────

function CalendarStrip({
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
  function handleTouchStart(e: React.TouchEvent) { touchStartX.current = e.touches[0].clientX; }
  function handleTouchEnd(e: React.TouchEvent) {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) { diff > 0 ? onSwipeLeft() : onSwipeRight(); }
  }

  return (
    <div className="flex justify-between" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {days.map((day, i) => {
        const hasWorkout = day.workout && day.workout.type !== "rest";
        const completed = day.workout?.status === "completed";
        const dotColor = day.workout?.type ? workoutDotColor[day.workout.type] : null;
        const isSelected = selectedDate && day.date.getDate() === selectedDate.getDate() && day.date.getMonth() === selectedDate.getMonth();

        return (
          <button key={i} onClick={() => onSelectDate(day)} className="flex flex-col items-center gap-1 w-11 py-1">
            <span className={`text-[10px] font-semibold tracking-wide ${day.isToday ? "text-text-1" : "text-text-3"}`}>
              {DAY_LABELS[i]}
            </span>
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
              day.isToday ? "bg-text-1 text-bg" : isSelected ? "bg-elevated text-text-1" : "text-text-2"
            }`}>
              {day.dayNum}
            </div>
            <div className="h-2 flex items-center">
              {hasWorkout && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: completed ? "var(--k-text-3)" : (dotColor ?? "var(--k-text-3)") }} />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── 3+4. Today's Workout Section + Main Card ────────────────────────────────

const typeLabel: Record<string, string> = {
  easy: "Easy Run",
  recovery: "Recovery",
  tempo: "Tempo",
  interval: "Intervals",
  long: "Long Run",
  race: "Race",
};

function WorkoutCard({ workout }: { workout: TodayApiWorkout }) {
  const router = useRouter();
  const isCompleted = workout.status === "completed";
  const barColor = workoutBarColor[workout.type] ?? "#999";
  const dateStr = new Date(workout.date).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
  const durationRange = workout.targetDurationMinutes
    ? `${Math.floor(Math.max(0, workout.targetDurationMinutes - 5) / 60) > 0 ? `${Math.floor(Math.max(0, workout.targetDurationMinutes - 5) / 60)}h` : ""}${Math.max(0, workout.targetDurationMinutes - 5) % 60}m - ${Math.floor((workout.targetDurationMinutes + 5) / 60) > 0 ? `${Math.floor((workout.targetDurationMinutes + 5) / 60)}h` : ""}${(workout.targetDurationMinutes + 5) % 60}m`
    : "";

  return (
    <button
      onClick={() => router.push(`/workout/${workout.id}`)}
      className="w-full text-left rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden active:opacity-80 transition-opacity"
    >
      <div className="flex">
        {/* Colored left strip */}
        <div className="w-1.5 shrink-0 rounded-l-[var(--radius-card)]" style={{ backgroundColor: barColor }} />

        <div className="flex-1 p-4">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-text-1">{workout.title}</p>
              <p className="text-xs text-text-3 mt-0.5">{dateStr}{durationRange ? ` · ${durationRange}` : ""}</p>
            </div>
            {/* Checkbox */}
            <div className={`w-7 h-7 rounded-lg border-2 flex items-center justify-center shrink-0 ${isCompleted ? "bg-text-1 border-text-1" : "border-hairline"}`}>
              {isCompleted && (
                <svg className="w-4 h-4 text-bg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </div>

          {/* Type + distance row (Benchmark-style) */}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-text-2">
            <span className="font-semibold">{typeLabel[workout.type] ?? workout.type}</span>
            {workout.targetKm != null && (
              <>
                <span>·</span>
                <span className="font-semibold">{workout.targetKm}km</span>
              </>
            )}
          </div>

          {/* Pace structure chart */}
          {workout.blocks.length > 0 && (
            <div className="mt-3">
              <PaceChart
                blocks={workout.blocks}
                workoutType={workout.type}
                variant="compact"
                color={barColor}
              />
            </div>
          )}

          {/* Pace badge */}
          <div className="mt-3">
            <PaceBadge blocks={workout.blocks} workoutType={workout.type} color={barColor} />
          </div>
        </div>
      </div>
    </button>
  );
}

// ── 5. Week Overview Progress Card ──────────────────────────────────────────

function WeekOverviewCard({ stats, currentWeek, weekWorkouts }: { stats: TodayStats; currentWeek: number; weekWorkouts: DayInfo[] }) {
  const workoutTypes = weekWorkouts.filter((d) => d.workout && d.workout.type !== "rest").map((d) => d.workout!);

  return (
    <Link href="/plan" className="block rounded-[var(--radius-card)] border border-hairline bg-surface p-4 active:opacity-80 transition-opacity">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-text-1">Week {currentWeek} Overview</p>
        <svg className="w-5 h-5 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Segmented progress bar */}
      <div className="flex gap-1 mt-3 h-2">
        {workoutTypes.map((wo, i) => {
          const completed = wo.status === "completed";
          const color = workoutBarColor[wo.type] ?? "#999";
          return (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{ backgroundColor: completed ? color : "var(--k-elevated)", border: completed ? "none" : `1.5px solid ${color}` }}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-2.5 text-xs text-text-3">
        <span>Workouts: <span className="font-semibold text-text-1">{stats.daysCompleted}/{stats.totalDays}</span></span>
        <span>Distance: <span className="font-semibold text-text-1">{stats.completedKm}/{stats.plannedKm}KM</span></span>
      </div>
    </Link>
  );
}

// ── 7. My Insights Section ──────────────────────────────────────────────────

function InsightsSection({ stats, weather, currentWeek, totalWeeks, weekWorkouts }: {
  stats: TodayStats;
  weather: WeatherData | null;
  currentWeek: number;
  totalWeeks: number;
  weekWorkouts: DayInfo[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pct = stats.plannedKm > 0 ? Math.round((stats.completedKm / stats.plannedKm) * 100) : 0;

  // Week summary derived from weekWorkouts
  const workoutDays = weekWorkouts.filter((d) => d.workout && d.workout.type !== "rest");
  const completedWorkouts = workoutDays.filter((d) => d.workout?.status === "completed");

  // Circular progress
  const circPct = stats.plannedKm > 0 ? Math.min(1, stats.completedKm / stats.plannedKm) : 0;

  // Today's date label
  const todayLabel = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-base font-bold text-text-1">My insights</p>
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-1 text-xs font-semibold text-text-3 uppercase tracking-wide active:opacity-70">
          {collapsed ? "Expand" : "Collapse"}
          <svg className={`w-3 h-3 transition-transform ${collapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-3">
          {/* Row 1: Mileage + Pace */}
          <div className="grid grid-cols-2 gap-3">
            {/* Mileage card */}
            <Link href="/insights" className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 active:opacity-80 transition-opacity block">
              <div className="flex items-start justify-between">
                <p className="text-sm font-bold text-text-1">Mileage on track</p>
                <svg className="w-4 h-4 text-text-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-xs text-text-3 mt-1">{pct}% · {stats.daysCompleted}/{stats.totalDays} runs</p>
              <div className="mt-3 flex gap-1 h-2">
                <div className="rounded-full bg-[#4ADE80]" style={{ flex: Math.max(0.01, stats.completedKm) }} />
                <div className="rounded-full bg-elevated" style={{ flex: Math.max(0.01, stats.plannedKm - stats.completedKm) }} />
              </div>
            </Link>
            {/* Pace card */}
            <Link href="/pace-insights" className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 active:opacity-80 transition-opacity block">
              <div className="flex items-start justify-between">
                <p className="text-sm font-bold text-text-1">Pace on point</p>
                <svg className="w-4 h-4 text-text-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
              <p className="text-xs text-text-3 mt-1">Next speed workout: soon</p>
              <div className="mt-3 flex items-center justify-center h-2">
                <div className="w-full h-1.5 rounded-full bg-elevated overflow-hidden">
                  <div className="h-full rounded-full bg-[#4ADE80]" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            </Link>
          </div>

          {/* Row 2: Weather + Week summary */}
          <div className="grid grid-cols-2 gap-3">
            {/* Weather card */}
            <div className="rounded-[var(--radius-card)] bg-[#2A2E3A] p-4 flex flex-col justify-between min-h-[130px]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-white/60 uppercase tracking-wide">{todayLabel}</p>
                {weather && (
                  <div className="flex items-center gap-1 text-white/70 text-[10px]">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1M4.22 4.22l.707.707M18.364 18.364l.707.707M3 12H2m20 0h-1M4.927 19.073l.707-.707M18.364 5.636l.707-.707" />
                    </svg>
                    <span>—%</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                {weather && <WeatherIcon code={weather.code} className="w-7 h-7 text-white/80" />}
                <p className="text-3xl font-extrabold text-white">{weather ? `${weather.temp}°` : "—"}</p>
              </div>
              <div className="mt-2">
                <p className="text-[10px] text-white/50">Your location</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-white/50">
                  <span>↑ —</span>
                  <span>↓ —</span>
                </div>
              </div>
            </div>

            {/* Week summary card */}
            <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 flex flex-col justify-between min-h-[130px]">
              <div>
                <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide">Week {currentWeek}/{totalWeeks}</p>
                <p className="text-3xl font-extrabold text-text-1 mt-1">{completedWorkouts.length}/{workoutDays.length}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-2">
                  <svg className="w-3 h-3 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-[10px] font-semibold text-text-3 uppercase tracking-wide">Run</span>
                </div>
                <div className="flex gap-1 h-2">
                  {workoutDays.map((d, i) => {
                    const color = workoutBarColor[d.workout!.type] ?? "#999";
                    const done = d.workout?.status === "completed";
                    return (
                      <div
                        key={i}
                        className="flex-1 rounded-full"
                        style={{ backgroundColor: done ? color : "var(--k-elevated)", border: done ? "none" : `1.5px solid ${color}` }}
                      />
                    );
                  })}
                  {workoutDays.length === 0 && <div className="flex-1 rounded-full bg-elevated" />}
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Weekly distance circle */}
          <Link href="/activities" className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 flex items-center gap-4 active:opacity-80 transition-opacity">
            <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0">
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--k-elevated)" strokeWidth="8" />
              <circle cx="50" cy="50" r="40" fill="none" stroke="#4ADE80" strokeWidth="8"
                strokeDasharray={`${circPct * 251} 251`} strokeLinecap="round"
                transform="rotate(-90 50 50)" />
              <text x="50" y="47" textAnchor="middle" dominantBaseline="middle" fill="var(--k-text-1)" fontSize="16" fontWeight="800">
                {stats.completedKm}/{stats.plannedKm}
              </text>
              <text x="50" y="62" textAnchor="middle" dominantBaseline="middle" fill="var(--k-text-3)" fontSize="10">
                km
              </text>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text-1">Weekly distance</p>
              <p className="text-xs text-text-3 mt-0.5">{pct}% of goal</p>
              <div className="flex items-center gap-1 mt-2 text-xs text-accent font-semibold">
                <span>View activities</span>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        </div>
      )}
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

// ── Week Dropdown ───────────────────────────────────────────────────────────

function WeekDropdown({
  open,
  onClose,
  totalWeeks,
  currentWeek,
  onSelectWeek,
}: {
  open: boolean;
  onClose: () => void;
  totalWeeks: number;
  currentWeek: number;
  onSelectWeek: (w: number) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="absolute top-14 left-0 right-0 max-w-md mx-auto px-4" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface shadow-xl max-h-[50vh] overflow-y-auto animate-slide-up">
          <div className="p-2">
            {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => {
              const isSelected = w === currentWeek;
              return (
                <button key={w} onClick={() => { onSelectWeek(w); onClose(); }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-[var(--radius-input)] text-left transition-colors ${isSelected ? "bg-accent/10" : "active:bg-elevated"}`}>
                  <span className={`text-sm font-bold ${isSelected ? "text-accent" : "text-text-1"}`}>Week {w}</span>
                  {isSelected && <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                </button>
              );
            })}
            <div className="border-t border-hairline mt-1 pt-1">
              <Link href="/create" onClick={onClose} className="w-full flex items-center gap-2 px-4 py-3 rounded-[var(--radius-input)] text-left active:bg-elevated transition-colors">
                <svg className="w-4 h-4 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                <span className="text-sm font-semibold text-text-2">New plan</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-md mx-auto w-full px-4 pt-8 pb-28 flex flex-col gap-4">
        <div className="flex justify-between"><div className="w-20 h-9 rounded-full bg-elevated animate-pulse" /><div className="w-24 h-5 rounded bg-elevated animate-pulse" /><div className="w-9 h-9 rounded-lg bg-elevated animate-pulse" /></div>
        <div className="flex justify-between">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="flex flex-col items-center gap-1"><div className="h-3 w-6 rounded bg-elevated animate-pulse" /><div className="w-9 h-9 rounded-full bg-elevated animate-pulse" /></div>)}</div>
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface h-32 animate-pulse" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface h-20 animate-pulse" />
      </main>
      <BottomNav active="today" />
    </div>
  );
}

// ── No Plan CTA ──────────────────────────────────────────────────────────────

function NoPlanCTA() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-md mx-auto w-full px-4 pt-12 pb-28 flex flex-col items-center justify-center min-h-[80vh]">
        <section className="w-full rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
          <h1 className="text-2xl font-extrabold text-accent">Kadenz</h1>
          <h2 className="mt-3 text-xl font-extrabold text-text-1">Ready to train?</h2>
          <p className="mt-2 text-sm text-text-2 leading-relaxed">Create a personalised race plan to see your workouts here.</p>
          <Link href="/create" className="mt-6 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-bold text-on-accent active:scale-95 transition-transform">Create plan</Link>
        </section>
      </main>
      <BottomNav active="today" />
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const weather = useWeather();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TodayApiResponse | null>(null);
  const [days, setDays] = useState<DayInfo[]>([]);
  const [allWorkouts, setAllWorkouts] = useState<TodayApiWorkout[]>([]);
  const [completing, setCompleting] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<TodayApiWorkout | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch("/api/today");
      if (!res.ok) throw new Error("Failed");
      const json: TodayApiResponse = await res.json();
      setData(json);

      if (json.activePlan && json.planId) {
        const planRes = await fetch(`/api/plans/${json.planId}`);
        if (planRes.ok) {
          const plan = await planRes.json();
          const wo: TodayApiWorkout[] = [];
          for (const week of plan.weeks ?? []) for (const w of week.workouts ?? []) wo.push(w);
          setAllWorkouts(wo);
        }
      }

      if (json.activePlan && json.weekWorkouts && json.weekWorkouts.length > 0) {
        // Use the first workout's date to determine which week to show
        // (handles fallback when plan starts in a future week)
        const firstWorkoutDate = new Date(json.weekWorkouts[0].date);
        const monday = getMondayOfWeek(firstWorkoutDate);
        setDays(buildWeekDaysForDate(monday, json.weekWorkouts));

        if (json.todayWorkout) {
          setSelectedWorkout(json.todayWorkout);
          setSelectedDate(new Date(json.todayWorkout.date));
        } else {
          // Auto-select first non-rest workout
          const firstReal = json.weekWorkouts.find((w) => w.type !== "rest");
          if (firstReal) {
            setSelectedWorkout(firstReal);
            setSelectedDate(new Date(firstReal.date));
          }
        }
      }
    } catch {
      setData({ activePlan: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const workouts = allWorkouts.length > 0 ? allWorkouts : (data?.weekWorkouts ?? []);
    if (workouts.length === 0) return;
    // Base Monday: derived from first workout if plan starts in future, else today
    const baseDate = data?.weekWorkouts?.[0]?.date ? new Date(data.weekWorkouts[0].date) : new Date();
    const monday = getMondayOfWeek(baseDate);
    monday.setDate(monday.getDate() + weekOffset * 7);
    setDays(buildWeekDaysForDate(monday, workouts));
  }, [weekOffset, allWorkouts, data]);

  function handleSelectDate(day: DayInfo) {
    setSelectedDate(day.date);
    setSelectedWorkout(day.workout ?? allWorkouts.find((wo) => {
      const d = new Date(wo.date);
      return d.getFullYear() === day.date.getFullYear() && d.getMonth() === day.date.getMonth() && d.getDate() === day.date.getDate();
    }) ?? null);
  }

  function handleBackToToday() {
    setWeekOffset(0);
    setSelectedDate(new Date());
    setSelectedWorkout(data?.todayWorkout ?? null);
  }

  async function handleComplete() {
    const wo = selectedWorkout ?? data?.todayWorkout;
    if (!wo || completing) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/workouts/${wo.id}/complete`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) await loadData();
    } catch { /* silent */ } finally { setCompleting(false); }
  }

  if (loading) return <Skeleton />;
  if (!data?.activePlan) return <NoPlanCTA />;

  const currentWeek = data.currentWeek ?? 1;
  const totalWeeks = data.totalWeeks ?? 1;
  const viewingToday = weekOffset === 0 && (!selectedDate || (selectedDate.getDate() === new Date().getDate() && selectedDate.getMonth() === new Date().getMonth()));

  // When viewing a different week, show the first workout of that week if nothing selected
  const activeWorkout = selectedWorkout
    ?? (viewingToday ? data.todayWorkout : null)
    ?? days.find((d) => d.workout && d.workout.type !== "rest")?.workout
    ?? null;
  const isRestDay = !activeWorkout || activeWorkout.type === "rest";

  const viewedWeekWorkouts = days.filter((d) => d.workout).map((d) => d.workout!);
  const stats: TodayStats = weekOffset === 0
    ? (data.stats ?? { plannedKm: 0, completedKm: 0, daysCompleted: 0, totalDays: 0 })
    : {
        plannedKm: Math.round(viewedWeekWorkouts.reduce((s, w) => s + (w.targetKm ?? 0), 0) * 10) / 10,
        completedKm: Math.round(viewedWeekWorkouts.filter((w) => w.status === "completed").reduce((s, w) => s + (w.targetKm ?? 0), 0) * 10) / 10,
        daysCompleted: viewedWeekWorkouts.filter((w) => w.status === "completed").length,
        totalDays: viewedWeekWorkouts.filter((w) => w.type !== "rest").length,
      };

  const displayedWeek = currentWeek + weekOffset;

  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-md mx-auto w-full px-4 pt-8 pb-36 flex flex-col gap-4">
        {/* 1. Top App Bar */}
        <TopAppBar
          currentWeek={displayedWeek}
          totalWeeks={totalWeeks}
          onWeekDropdown={() => setDropdownOpen(true)}
          viewingToday={viewingToday}
          onBackToToday={handleBackToToday}
        />

        {/* 2. Calendar Strip */}
        <CalendarStrip
          days={days}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onSwipeLeft={() => setWeekOffset((o) => Math.min(o + 1, totalWeeks - currentWeek))}
          onSwipeRight={() => setWeekOffset((o) => Math.max(o - 1, -(currentWeek - 1)))}
        />

        {/* Divider */}
        <div className="h-px bg-hairline" />

        {/* 3. Section header + weather */}
        <div className="flex items-center justify-between">
          <p className="text-base font-bold text-text-1">Workouts</p>
          {weather && (
            <div className="flex items-center gap-1.5 text-text-2">
              <WeatherIcon code={weather.code} className="w-5 h-5" />
              <span className="text-sm font-semibold tabular-nums">{weather.temp}°</span>
            </div>
          )}
        </div>

        {/* 4. Main Workout Card */}
        {isRestDay ? <RestDayCard /> : <WorkoutCard workout={activeWorkout!} />}

        {/* 5. Week Overview */}
        <WeekOverviewCard stats={stats} currentWeek={displayedWeek} weekWorkouts={days} />

        {/* Divider */}
        <div className="h-px bg-hairline" />

        {/* 7. My Insights */}
        <InsightsSection stats={stats} weather={weather} currentWeek={displayedWeek} totalWeeks={totalWeeks} weekWorkouts={days} />
      </main>

      {/* 8. Sticky Bottom Button */}
      {!isRestDay && activeWorkout && activeWorkout.status !== "completed" && (
        <div className="fixed bottom-16 left-0 right-0 z-40 px-4 pb-4">
          <div className="max-w-md mx-auto">
            <button
              onClick={handleComplete}
              disabled={completing}
              className="w-full rounded-full bg-text-1 text-bg font-bold text-sm py-4 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60 shadow-lg"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {completing ? "Saving..." : "Record workout"}
            </button>
          </div>
        </div>
      )}

      {/* Week Dropdown */}
      <WeekDropdown
        open={dropdownOpen}
        onClose={() => setDropdownOpen(false)}
        totalWeeks={totalWeeks}
        currentWeek={displayedWeek}
        onSelectWeek={(week) => { setWeekOffset(week - currentWeek); setSelectedDate(null); setSelectedWorkout(null); }}
      />

      <BottomNav active="today" />
    </div>
  );
}
