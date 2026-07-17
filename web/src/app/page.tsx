"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  ChevronDown,
  ChevronRight,
  CalendarDays,
  Play,
  Check,
  Plus,
  Moon,
  CloudRain,
  Sunrise,
  Sunset,
  RefreshCw,
  Zap,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { PaceBadge } from "@/components/PaceChart";
import { apiFetch } from "@/lib/api";
import { WORKOUT_COLORS, workoutColor } from "@/lib/workout-colors";
import { displayTemp, displayDistance, distanceUnitLabel } from "@/lib/units";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { PullIndicator } from "@/components/ui/PullIndicator";
import { PlanAdjustmentTray } from "@/components/PlanAdjustmentTray";
import { haptic } from "@/lib/haptics";
import { readCache, writeCache } from "@/lib/client-cache";
import { mutateWithQueue, installQueueFlush } from "@/lib/offline-queue";

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
  actualKm?: number | null;
  rpe?: number | null;
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

interface StrengthSessionLite {
  id: string;
  date: string;
  type: string;
  title: string;
  status: string;
  targetDurationMinutes: number | null;
}

interface TodayApiResponse {
  activePlan: boolean;
  planId?: string;
  planName?: string;
  raceDistance?: string;
  raceDate?: string;
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
  rainPct: number;
  sunrise: string;
  sunset: string;
  location: string;
}

interface WeatherCache {
  daily: Record<string, WeatherData>; // keyed by YYYY-MM-DD
  coords: { lat: number; lon: number } | null;
  location: string;
}

const LOCATION_CACHE_KEY = "kadenz_weather_location";
const LOCATION_REFRESH_MS = 7 * 24 * 3600_000; // silent IP refresh cadence

/** Local calendar date (YYYY-MM-DD) — the forecast API keys days locally. */
function localDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

function useWeather(selectedDate: Date | null) {
  const [cache, setCache] = useState<WeatherCache>({ daily: {}, coords: null, location: "" });
  const dateKey = localDateKey(selectedDate ?? new Date());

  useEffect(() => {
    function fetchForecast(lat: number, lon: number, loc: string) {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset&current=temperature_2m,weather_code&timezone=auto&forecast_days=16`
      )
        .then((r) => r.json())
        .then((d) => {
          const daily: Record<string, WeatherData> = {};
          if (d.daily?.time) {
            for (let i = 0; i < d.daily.time.length; i++) {
              const key = d.daily.time[i];
              const sunrise = d.daily.sunrise?.[i] ?? "";
              const sunset = d.daily.sunset?.[i] ?? "";
              daily[key] = {
                temp: Math.round((d.daily.temperature_2m_max[i] + d.daily.temperature_2m_min[i]) / 2),
                code: d.daily.weather_code[i],
                rainPct: d.daily.precipitation_probability_max?.[i] ?? 0,
                sunrise: sunrise.split("T")[1]?.slice(0, 5) ?? "",
                sunset: sunset.split("T")[1]?.slice(0, 5) ?? "",
                location: loc,
              };
            }
          }
          // Override today with current data
          if (d.current) {
            const todayKey = localDateKey(new Date());
            if (daily[todayKey]) {
              daily[todayKey] = { ...daily[todayKey], temp: Math.round(d.current.temperature_2m), code: d.current.weather_code };
            }
          }
          setCache({ daily, coords: { lat, lon }, location: loc });
        })
        .catch(() => {});
    }

    if (cache.coords) return; // already fetched

    function resolveLocation(lat: number, lon: number, persist = false) {
      if (persist) {
        try { localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ lat, lon, ts: Date.now() })); } catch { /* storage unavailable */ }
      }
      // Reverse geocode for location name
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&timezone=auto`)
        .then((r) => r.json())
        .then((d) => {
          const loc = d.timezone?.split("/").pop()?.replace(/_/g, " ") ?? "Your location";
          fetchForecast(lat, lon, loc);
        })
        .catch(() => fetchForecast(lat, lon, "Your location"));
    }

    // 1. Cached position — instant, no prompt. The precise-location prompt
    // happens exactly ONCE (first ever use); afterwards the cache is
    // refreshed silently from IP geolocation in the background.
    let cached: { lat: number; lon: number; ts?: number } | null = null;
    try {
      const stored = localStorage.getItem(LOCATION_CACHE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { lat: number; lon: number; ts?: number };
        if (typeof parsed.lat === "number" && typeof parsed.lon === "number") cached = parsed;
      }
    } catch { /* storage unavailable or corrupt */ }

    async function ipLocate(): Promise<{ lat: number; lon: number } | null> {
      try {
        const geoRes = await apiFetch("/api/geo");
        if (geoRes.ok) {
          const g = await geoRes.json() as { latitude: number; longitude: number };
          if (g.latitude && g.longitude) return { lat: g.latitude, lon: g.longitude };
        }
      } catch { /* fall through */ }
      try {
        const d = await fetch("https://ipapi.co/json/").then((r) => r.json());
        if (d.latitude && d.longitude) return { lat: d.latitude, lon: d.longitude };
      } catch { /* offline */ }
      return null;
    }

    // Fresh GPS fix without any prompt — only runs when permission is already
    // granted, so the position is always current (permission persists; calling
    // getCurrentPosition again never re-prompts once granted).
    function refreshFromGps() {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolveLocation(pos.coords.latitude, pos.coords.longitude, true),
        () => { /* transient GPS failure — cached/IP data already shown */ },
        { timeout: 8000, maximumAge: 10 * 60_000 }
      );
    }

    if (cached) {
      // Show the cached fix immediately, then correct it.
      resolveLocation(cached.lat, cached.lon, false);
      if (navigator.geolocation && "permissions" in navigator) {
        navigator.permissions
          .query({ name: "geolocation" })
          .then((perm) => {
            if (perm.state === "granted") {
              refreshFromGps();
            } else if (Date.now() - (cached!.ts ?? 0) > LOCATION_REFRESH_MS) {
              // Permission not granted: fall back to a periodic IP refresh.
              ipLocate().then((loc) => {
                if (!loc) return;
                try {
                  localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...loc, ts: Date.now() }));
                } catch { /* ignore */ }
                resolveLocation(loc.lat, loc.lon, false);
              });
            }
          })
          .catch(() => { /* Permissions API unavailable — keep cached fix */ });
      }
      return;
    }

    // First ever use: one precise-location prompt, then IP fallbacks.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolveLocation(pos.coords.latitude, pos.coords.longitude, true),
        async () => {
          const loc = await ipLocate();
          if (loc) {
            try {
              localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ ...loc, ts: Date.now() }));
            } catch { /* ignore */ }
            resolveLocation(loc.lat, loc.lon, false);
          }
        },
        { timeout: 5000 }
      );
    } else {
      ipLocate().then((loc) => { if (loc) resolveLocation(loc.lat, loc.lon, false); });
    }
  }, [cache.coords]);

  return cache.daily[dateKey] ?? null;
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

const workoutDotColor: Record<string, string> = Object.fromEntries(
  Object.entries(WORKOUT_COLORS).map(([k, v]) => [k, v.solid])
);

const workoutBarColor = workoutDotColor;

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

// ── Week selector bar (sits below the NavBar large title) ──────────────────

function WeekRingSelector({
  currentWeek,
  totalWeeks,
  onWeekDropdown,
}: {
  currentWeek: number;
  totalWeeks: number;
  onWeekDropdown: () => void;
}) {
  const pct = totalWeeks > 0 ? Math.min(1, currentWeek / totalWeeks) : 0;
  const R = 8;
  const C = 2 * Math.PI * R;
  return (
    <button
      onClick={onWeekDropdown}
      className="press pointer-events-auto flex items-center gap-2"
      aria-label="Switch week"
    >
      <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90">
        <defs>
          <linearGradient id="weekring-kinetic" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--k-progress)" />
            <stop offset="100%" stopColor="var(--k-progress-2)" />
          </linearGradient>
        </defs>
        <circle cx="11" cy="11" r={R} fill="none" stroke="var(--k-elevated)" strokeWidth="3.5" />
        <circle
          cx="11" cy="11" r={R} fill="none"
          stroke="url(#weekring-kinetic)" strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <span className="text-[17px] font-bold text-text-1">Week {currentWeek}/{totalWeeks}</span>
      <span className="text-[9px] leading-none text-text-1">▼</span>
    </button>
  );
}

// ── Signature hero — the ONE gradient moment on this screen ─────────────────
// Micro-label + display numerals only (no body text on gradients — DESIGN.md).

const RACE_LABEL: Record<string, string> = {
  "5k": "5K",
  "10k": "10K",
  half: "Half marathon",
  marathon: "Marathon",
};


// Open the phone's weather app (Apple Weather on iOS; web weather elsewhere).
function openWeatherApp() {
  haptic("light");
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isIos) {
    window.location.href = "weather://";
    return;
  }
  window.open("https://www.google.com/search?q=weather", "_blank");
}

function CalendarStrip({
  days,
  strengthDays,
  selectedDate,
  onSelectDate,
  onSwipeLeft,
  onSwipeRight,
}: {
  days: DayInfo[];
  strengthDays: Record<string, string>;
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
    <div className="flex justify-between px-5" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {days.map((day, i) => {
        const hasWorkout = day.workout && day.workout.type !== "rest";
        const strengthStatus = strengthDays[day.date.toDateString()];
        const completed = day.workout?.status === "completed";
        const dotColor = day.workout?.type ? workoutDotColor[day.workout.type] : null;
        const isSelected = selectedDate && day.date.getDate() === selectedDate.getDate() && day.date.getMonth() === selectedDate.getMonth() && day.date.getFullYear() === selectedDate.getFullYear();
        // Past planned (non-rest) workout that never got completed = missed
        const dayEnd = new Date(day.date);
        dayEnd.setHours(23, 59, 59, 999);
        const missed = !!hasWorkout && !completed && dayEnd.getTime() < Date.now() && !day.isToday;

        return (
          <button key={i} onClick={() => onSelectDate(day)} className="press flex w-11 flex-col items-center gap-1 py-1">
            <span className={`text-[10px] font-semibold tracking-wide ${day.isToday ? "text-text-1" : "text-text-3"}`}>
              {DAY_LABELS[i]}
            </span>
            <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold transition-colors ${
              isSelected || (!selectedDate && day.isToday)
                ? "bg-text-1 text-bg [box-shadow:var(--k-shadow-card)]"
                : day.isToday
                  ? "bg-elevated text-text-1"
                  : missed ? "text-danger" : "text-text-2"
            }`}>
              {day.dayNum}
            </div>
            <div className="flex h-2 items-center gap-[3px]">
              {/* Strength dot first (left), Benchmark-style uniform blue gradient */}
              {strengthStatus && (
                <div
                  className="h-[7px] w-[7px] rounded-[2px]"
                  style={{
                    backgroundImage: "linear-gradient(180deg, #60A5FA, #2563EB)",
                    opacity: strengthStatus === "completed" ? 1 : 0.85,
                  }}
                />
              )}
              {hasWorkout && (
                <div
                  className="h-[7px] w-[7px] rounded-[2px]"
                  style={{
                    backgroundImage: missed || !day.workout
                      ? "none"
                      : workoutColor(day.workout.type).grad,
                    backgroundColor: missed ? "var(--k-text-3)" : (dotColor ?? "var(--k-text-3)"),
                    opacity: completed ? 1 : 0.85,
                  }}
                />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Today's Workout Card ────────────────────────────────────────────────────

const typeLabel: Record<string, string> = {
  easy: "Easy Run",
  recovery: "Recovery",
  tempo: "Tempo",
  interval: "Intervals",
  long: "Long Run",
  race: "Race",
};

function WorkoutCard({ workout, planId, onStatusChange, onOpen }: { workout: TodayApiWorkout; planId?: string; onStatusChange?: (id: string, status: string) => void; onOpen?: (w: TodayApiWorkout) => void }) {
  const router = useRouter();
  void router;
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const isCompleted = (localStatus ?? workout.status) === "completed";

  async function toggleComplete(e: React.MouseEvent) {
    e.stopPropagation(); // the card itself navigates
    if (completing) return;
    if (isCompleted) {
      // Untick: back to planned.
      if (!planId) return;
      setCompleting(true);
      setLocalStatus("planned");
      haptic("light");
      try {
        const r = await mutateWithQueue(`/api/plans/${planId}/workouts/${workout.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "planned" }),
        });
        if (!r.ok) throw new Error();
        onStatusChange?.(workout.id, "planned");
      } catch {
        setLocalStatus("completed");
        haptic("warning");
      } finally {
        setCompleting(false);
      }
      return;
    }
    setCompleting(true);
    setLocalStatus("completed"); // optimistic
    haptic("success");
    try {
      const r = await mutateWithQueue(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        body: "{}",
      });
      if (!r.ok) throw new Error();
      onStatusChange?.(workout.id, "completed");
    } catch {
      setLocalStatus(null);
      haptic("warning");
    } finally {
      setCompleting(false);
    }
  }
  const barColor = workoutBarColor[workout.type] ?? "#999";
  const dateStr = new Date(workout.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  const durationRange = workout.targetDurationMinutes
    ? `${Math.floor(Math.max(0, workout.targetDurationMinutes - 5) / 60) > 0 ? `${Math.floor(Math.max(0, workout.targetDurationMinutes - 5) / 60)}h` : ""}${Math.max(0, workout.targetDurationMinutes - 5) % 60}m - ${Math.floor((workout.targetDurationMinutes + 5) / 60) > 0 ? `${Math.floor((workout.targetDurationMinutes + 5) / 60)}h` : ""}${(workout.targetDurationMinutes + 5) % 60}m`
    : "";

  return (
    <motion.button
      onClick={() => (onOpen ? onOpen(workout) : router.push(`/workout/${workout.id}`))}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 32 }}
      className="w-full overflow-hidden k-card text-left"
    >
      <div className="flex">
        {/* Colored left strip */}
        <div className="w-1.5 shrink-0 rounded-l-[var(--radius-card)]" style={{ backgroundImage: workoutColor(workout.type).grad, backgroundColor: barColor }} />

        <div className="flex-1 p-4">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-text-1">{workout.title}</p>
              <p className="mt-0.5 text-xs text-text-3">{dateStr}{durationRange ? ` · ${durationRange}` : ""}</p>
            </div>
            {/* Complete toggle */}
            <span
              role="button"
              tabIndex={0}
              aria-label={isCompleted ? "Completed" : "Mark run complete"}
              onClick={toggleComplete}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleComplete(e as unknown as React.MouseEvent); }}
              className={`press flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 ${isCompleted ? "border-text-1 bg-text-1" : "border-hairline"} ${completing ? "opacity-50" : ""}`}
            >
              {isCompleted && <Check className="h-4 w-4 text-bg" strokeWidth={3} />}
            </span>
          </div>

          {/* Type + distance row */}
          <div className="mt-2 flex items-center gap-1.5 text-xs text-text-2">
            <span className="font-semibold">{typeLabel[workout.type] ?? workout.type}</span>
            {workout.targetKm != null && (
              <>
                <span>·</span>
                <span className="font-semibold">{displayDistance(workout.targetKm)}{distanceUnitLabel()}</span>
              </>
            )}
          </div>

          {/* Pace badge */}
          <div className="mt-1.5">
            <PaceBadge blocks={workout.blocks} workoutType={workout.type} color={barColor} />
          </div>
        </div>
      </div>
    </motion.button>
  );
}

// ── Week Overview Progress Card ──────────────────────────────────────────────

function WeekOverviewCard({
  stats,
  currentWeek,
  weekWorkouts,
  strengthDays,
}: {
  stats: TodayStats;
  currentWeek: number;
  weekWorkouts: DayInfo[];
  strengthDays: Record<string, string>;
}) {
  // One segment per workout this week — runs AND strength, Benchmark-style:
  // completed = black bar, upcoming = light gray.
  const segments: boolean[] = [];
  for (const d of weekWorkouts) {
    if (d.workout && d.workout.type !== "rest") {
      segments.push(d.workout.status === "completed");
    }
    const st = strengthDays[d.date.toDateString()];
    if (st) segments.push(st === "completed");
  }
  const done = segments.filter(Boolean).length;

  return (
    <TransitionLink href="/plan" className="press block k-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-text-1">Week {currentWeek} Overview</p>
        <ChevronRight className="h-5 w-5 text-text-3" strokeWidth={2} />
      </div>

      {/* Segmented progress bar — fills left to right regardless of which
          day's workout was completed */}
      <div className="mt-3 flex h-2 gap-1">
        {segments.map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-full"
            style={{ backgroundColor: i < done ? "var(--k-text-1)" : "var(--k-elevated)" }}
          />
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs text-text-3">
        <span>Workouts: <span className="font-semibold text-text-1">{done}/{segments.length}</span></span>
        <span>Distance: <span className="font-semibold text-text-1">{displayDistance(stats.completedKm)}/{displayDistance(stats.plannedKm)}{distanceUnitLabel().toUpperCase()}</span></span>
      </div>
    </TransitionLink>
  );
}

// ── My Insights Section ──────────────────────────────────────────────────────

function InsightsSection({ stats, weather, currentWeek, totalWeeks, weekWorkouts, weekStrength }: {
  stats: TodayStats;
  weather: WeatherData | null;
  currentWeek: number;
  totalWeeks: number;
  weekWorkouts: DayInfo[];
  weekStrength: StrengthSessionLite[];
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [pace, setPace] = useState<{ status: string; inBandPct: number | null } | null>(null);
  useEffect(() => {
    const cached = readCache<{ status: string; inBandPct: number | null }>("pace_verdict");
    if (cached) setPace(cached);
    apiFetch("/api/pace-insights")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.paceStatus) {
          const v = { status: d.paceStatus as string, inBandPct: (d.inBandPct ?? null) as number | null };
          setPace(v);
          writeCache("pace_verdict", v);
        }
      })
      .catch(() => {});
  }, []);
  const paceTitle =
    pace === null || pace.status === "no_data"
      ? "Pace insights"
      : pace.status === "on_point"
      ? "Pace on point"
      : pace.status === "ahead"
      ? "Faster than target"
      : pace.status === "review"
      ? "Pace needs review"
      : "Pace variable";
  const pct = stats.plannedKm > 0 ? Math.round((stats.completedKm / stats.plannedKm) * 100) : 0;
  // The arc takes the color of the most recent completed run (Benchmark-style).
  const lastCompletedRun = [...weekWorkouts]
    .filter((d) => d.workout?.status === "completed" && d.workout.type !== "rest")
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  const arcColor = lastCompletedRun?.workout
    ? workoutColor(lastCompletedRun.workout.type).solid
    : "#7BC232";

  // Week summary derived from weekWorkouts
  const workoutDays = weekWorkouts.filter((d) => d.workout && d.workout.type !== "rest");
  const completedWorkouts = workoutDays.filter((d) => d.workout?.status === "completed");

  // Circular progress
  const circPct = stats.plannedKm > 0 ? Math.min(1, stats.completedKm / stats.plannedKm) : 0;

  // Mileage status vs how far into the week we are (Mon-based)
  const dowIdx = (new Date().getDay() + 6) % 7; // Mon=0 … Sun=6
  const expectedPct = Math.round(((dowIdx + 1) / 7) * 100);
  const mileageTitle =
    pct >= 100 ? "Mileage complete" : pct + 15 >= expectedPct ? "Mileage on track" : "Mileage behind plan";

  // Next speed session this week (tempo / interval / race, not yet completed)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const nextSpeed = weekWorkouts.find(
    (d) =>
      d.workout &&
      ["tempo", "interval", "race"].includes(d.workout.type) &&
      d.workout.status !== "completed" &&
      d.date >= todayStart
  );
  const nextSpeedLabel = nextSpeed
    ? nextSpeed.date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : null;

  // Today's date label
  const todayLabel = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between px-5">
        <p className="text-base font-bold text-text-1">My insights</p>
        <button onClick={() => setCollapsed(!collapsed)} className="press flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-3">
          {collapsed ? "Expand" : "Collapse"}
          <ChevronDown className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-180"}`} strokeWidth={2.5} />
        </button>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-3 px-5">
          {/* Row 1: Mileage + Pace */}
          <div className="grid grid-cols-2 gap-3">
            {/* Mileage card */}
            <TransitionLink href="/insights" className="press block k-card p-4">
              <div className="flex items-start justify-between">
                <p className="text-sm font-bold text-text-1">{mileageTitle}</p>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
              </div>
              <p className="mt-1 text-xs text-text-3">{pct}% · {stats.daysCompleted}/{stats.totalDays} runs</p>
              <div className="mt-3 flex h-2 gap-1">
                <div className="rounded-full bg-[var(--k-type-easy)]" style={{ flex: Math.max(0.01, stats.completedKm) }} />
                <div className="rounded-full bg-elevated" style={{ flex: Math.max(0.01, stats.plannedKm - stats.completedKm) }} />
              </div>
            </TransitionLink>
            {/* Pace card */}
            <TransitionLink href="/pace-insights" className="press block k-card p-4">
              <div className="flex items-start justify-between">
                <p className="text-sm font-bold text-text-1">{paceTitle}</p>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
              </div>
              <p className="mt-1 text-xs text-text-3">
                {nextSpeedLabel ? `Next speed workout: ${nextSpeedLabel}` : "No speed work left this week"}
              </p>
              <div className="mt-3 flex h-2 items-center justify-center">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                  {/* Share of the last judged workouts that hit their pace band */}
                  <div
                    className="h-full rounded-full bg-[var(--k-type-easy)]"
                    style={{ width: `${Math.min(100, pace?.inBandPct ?? 0)}%` }}
                  />
                </div>
              </div>
            </TransitionLink>
          </div>

          {/* Row 2: Weather + Week summary */}
          <div className="grid grid-cols-2 gap-3">
            {/* Weather card */}
            <button
              type="button"
              onClick={openWeatherApp}
              aria-label="Open weather app"
              className="press flex min-h-[130px] flex-col justify-between rounded-[var(--radius-card)] p-4 text-left text-white shadow-[var(--k-shadow-card)]"
              style={{ background: "linear-gradient(160deg, #60A5FA 0%, #3B82F6 55%, #2563EB 100%)" }}
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/80">{todayLabel}</p>
                {weather && (
                  <div className="flex flex-col items-end gap-0.5 text-[10px] text-white/85">
                    <div className="flex items-center gap-1">
                      <CloudRain className="h-3 w-3" strokeWidth={1.5} />
                      <span>{weather.rainPct}%</span>
                    </div>
                    {weather.sunrise && (
                      <div className="flex items-center gap-1">
                        <Sunrise className="h-3 w-3" strokeWidth={1.5} />
                        <span>{weather.sunrise}</span>
                      </div>
                    )}
                    {weather.sunset && (
                      <div className="flex items-center gap-1">
                        <Sunset className="h-3 w-3" strokeWidth={1.5} />
                        <span>{weather.sunset}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                {weather && <WeatherIcon code={weather.code} className="h-7 w-7 text-white/90" />}
                <p className="text-3xl font-extrabold text-white">{weather ? `${displayTemp(weather.temp)}°` : "—"}</p>
              </div>
              <div className="mt-1">
                <p className="text-[10px] font-medium text-white/75">{weather?.location ?? "Your location"}</p>
              </div>
            </button>

            {/* Week summary card — Benchmark split: RUN and STRENGTH rows */}
            <div className="flex min-h-[130px] flex-col justify-between k-card p-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Week {currentWeek}/{totalWeeks}</p>
                <p className="mt-1 text-3xl font-extrabold text-text-1">
                  {completedWorkouts.length + weekStrength.filter((x) => x.status === "completed").length}/
                  {workoutDays.length + weekStrength.length}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Run</span>
                    <span className="text-[11px] font-bold tabular-nums text-text-1">
                      {completedWorkouts.length}/{workoutDays.length}
                    </span>
                  </div>
                  <div className="flex h-1.5 gap-1">
                    {workoutDays.map((d, i) => {
                      const done = d.workout?.status === "completed";
                      const color = workoutBarColor[d.workout!.type] ?? "#999";
                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-full"
                          style={{ backgroundColor: done ? color : "var(--k-elevated)" }}
                        />
                      );
                    })}
                    {workoutDays.length === 0 && <div className="flex-1 rounded-full bg-elevated" />}
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Strength</span>
                    <span className="text-[11px] font-bold tabular-nums text-text-1">
                      {weekStrength.filter((x) => x.status === "completed").length}/{weekStrength.length}
                    </span>
                  </div>
                  <div className="flex h-1.5 gap-1">
                    {weekStrength.map((sess) => (
                      <div
                        key={sess.id}
                        className="flex-1 rounded-full"
                        style={{
                          backgroundColor: sess.status === "completed" ? "#3B82F6" : "var(--k-elevated)",
                        }}
                      />
                    ))}
                    {weekStrength.length === 0 && <div className="flex-1 rounded-full bg-elevated" />}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Weekly distance circle */}
          <div
            role="link"
            tabIndex={0}
            onClick={() => router.push("/activities")}
            onKeyDown={(e) => { if (e.key === "Enter") router.push("/activities"); }}
            className="press flex cursor-pointer items-center gap-4 k-card p-4"
          >
            <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0">
              <circle cx="50" cy="50" r="40" fill="none" stroke="var(--k-elevated)" strokeWidth="8" />
              <circle cx="50" cy="50" r="40" fill="none" stroke={arcColor} strokeWidth="8"
                strokeDasharray={`${circPct * 251} 251`} strokeLinecap="round"
                transform="rotate(-90 50 50)" />
              <text x="50" y="47" textAnchor="middle" dominantBaseline="middle" fill="var(--k-text-1)" fontSize="16" fontWeight="800">
                {displayDistance(stats.completedKm)}/{displayDistance(stats.plannedKm)}
              </text>
              <text x="50" y="62" textAnchor="middle" dominantBaseline="middle" fill="var(--k-text-3)" fontSize="10">
                {distanceUnitLabel()}
              </text>
            </svg>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-text-1">Weekly distance</p>
              <p className="mt-0.5 text-xs text-text-3">{pct}% of goal</p>
              <div className="mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-auto !px-0 !text-xs"
                  onClick={() => router.push("/activities")}
                >
                  View activities
                  <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Rest Day ────────────────────────────────────────────────────────────────

const STRENGTH_TYPE_COLORS: Record<string, string> = {
  upper: "#93C5FD",
  upper_achilles: "#3B82F6",
  lower: "#D8B4FE",
  lower_achilles: "#A855F7",
  achilles: "#FB923C",
  full_body: "#34D399",
};

// The selected day's Kraft session, shown alongside the run.
function StrengthTodayCard({ initial, onStatusChange }: { initial: StrengthSessionLite; onStatusChange?: (id: string, status: string) => void }) {
  const router = useRouter();
  const [session, setSession] = useState<StrengthSessionLite | null>(initial);
  const [completing, setCompleting] = useState(false);
  useEffect(() => { setSession(initial); }, [initial]);

  async function toggleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!session || completing) return;
    const next = session.status === "completed" ? "planned" : "completed";
    setCompleting(true);
    const prev = session.status;
    setSession({ ...session, status: next }); // optimistic
    haptic(next === "completed" ? "success" : "light");
    try {
      const r = await mutateWithQueue(`/api/strength/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) throw new Error();
      onStatusChange?.(session.id, next);
    } catch {
      setSession((s) => (s ? { ...s, status: prev } : s));
      haptic("warning");
    } finally {
      setCompleting(false);
    }
  }

  if (!session) return null;
  const color = STRENGTH_TYPE_COLORS[session.type] ?? "#94A3B8";
  const done = session.status === "completed";

  return (
    <motion.button
      onClick={() => router.push(`/strength/session/${session.id}`)}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 450, damping: 32 }}
      className="w-full overflow-hidden k-card text-left"
    >
      <div className="flex">
        <div className="w-1.5 shrink-0 rounded-l-[var(--radius-card)]" style={{ backgroundImage: "linear-gradient(180deg, #60A5FA, #2563EB)", backgroundColor: color }} />
        <div className="flex flex-1 items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-text-1">{session.title}</p>
            <p className="mt-0.5 text-xs text-text-3">
              {new Date(session.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
              {session.targetDurationMinutes
                ? ` · ${Math.max(5, session.targetDurationMinutes - 5)}m - ${session.targetDurationMinutes + 5}m`
                : ""}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-text-2">Strength</p>
          </div>
          <span
            role="button"
            tabIndex={0}
            aria-label={done ? "Completed" : "Mark strength session complete"}
            onClick={toggleComplete}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleComplete(e as unknown as React.MouseEvent); }}
            className={`press flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 ${done ? "border-text-1 bg-text-1" : "border-hairline"} ${completing ? "opacity-50" : ""}`}
          >
            {done && <Check className="h-4 w-4 text-bg" strokeWidth={3} />}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

function RestDayCard() {
  return (
    <div className="flex flex-col items-center gap-3 k-card p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated">
        <Moon className="h-6 w-6 text-text-3" strokeWidth={1.5} />
      </div>
      <p className="text-base font-semibold text-text-1">Rest day</p>
      <p className="text-sm text-text-3">Recovery is part of the plan.</p>
    </div>
  );
}

// ── Week Selector Sheet ─────────────────────────────────────────────────────

function WeekSheet({
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
  return (
    <Sheet open={open} onClose={onClose} title="Select week">
      <div className="pb-2">
        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map((w) => {
          const isSelected = w === currentWeek;
          return (
            <button
              key={w}
              onClick={() => { onSelectWeek(w); onClose(); }}
              className={`press flex w-full items-center justify-between rounded-[var(--radius-input)] px-4 py-3 text-left ${isSelected ? "bg-accent/10" : ""}`}
            >
              <span className={`text-sm font-bold ${isSelected ? "text-accent" : "text-text-1"}`}>Week {w}</span>
              {isSelected && <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />}
            </button>
          );
        })}
        <div className="mt-1 border-t border-hairline pt-1">
          <TransitionLink
            href="/create"
            onClick={onClose}
            className="press flex w-full items-center gap-2 rounded-[var(--radius-input)] px-4 py-3 text-left"
          >
            <Plus className="h-4 w-4 text-text-3" strokeWidth={2} />
            <span className="text-sm font-semibold text-text-2">New plan</span>
          </TransitionLink>
        </div>
      </div>
    </Sheet>
  );
}

// ── No Plan CTA ──────────────────────────────────────────────────────────────

function NoPlanCTA({ error, onRetry }: { error?: boolean; onRetry?: () => void }) {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Today" large left={<ProfileAvatar />} />
      <div className="flex min-h-[70dvh] items-center justify-center px-5 pb-tabbar">
        <EmptyState
          icon={<CalendarDays className="h-10 w-10" strokeWidth={1.5} />}
          title={error ? "Couldn't load your plan" : "Ready to train?"}
          message={
            error
              ? "Something went wrong reaching Kadenz. Check your connection and try again."
              : "Create a personalised race plan to see your workouts here."
          }
          action={
            error ? (
              <Button variant="secondary" onClick={onRetry}>
                <RefreshCw className="h-4 w-4" strokeWidth={2} />
                Try again
              </Button>
            ) : (
              <TransitionLink href="/create">
                <Button variant="primary">Create plan</Button>
              </TransitionLink>
            )
          }
        />
      </div>
      <BottomNav active="today" />
    </main>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function TodaySkeleton() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Today" large left={<ProfileAvatar />} />
      <div className="flex flex-col gap-4 px-5 pb-tabbar">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        <div className="flex justify-between">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <Skeleton className="h-3 w-6" />
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-36 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-20 w-full rounded-[var(--radius-card)]" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-28 rounded-[var(--radius-card)]" />
          <Skeleton className="h-28 rounded-[var(--radius-card)]" />
        </div>
      </div>
      <BottomNav active="today" />
    </main>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TodayApiResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [days, setDays] = useState<DayInfo[]>([]);
  // Calendar-day keys of this week's strength sessions (Benchmark-style 2nd dot).
  const [strengthDays, setStrengthDays] = useState<Record<string, string>>({});
  const [weekStrength, setWeekStrength] = useState<StrengthSessionLite[]>([]);
  useEffect(() => {
    if (days.length === 0) return;
    const from = new Date(days[0].date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(days[days.length - 1].date);
    to.setHours(23, 59, 59, 999);
    const cacheKey = `strength_week:${from.toISOString().slice(0, 10)}`;
    function apply(sessions: StrengthSessionLite[]) {
      const active = sessions.filter((sess) => sess.status !== "skipped");
      setWeekStrength(active);
      const map: Record<string, string> = {};
      for (const sess of active) {
        map[new Date(sess.date).toDateString()] = sess.status;
      }
      setStrengthDays(map);
    }
    const cached = readCache<StrengthSessionLite[]>(cacheKey);
    if (cached) apply(cached);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/strength/sessions?from=${from.toISOString()}&to=${to.toISOString()}`
        );
        if (!res.ok) return;
        const sessions = (await res.json()) as StrengthSessionLite[];
        writeCache(cacheKey, sessions);
        apply(sessions);
      } catch {
        /* strip just shows run dots */
      }
    })();
  }, [days]);
  const [allWorkouts, setAllWorkouts] = useState<TodayApiWorkout[]>([]);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<TodayApiWorkout | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const weather = useWeather(selectedDate);

  const applyToday = useCallback((json: TodayApiResponse, opts?: { keepSelection?: boolean }) => {
    setData(json);
    if (json.activePlan && json.weekWorkouts && json.weekWorkouts.length > 0) {
      // Use the first workout's date to determine which week to show
      // (handles fallback when plan starts in a future week)
      const firstWorkoutDate = new Date(json.weekWorkouts[0].date);
      const monday = getMondayOfWeek(firstWorkoutDate);
      setDays(buildWeekDaysForDate(monday, json.weekWorkouts));

      if (opts?.keepSelection) {
        // Background refresh: update the selected workout's data in place
        // without yanking the user back to today.
        setSelectedWorkout((prev) =>
          prev ? json.weekWorkouts!.find((w) => w.id === prev.id) ?? prev : prev
        );
      } else if (json.todayWorkout) {
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
  }, []);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setLoadError(false);
    try {
      const res = await apiFetch("/api/today");
      if (!res.ok) throw new Error("Failed");
      const json: TodayApiResponse = await res.json();
      applyToday(json, { keepSelection: opts?.silent });
      writeCache("today", json);

      if (json.activePlan && json.planId) {
        const planRes = await apiFetch(`/api/plans/${json.planId}`);
        if (planRes.ok) {
          const plan = await planRes.json();
          const wo: TodayApiWorkout[] = [];
          for (const week of plan.weeks ?? []) for (const w of week.workouts ?? []) wo.push(w);
          setAllWorkouts(wo);
          writeCache("today_all_workouts", wo);
        }
      }
    } catch {
      setLoadError(true);
      setData({ activePlan: false });
    } finally {
      setLoading(false);
    }
  }, [applyToday]);

  // Post-run celebration: when a background refresh shows a workout that a
  // Strava sync flipped to completed (not ticked by hand here), celebrate once.
  const [celebration, setCelebration] = useState<TodayApiWorkout | null>(null);
  const [sheetWorkout, setSheetWorkout] = useState<TodayApiWorkout | null>(null);
  const locallyTicked = useRef<Set<string>>(new Set());
  const prevStatuses = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const week = data?.weekWorkouts ?? [];
    const prev = prevStatuses.current;
    let celebrated: string[] = [];
    try {
      celebrated = JSON.parse(localStorage.getItem("kadenz_celebrated") ?? "[]") as string[];
    } catch { /* fresh list */ }
    for (const w of week) {
      const was = prev.get(w.id);
      if (
        was !== undefined &&
        was !== "completed" &&
        w.status === "completed" &&
        w.type !== "rest" &&
        !locallyTicked.current.has(w.id) &&
        !celebrated.includes(w.id)
      ) {
        setCelebration(w);
        try {
          localStorage.setItem(
            "kadenz_celebrated",
            JSON.stringify([...celebrated, w.id].slice(-50))
          );
        } catch { /* best effort */ }
        break;
      }
    }
    prevStatuses.current = new Map(week.map((w) => [w.id, w.status]));
  }, [data]);

  // Optimistic status change: update stats/data instantly so Insights and the
  // week overview react before the server round-trip completes.
  const applyWorkoutStatus = useCallback((id: string, status: string) => {
    locallyTicked.current.add(id);
    const flip = <T extends { id: string; status: string }>(w: T): T =>
      w.id === id ? { ...w, status } : w;
    setAllWorkouts((prev) => prev.map(flip));
    setSelectedWorkout((prev) => (prev && prev.id === id ? { ...prev, status } : prev));
    setData((prev) => {
      if (!prev) return prev;
      const week = prev.weekWorkouts?.map(flip);
      let stats = prev.stats;
      if (week && stats) {
        const nonRest = week.filter((w) => w.type !== "rest");
        const done = nonRest.filter((w) => w.status === "completed");
        stats = {
          ...stats,
          completedKm: Math.round(done.reduce((sum, w) => sum + (w.targetKm ?? 0), 0) * 10) / 10,
          daysCompleted: done.length,
        };
      }
      return {
        ...prev,
        todayWorkout: prev.todayWorkout ? flip(prev.todayWorkout) : prev.todayWorkout,
        weekWorkouts: week,
        stats,
      };
    });
    loadData({ silent: true });
  }, [loadData]);

  const applyStrengthStatus = useCallback((id: string, status: string) => {
    setWeekStrength((prev) => {
      const next = prev.map((sess) => (sess.id === id ? { ...sess, status } : sess));
      const map: Record<string, string> = {};
      for (const sess of next) map[new Date(sess.date).toDateString()] = sess.status;
      setStrengthDays(map);
      return next;
    });
  }, []);

  // Live updates: refetch silently when the app regains focus and on a slow
  // interval while visible — webhook-synced Strava activities appear without
  // a manual reload.
  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible") loadData({ silent: true });
    }
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const interval = setInterval(refresh, 60_000);
    // Replay offline-queued ticks when connectivity returns, then re-sync.
    installQueueFlush();
    const onFlushed = () => loadData({ silent: true });
    window.addEventListener("kadenz:queue-flushed", onFlushed);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("kadenz:queue-flushed", onFlushed);
      clearInterval(interval);
    };
  }, [loadData]);

  // Instant open: paint from the last snapshot, then refresh silently.
  // Hydration happens post-mount so the first client render still matches the
  // server-rendered skeleton.
  useEffect(() => {
    const cached = readCache<TodayApiResponse>("today");
    if (cached?.activePlan) {
      applyToday(cached);
      const cachedAll = readCache<TodayApiWorkout[]>("today_all_workouts");
      if (cachedAll) setAllWorkouts(cachedAll);
      setLoading(false);
      loadData({ silent: true });
    } else {
      loadData();
    }
  }, [loadData, applyToday]);

  const { pull, refreshing } = usePullToRefresh(() => loadData({ silent: true }));
  useScrollRestoration(!loading);

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
    setCompleteError(false);
    try {
      const res = await apiFetch(`/api/workouts/${wo.id}/complete`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) {
        haptic("success");
        applyWorkoutStatus(wo.id, "completed");
      } else {
        haptic("warning");
        setCompleteError(true);
      }
    } catch {
      setCompleteError(true);
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <TodaySkeleton />;
  if (!data?.activePlan) return <NoPlanCTA error={loadError} onRetry={loadData} />;

  const currentWeek = data.currentWeek ?? 1;
  const totalWeeks = data.totalWeeks ?? 1;
  const viewingToday = weekOffset === 0 && (!selectedDate || (selectedDate.getDate() === new Date().getDate() && selectedDate.getMonth() === new Date().getMonth() && selectedDate.getFullYear() === new Date().getFullYear()));

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
  const showStickyButton = !isRestDay && activeWorkout && activeWorkout.status !== "completed";

  return (
    <main className="min-h-dvh bg-bg">
      <PullIndicator pull={pull} refreshing={refreshing} />
      <NavBar
        large={false}
        centerAlways
        title={
          <WeekRingSelector
            currentWeek={displayedWeek}
            totalWeeks={totalWeeks}
            onWeekDropdown={() => setDropdownOpen(true)}
          />
        }
        left={<ProfileAvatar />}
        right={
          <div className="flex items-center gap-2">
            {!viewingToday && (
              <button
                onClick={handleBackToToday}
                aria-label="Back to today"
                className="press flex h-9 w-9 flex-col items-center justify-center rounded-lg bg-elevated"
              >
                <CalendarDays className="mt-0.5 h-4 w-4 text-accent" strokeWidth={1.9} />
                <span className="mt-[1px] text-[9px] font-extrabold leading-none text-accent">{new Date().getDate()}</span>
              </button>
            )}
            <TransitionLink
              href="/plan/rearrange"
              aria-label="Calendar"
              className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
            >
              <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
            </TransitionLink>
          </div>
        }
      />

      <div className={`flex flex-col gap-4 pt-2 ${showStickyButton ? "pb-[calc(var(--tabbar-h)+var(--sa-bottom)+88px)]" : "pb-tabbar"}`}>
        {/* Calendar Strip */}
        <CalendarStrip
          days={days}
          strengthDays={strengthDays}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          onSwipeLeft={() => setWeekOffset((o) => Math.min(o + 1, totalWeeks - currentWeek))}
          onSwipeRight={() => setWeekOffset((o) => Math.max(o - 1, -(currentWeek - 1)))}
        />

        {/* Divider */}
        <div className="mx-5 h-px bg-hairline" />

        {/* Missed-session adjustment tray (Benchmark-style) */}
        <PlanAdjustmentTray onApplied={() => loadData({ silent: true })} />

        {/* Section header + weather */}
        <div className="flex items-center justify-between px-5">
          <p className="text-base font-bold text-text-1">Workouts</p>
          {weather && (
            <button
              type="button"
              onClick={openWeatherApp}
              aria-label="Open weather app"
              className="press flex items-center gap-1.5 text-text-2"
            >
              <WeatherIcon code={weather.code} className="h-5 w-5" />
              <span className="text-sm font-semibold tabular-nums">{displayTemp(weather.temp)}°</span>
            </button>
          )}
        </div>

        {/* Main Workout Card */}
        <div className="px-5 flex flex-col gap-3">
          {isRestDay && !strengthDays[(selectedDate ?? new Date()).toDateString()] ? (
            <RestDayCard />
          ) : (
            !isRestDay && <WorkoutCard workout={activeWorkout!} planId={data?.planId} onStatusChange={applyWorkoutStatus} onOpen={setSheetWorkout} />
          )}
          {(() => {
            const shownKey = (selectedDate ?? new Date()).toDateString();
            const sess = weekStrength.find(
              (x) => new Date(x.date).toDateString() === shownKey
            );
            return sess ? <StrengthTodayCard key={sess.id} initial={sess} onStatusChange={applyStrengthStatus} /> : null;
          })()}
        </div>

        {/* Week Overview */}
        <div className="px-5">
          <WeekOverviewCard stats={stats} currentWeek={displayedWeek} weekWorkouts={days} strengthDays={strengthDays} />
        </div>


        {/* Divider */}
        <div className="mx-5 h-px bg-hairline" />

        {/* My Insights */}
        <InsightsSection stats={stats} weather={weather} currentWeek={displayedWeek} totalWeeks={totalWeeks} weekWorkouts={days} weekStrength={weekStrength} />
      </div>

      {/* Sticky Bottom Button */}
      {showStickyButton && (
        <div
          className="fixed inset-x-0 z-40 mx-auto max-w-[430px] px-5"
          style={{ bottom: "calc(var(--tabbar-h) + var(--sa-bottom) + 12px)" }}
        >
          {completeError && (
            <p className="mb-2 text-center text-xs font-medium text-danger">
              Couldn&apos;t save your workout. Please try again.
            </p>
          )}
          <Button
            variant="primary"
            size="lg"
            full
            busy={completing}
            onClick={handleComplete}
            className="shadow-lg"
          >
            <Play className="h-4 w-4" fill="currentColor" strokeWidth={0} />
            Record workout
          </Button>
        </div>
      )}

      {/* Week Selector Sheet */}
      <WeekSheet
        open={dropdownOpen}
        onClose={() => setDropdownOpen(false)}
        totalWeeks={totalWeeks}
        currentWeek={displayedWeek}
        onSelectWeek={(week) => { setWeekOffset(week - currentWeek); setSelectedDate(null); setSelectedWorkout(null); }}
      />

      {/* Workout half-sheet (Benchmark-style card tap) */}
      <WorkoutHalfSheet
        workout={sheetWorkout}
        planId={data?.planId}
        onClose={() => setSheetWorkout(null)}
        onStatusChange={applyWorkoutStatus}
      />

      {/* Post-run celebration (sync completed a planned workout) */}
      <CelebrationSheet
        workout={celebration}
        onClose={() => setCelebration(null)}
        onSaved={() => loadData({ silent: true })}
      />

      <BottomNav active="today" />
    </main>
  );
}


// ── Post-run celebration ─────────────────────────────────────────────────────
// Shown once when a background sync marks a planned workout completed.

function CelebrationSheet({
  workout,
  onClose,
  onSaved,
}: {
  workout: TodayApiWorkout | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setRpe(workout?.rpe ?? null);
  }, [workout]);
  if (!workout) return null;

  const km = workout.actualKm ?? workout.targetKm;
  const color = workoutColor(workout.type);

  async function saveRpe(value: number) {
    if (!workout || saving) return;
    setSaving(true);
    setRpe(value);
    try {
      const res = await apiFetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rpe: value }),
      });
      if (res.ok) {
        haptic("success");
        onSaved();
      }
    } catch {
      /* chips stay for retry */
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="flex flex-col items-center gap-4 pb-2 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{ backgroundImage: color.grad }}
        >
          <Check className="h-7 w-7 text-white" strokeWidth={3} />
        </div>
        <div>
          <p className="text-lg font-bold text-text-1">Workout complete</p>
          <p className="mt-1 text-sm text-text-2">{workout.title}</p>
          <p className="mt-0.5 text-xs text-text-3">
            {new Date(workout.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
            {km ? ` · ${displayDistance(km)} ${distanceUnitLabel()}` : ""}
          </p>
        </div>
        <div className="w-full rounded-[var(--radius-input)] bg-elevated p-4 text-left">
          <p className="text-[13px] font-semibold text-text-2">
            {rpe != null ? `Effort logged: RPE ${rpe}` : "How hard did it feel? (0 = nothing, 10 = max)"}
          </p>
          <div className="mt-3 grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                type="button"
                disabled={saving}
                onClick={() => saveRpe(n)}
                style={{ touchAction: "manipulation" }}
                className={`press rounded-md py-2 text-[13px] font-bold ${
                  rpe === n ? "bg-accent text-on-accent" : "bg-surface text-text-2"
                } disabled:opacity-50`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="flex w-full gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Done
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onClose();
              window.location.href = `/workout/${workout.id}`;
            }}
          >
            View workout
          </Button>
        </div>
      </div>
    </Sheet>
  );
}


// ── Workout half-sheet ───────────────────────────────────────────────────────
// Benchmark-style: tapping the Today workout card opens a compact action sheet
// instead of navigating straight to the full preview.

function WorkoutHalfSheet({
  workout,
  planId,
  onClose,
  onStatusChange,
}: {
  workout: TodayApiWorkout | null;
  planId?: string;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!workout) return null;
  const color = workoutColor(workout.type);
  const done = workout.status === "completed";
  const dateStr = new Date(workout.date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

  async function setStatus(status: string) {
    if (!workout || busy) return;
    setBusy(true);
    try {
      const r =
        status === "completed"
          ? await mutateWithQueue(`/api/workouts/${workout.id}/complete`, { method: "PATCH", body: "{}" })
          : await mutateWithQueue(`/api/plans/${planId}/workouts/${workout.id}`, {
              method: "PATCH",
              body: JSON.stringify({ status }),
            });
      if (!r.ok) throw new Error();
      haptic(status === "completed" ? "success" : "light");
      onStatusChange(workout.id, status);
      onClose();
    } catch {
      haptic("warning");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex items-center gap-3">
          <div className="h-12 w-1.5 shrink-0 rounded-full" style={{ backgroundImage: color.grad }} />
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-text-1">{workout.title}</p>
            <p className="mt-0.5 text-xs text-text-3">
              {dateStr}
              {workout.targetKm ? ` · ${displayDistance(workout.targetKm)} ${distanceUnitLabel()}` : ""}
              {workout.targetDurationMinutes ? ` · ~${workout.targetDurationMinutes}m` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button onClick={() => { onClose(); router.push(`/workout/${workout.id}`); }}>
            View workout
          </Button>
          <Button
            variant="secondary"
            disabled={busy || (!done && false)}
            onClick={() => setStatus(done ? "planned" : "completed")}
          >
            {done ? "Mark as not done" : "Mark as complete"}
          </Button>
          {!done && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setStatus("skipped")}
            >
              Skip workout
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => { onClose(); router.push("/plan/rearrange"); }}
          >
            Move in training calendar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
