"use client";

import React, { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  CalendarClock,
  SlidersHorizontal,
  Dumbbell,
  Clock,
  Trash2,
  X,
  AlertTriangle,
  Check,
  SkipForward,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { Segmented } from "@/components/ui/Segmented";
import { EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { predictRaceTime, RACE_DISTANCES_M } from "@/lib/plan-engine/vdot";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedWorkout,
  GeneratedBlock,
  WeekPhase,
  WorkoutType,
} from "@/lib/plan-engine/types";

// ── API response → GeneratedPlan adapter ──────────────────────────────────────

// The API returns DB rows (ISO date strings, extra fields like id/status).
// We adapt them to GeneratedPlan so existing components work unchanged.
function adaptApiPlan(raw: Record<string, unknown>): GeneratedPlan {
  return {
    name: raw.name as string,
    raceDistance: raw.raceDistance as GeneratedPlan["raceDistance"],
    goalTimeSeconds: raw.goalTimeSeconds as number,
    vdot: raw.vdot as number,
    startDate: new Date(raw.startDate as string),
    raceDate: new Date(raw.raceDate as string),
    planLengthWeeks: raw.planLengthWeeks as number,
    daysPerWeek: raw.daysPerWeek as number,
    preferredLongRunDay: (raw.preferredLongRunDay as number) ?? 6,
    currentWeeklyKm: (raw.currentWeeklyKm as number) ?? 0,
    trainingVolume: raw.trainingVolume as GeneratedPlan["trainingVolume"],
    trainingDifficulty: raw.trainingDifficulty as GeneratedPlan["trainingDifficulty"],
    longRunCapKm: (raw.longRunCapKm as number) ?? 0,
    easyRunMinKm: (raw.easyRunMinKm as number) ?? 0,
    hillyArea: (raw.hillyArea as boolean) ?? false,
    weeks: ((raw.weeks as Record<string, unknown>[]) ?? []).map((week) => ({
      weekNumber: week.weekNumber as number,
      phase: week.phase as GeneratedWeek["phase"],
      type: week.type as GeneratedWeek["type"],
      targetKm: (week.targetKm as number) ?? 0,
      workouts: ((week.workouts as Record<string, unknown>[]) ?? []).map((wo) => ({
        id: wo.id as string | undefined,
        status: wo.status as string | undefined,
        dayOfWeek: wo.dayOfWeek as number,
        date: new Date(wo.date as string),
        type: wo.type as GeneratedWorkout["type"],
        title: wo.title as string,
        description: wo.description as string | undefined,
        targetKm: wo.targetKm as number | undefined,
        targetDurationMinutes: wo.targetDurationMinutes as number | undefined,
        sortOrder: wo.sortOrder as number,
        blocks: ((wo.blocks as Record<string, unknown>[]) ?? []).map((b) => ({
          sortOrder: b.sortOrder as number,
          type: b.type as GeneratedBlock["type"],
          durationMinutes: b.durationMinutes as number | undefined,
          distanceKm: b.distanceKm as number | undefined,
          targetPaceSecKm: b.targetPaceSecKm as number | undefined,
          minPaceSecKm: b.minPaceSecKm as number | undefined,
          maxPaceSecKm: b.maxPaceSecKm as number | undefined,
          reps: b.reps as number | undefined,
          repDistanceKm: b.repDistanceKm as number | undefined,
          repRestSeconds: b.repRestSeconds as number | undefined,
        })),
      })),
    })),
  };
}

// ── Design helpers ────────────────────────────────────────────────────────────

const PHASE_BADGE: Record<WeekPhase, string> = {
  base:  "bg-[#1A3A2A] text-[#4ADE80]",
  build: "bg-[#3A2A00] text-[#FFB547]",
  peak:  "bg-[#2A1A3A] text-[#C084FC]",
  taper: "bg-[#1A2A3A] text-[#60A5FA]",
};

const WORKOUT_BAR_COLOR: Record<WorkoutType, string> = {
  easy:     "#7BC232",
  recovery: "#7BC232",
  long:     "#8655F0",
  tempo:    "#F2A113",
  interval: "#E0402E",
  race:     "#FF4D4D",
  rest:     "#2A2A2E",
};

/** Darken a #RRGGBB hex color by `amount` (0–1). */
function darken(hex: string, amount = 0.2): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Subtle vertical gradient spine for run cards (type color → 20% darker). */
function runSpine(type: WorkoutType): string {
  const c = WORKOUT_BAR_COLOR[type];
  return `linear-gradient(180deg, ${c}, ${darken(c)})`;
}

// Strength is uniformly blue (Benchmark-style), regardless of session type.
const STRENGTH_SPINE = "linear-gradient(180deg, #60A5FA, #2563EB)";

/** "13 Jul" — Benchmark-style day-first short date. */
function formatDayMonth(d: Date) {
  return `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}`;
}

/** Monday of the week containing `d` (weeks start Monday in Kadenz). */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // 0=Sun
  const offset = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + offset);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The 7 Mon–Sun dates of a plan week (empty if the week has no workouts). */
function weekDaysFor(plan: GeneratedPlan, weekNum: number): Date[] {
  const wk = plan.weeks.find((w) => w.weekNumber === weekNum) ?? plan.weeks[0];
  const first = wk?.workouts[0]?.date;
  if (!first) return [];
  const ws = mondayOf(first);
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
}

// ── Strength (folded into the unified day calendar) ───────────────────────────

type SessionType =
  | "upper"
  | "lower"
  | "upper_achilles"
  | "achilles"
  | "lower_achilles"
  | "full_body";

interface StrengthSession {
  id: string;
  date: string;
  type: SessionType;
  title: string;
  status: string;
  targetDurationMinutes?: number | null;
}

interface Violation {
  code: string;
  severity: "error" | "warn";
  message: string;
}

// Family-aligned colors (match the Kraft picker): upper = blues, lower =
// purples, standalone Achilles orange, full body green.
const STRENGTH_META: Record<SessionType, { label: string; color: string }> = {
  upper: { label: "Upper", color: "#93C5FD" },
  upper_achilles: { label: "Upper + Achilles", color: "#3B82F6" },
  lower: { label: "Lower", color: "#D8B4FE" },
  lower_achilles: { label: "Lower + Achilles", color: "#A855F7" },
  achilles: { label: "Achilles", color: "#FB923C" },
  full_body: { label: "Full Body", color: "#34D399" },
};

// Sessions can carry types this UI hasn't heard of yet — never crash the
// calendar over an unknown label.
function strengthMeta(type: string): { label: string; color: string } {
  return (
    STRENGTH_META[type as SessionType] ?? { label: type, color: "#94A3B8" }
  );
}

function formatFullDate(d: Date) {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function isCurrentWeek(week: GeneratedWeek): boolean {
  const now = new Date();
  const dates = week.workouts.map((w) => w.date);
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return false;
  return first <= now && now <= last;
}

function isPastWeek(week: GeneratedWeek): boolean {
  const last = week.workouts[week.workouts.length - 1]?.date;
  if (!last) return false;
  const end = new Date(last);
  end.setHours(23, 59, 59, 999);
  return end < new Date();
}

// ── Completed badge (Benchmark-style check on the card's top-right) ───────────────

function CompletedBadge() {
  return (
    <span
      className="absolute right-1 top-1 z-10 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-[#0B0C0E]"
      aria-label="Completed"
    >
      <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
    </span>
  );
}

// ── Run card (long-press to drag, tap to open) ────────────────────────────────

function RunCard({
  workout,
  onOpen,
  dimmed,
}: {
  workout: GeneratedWorkout;
  onOpen: () => void;
  dimmed: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `run:${workout.id}`,
  });

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      onClick={() => {
        haptic("light");
        onOpen();
      }}
      className={`press relative flex w-full items-stretch overflow-hidden rounded-[var(--radius-input)] bg-elevated text-left touch-manipulation select-none ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      {workout.status === "completed" && <CompletedBadge />}
      {/* Colored type accent spine */}
      <span
        className="w-[3px] shrink-0"
        style={{ backgroundImage: runSpine(workout.type) }}
      />
      <span className="min-w-0 flex-1 px-2 py-2">
        <span className="block truncate text-[15px] font-bold leading-tight text-text-1">
          {workout.title}
        </span>
        {(workout.targetKm != null || workout.targetDurationMinutes != null) && (
          <span className="mt-0.5 flex items-center gap-1 text-[12px] text-text-3 tabular-nums">
            {workout.targetKm != null && <span>{workout.targetKm} km</span>}
            {workout.targetKm == null && workout.targetDurationMinutes != null && (
              <>
                <Clock className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span>{formatDuration(workout.targetDurationMinutes)}</span>
              </>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

// ── Strength card (long-press to drag, tap to open) ───────────────────────────

function StrengthCard({
  session,
  onOpen,
  dimmed,
}: {
  session: StrengthSession;
  onOpen: () => void;
  dimmed: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `strength:${session.id}`,
  });
  const meta = strengthMeta(session.type);

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      onClick={() => {
        haptic("light");
        onOpen();
      }}
      className={`press relative flex w-full items-stretch overflow-hidden rounded-[var(--radius-input)] bg-elevated text-left touch-manipulation select-none ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      {session.status === "completed" && <CompletedBadge />}
      {/* Blue gradient spine — strength is uniformly blue */}
      <span className="w-[3px] shrink-0" style={{ backgroundImage: STRENGTH_SPINE }} />
      <span className="min-w-0 flex-1 px-2 py-2">
        <span className="block truncate text-[15px] font-bold leading-tight text-text-1">
          {session.title || `${meta.label} Strength`}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12px] text-text-3">
          <Dumbbell className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span>
            {session.targetDurationMinutes
              ? `${Math.max(5, session.targetDurationMinutes - 5)}m – ${session.targetDurationMinutes + 5}m`
              : "25m – 35m"}
          </span>
        </span>
      </span>
    </button>
  );
}

// ── Day row (droppable) ───────────────────────────────────────────────────────

function DayRow({
  dayIdx,
  date,
  run,
  strength,
  onOpenRun,
  onOpenStrength,
  onAddStrength,
  dimmed,
}: {
  dayIdx: number;
  date: Date;
  run: GeneratedWorkout | undefined;
  strength: StrengthSession | undefined;
  onOpenRun: (workout: GeneratedWorkout) => void;
  onOpenStrength: (session: StrengthSession) => void;
  onAddStrength: (date: Date) => void;
  dimmed: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date.getTime()}` });
  const isToday = sameDay(date, new Date());
  const isRest = !run || run.type === "rest";
  const isRestDay = isRest && !strength;

  return (
    <div
      ref={setNodeRef}
      className={`flex items-start gap-2 rounded-[var(--radius-input)] px-1 py-1 transition-colors ${
        isOver ? "bg-accent/10 outline outline-1 outline-accent/50" : ""
      }`}
    >
      {/* Day gutter */}
      <div className="w-9 shrink-0 pt-0.5 text-center">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-3">
          {DOW[dayIdx]}
        </p>
        {isToday ? (
          <span className="mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#0B0C0E] text-[13px] font-bold tabular-nums text-white">
            {date.getDate()}
          </span>
        ) : (
          <p className="text-[15px] font-bold tabular-nums text-text-1">
            {date.getDate()}
          </p>
        )}
      </div>

      {/* Activity cells — strength left, run right */}
      {isRestDay ? (
        <div className={`flex min-h-[36px] flex-1 items-center px-1 ${dimmed ? "opacity-50" : ""}`}>
          <span className="text-[13px] text-text-3">Rest Day</span>
        </div>
      ) : (
        <div className="grid min-w-0 flex-1 grid-cols-2 items-stretch gap-1.5">
          {strength ? (
            <StrengthCard
              session={strength}
              onOpen={() => onOpenStrength(strength)}
              dimmed={dimmed}
            />
          ) : !isRest ? (
            <button
              onClick={() => onAddStrength(date)}
              className="press flex items-center justify-center gap-1 self-stretch rounded-[var(--radius-input)] border border-dashed border-hairline text-[12px] font-medium text-text-3"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              Add
            </button>
          ) : (
            <span />
          )}

          {run && !isRest ? (
            <RunCard workout={run} onOpen={() => onOpenRun(run)} dimmed={dimmed} />
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}

// ── Plan header ───────────────────────────────────────────────────────────────

const RACE_SHORT: Record<GeneratedPlan["raceDistance"], string> = {
  "5k": "5K",
  "10k": "10K",
  half: "Half",
  marathon: "26.2",
};

function formatRaceTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${m}:${String(ss).padStart(2, "0")}`;
}

function EstimatedRaceTime({ plan }: { plan: GeneratedPlan }) {
  if (!plan.vdot) return null;
  const distanceM = RACE_DISTANCES_M[plan.raceDistance];
  if (!distanceM) return null;
  const predicted = predictRaceTime(plan.vdot, distanceM);
  const fast = predicted * 0.98;
  const slow = predicted * 1.03;
  const weeksLeft = Math.max(
    0,
    Math.ceil((new Date(plan.raceDate).getTime() - Date.now()) / (7 * 24 * 3600 * 1000))
  );

  return (
    <div className="mt-4 rounded-[var(--radius-input)] bg-elevated px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">
        Estimated race time
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <p className="text-[20px] font-extrabold tabular-nums text-text-1">
          {formatRaceTime(fast)} – {formatRaceTime(slow)}
        </p>
        <span className="shrink-0 text-[12px] font-semibold text-text-2">
          {weeksLeft > 0 ? `in ${weeksLeft} ${weeksLeft === 1 ? "week" : "weeks"}` : "race week"}
        </span>
      </div>
    </div>
  );
}

function PlanHeader({ plan }: { plan: GeneratedPlan }) {
  const totalKm = plan.weeks.reduce((sum, w) => sum + w.targetKm, 0);
  const maxKm = Math.max(...plan.weeks.map((w) => w.targetKm));

  return (
    <section className="k-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-text-3">
            Active plan
          </p>
          <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-tight text-text-1 truncate">
            {plan.name}
          </h1>
          <p className="mt-1 text-[13px] text-text-2">
            Race: {formatFullDate(plan.raceDate)}
          </p>
        </div>
        <div className="shrink-0 w-14 h-14 rounded-2xl bg-accent flex items-center justify-center text-center text-xs font-black text-on-accent leading-tight px-1">
          {RACE_SHORT[plan.raceDistance]}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Weeks", value: String(plan.planLengthWeeks) },
          { label: "Total km", value: String(Math.round(totalKm)) },
          { label: "Days/wk", value: String(plan.daysPerWeek) },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-[var(--radius-input)] bg-elevated px-2 py-3"
          >
            <p className="text-[10px] uppercase tracking-wider text-text-3">
              {label}
            </p>
            <p className="mt-0.5 text-base font-extrabold text-text-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Estimated race time (VDOT prediction, Benchmark-style) */}
      <EstimatedRaceTime plan={plan} />

      {/* Micro volume chart */}
      <div className="mt-4 flex gap-0.5 items-end h-8">
        {plan.weeks.map((week) => {
          const pct = maxKm > 0 ? (week.targetKm / maxKm) * 100 : 0;
          const color =
            week.type === "race"
              ? "#FF4D4D"
              : week.type === "deload"
              ? "#FFB547"
              : "var(--k-progress)";
          return (
            <div
              key={week.weekNumber}
              className="flex-1 rounded-sm transition-all"
              style={{
                height: `${Math.max(pct, 8)}%`,
                backgroundColor: color,
                opacity: 0.65,
              }}
              title={`Week ${week.weekNumber}: ${week.targetKm} km`}
            />
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-text-3 text-right">
        Volume progression
      </p>
    </section>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function PlanEmptyState() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Training calendar" large left={<ProfileAvatar />} />
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-tabbar">
        <EmptyState
          icon={
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          }
          title="Build your plan"
          message="Create a personalised race plan and your week-by-week training schedule will appear here."
          action={
            <TransitionLink href="/create">
              <Button size="lg">Create plan</Button>
            </TransitionLink>
          }
        />
      </div>
      <BottomNav active="plan" />
    </main>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Training calendar" large left={<ProfileAvatar />} />
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-tabbar">
        <div className="h-16 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
        <div className="h-24 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
        ))}
      </div>
      <BottomNav active="plan" />
    </main>
  );
}

// ── Main plan page (continuous calendar) ─────────────────────────────────────

function PlanPageInner() {
  const searchParams = useSearchParams();
  const planId = searchParams.get("id");

  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolvedPlanId, setResolvedPlanId] = useState<string | null>(null);

  // Strength sessions for the whole plan window.
  const [sessions, setSessions] = useState<StrengthSession[]>([]);
  const [strengthBusy, setStrengthBusy] = useState(false);

  // Unified drag state + transient error note.
  const [activeDrag, setActiveDrag] = useState<
    | { kind: "run"; workout: GeneratedWorkout }
    | { kind: "strength"; session: StrengthSession }
    | null
  >(null);
  const [errorNote, setErrorNote] = useState<string | null>(null);

  // "Move to another day" picker (accessible alternative to dragging).
  const [movePicker, setMovePicker] = useState<
    | { kind: "run"; workout: GeneratedWorkout }
    | { kind: "strength"; session: StrengthSession }
    | null
  >(null);

  // Half-screen detail sheet (tap a card to open).
  const [detailSheet, setDetailSheet] = useState<
    | { kind: "run"; workout: GeneratedWorkout }
    | { kind: "strength"; session: StrengthSession }
    | null
  >(null);
  const [skipBusy, setSkipBusy] = useState(false);

  // Add-strength sheet state.
  const [addDate, setAddDate] = useState<Date | null>(null);
  const [addType, setAddType] = useState<SessionType>("lower_achilles");
  const [violations, setViolations] = useState<Violation[]>([]);
  const [addBusy, setAddBusy] = useState(false);

  // Auto-scroll to the current week on first render of the loaded plan.
  const currentWeekRef = useRef<HTMLElement | null>(null);
  const didAutoScroll = useRef(false);

  // DnD sensors — long-press (250ms) so taps open the sheet and scrolling
  // isn't hijacked; the whole card is the drag surface.
  // MouseSensor + TouchSensor, NOT PointerSensor: on iOS the pointer sensor
  // claims the gesture but cannot preventDefault the scroll pan, so drags
  // activate and then never move. TouchSensor blocks scroll after the hold.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  useEffect(() => {
    async function loadPlan() {
      try {
        let url: string;
        let effectiveId = planId;
        if (planId) {
          url = `/api/plans/${planId}`;
        } else {
          const listRes = await apiFetch("/api/plans");
          if (!listRes.ok) throw new Error("Failed to fetch plans");
          const plans = await listRes.json();
          const active = (plans as { id: string; status: string }[]).find(
            (p) => p.status === "active"
          );
          if (!active) { setLoading(false); return; }
          effectiveId = active.id;
          url = `/api/plans/${active.id}`;
        }
        setResolvedPlanId(effectiveId);

        const res = await apiFetch(url);
        if (!res.ok) { setLoading(false); return; }

        const raw = await res.json();
        setPlan(adaptApiPlan(raw));
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    loadPlan();
  }, [planId]);

  // Scroll the current week into view once the plan has rendered.
  useEffect(() => {
    if (plan && !didAutoScroll.current && currentWeekRef.current) {
      currentWeekRef.current.scrollIntoView({ block: "start" });
      didAutoScroll.current = true;
    }
  }, [plan]);

  // Fetch strength sessions for the whole plan's date window.
  const loadSessions = useCallback(async () => {
    if (!plan) return;
    const firstWeek = plan.weeks[0];
    const lastWeek = plan.weeks[plan.weeks.length - 1];
    const firstDate = firstWeek?.workouts[0]?.date;
    const lastDate = lastWeek?.workouts[lastWeek.workouts.length - 1]?.date;
    if (!firstDate || !lastDate) return;
    const from = mondayOf(firstDate);
    const to = addDays(mondayOf(lastDate), 6);
    to.setHours(23, 59, 59, 999);
    try {
      const res = await apiFetch(
        `/api/strength/sessions?from=${from.toISOString()}&to=${to.toISOString()}`
      );
      if (res.ok) setSessions((await res.json()) as StrengthSession[]);
    } catch {
      /* ignore — leave prior sessions in place */
    }
  }, [plan]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadSessions();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  // Re-validate the add-strength sheet whenever its day/type changes.
  useEffect(() => {
    if (!addDate) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/strength/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: addType, date: addDate.toISOString() }),
        });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setViolations(data.violations ?? []);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addDate, addType]);

  if (loading) return <LoadingSkeleton />;
  if (!plan) return <PlanEmptyState />;

  const allWorkouts = plan.weeks.flatMap((w) => w.workouts);

  function showError(msg: string) {
    setErrorNote(msg);
    setTimeout(() => setErrorNote(null), 2600);
  }

  // ── API helpers (return ok) ──────────────────────────────────────────────
  async function patchWorkout(id: string, date: Date): Promise<boolean> {
    if (!resolvedPlanId) return false;
    try {
      const res = await apiFetch(`/api/plans/${resolvedPlanId}/workouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: date.toISOString() }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function patchStrength(id: string, date: Date): Promise<boolean> {
    try {
      const res = await apiFetch(`/api/strength/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: date.toISOString() }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Run move / swap ───────────────────────────────────────────────────────
  // Every day (incl. rest) is a real workout row, so a run landing on an
  // occupied day swaps the two runs' dates (Benchmark behaviour). A run onto an
  // empty day is a single move.
  function applyRunDates(
    runId: string,
    runDate: Date,
    otherId: string | undefined,
    otherDate: Date
  ) {
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        weeks: prev.weeks.map((wk) => ({
          ...wk,
          workouts: wk.workouts.map((w) => {
            if (w.id === runId)
              return { ...w, date: runDate, dayOfWeek: runDate.getDay() };
            if (otherId && w.id === otherId)
              return { ...w, date: otherDate, dayOfWeek: otherDate.getDay() };
            return w;
          }),
        })),
      };
    });
  }

  async function moveRun(runId: string, targetDate: Date) {
    const dragged = allWorkouts.find((w) => w.id === runId);
    if (!dragged || !dragged.id || sameDay(dragged.date, targetDate)) return;
    const target = allWorkouts.find(
      (w) => w.id !== dragged.id && sameDay(w.date, targetDate)
    );
    const oldDate = new Date(dragged.date);

    applyRunDates(dragged.id, targetDate, target?.id, oldDate);

    const calls = [patchWorkout(dragged.id, targetDate)];
    if (target?.id) calls.push(patchWorkout(target.id, oldDate));
    const oks = await Promise.all(calls);
    if (oks.some((ok) => !ok)) {
      applyRunDates(dragged.id, oldDate, target?.id, targetDate); // revert
      haptic("warning");
      showError("Couldn't move that workout. Try again.");
    } else {
      haptic("success");
    }
  }

  // ── Strength move / swap ──────────────────────────────────────────────────
  function applyStrengthDates(
    sessionId: string,
    sessionDate: Date,
    otherId: string | undefined,
    otherDate: Date
  ) {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === sessionId) return { ...s, date: sessionDate.toISOString() };
        if (otherId && s.id === otherId) return { ...s, date: otherDate.toISOString() };
        return s;
      })
    );
  }

  async function moveStrength(sessionId: string, targetDate: Date) {
    const dragged = sessions.find((s) => s.id === sessionId);
    if (!dragged || sameDay(new Date(dragged.date), targetDate)) return;
    const target = sessions.find(
      (s) => s.id !== sessionId && sameDay(new Date(s.date), targetDate)
    );
    const oldDate = new Date(dragged.date);

    applyStrengthDates(dragged.id, targetDate, target?.id, oldDate);

    const calls = [patchStrength(dragged.id, targetDate)];
    if (target) calls.push(patchStrength(target.id, oldDate));
    const oks = await Promise.all(calls);
    if (oks.some((ok) => !ok)) {
      applyStrengthDates(dragged.id, oldDate, target?.id, targetDate); // revert
      haptic("warning");
      showError("Couldn't move that session. Try again.");
    } else {
      haptic("success");
    }
  }

  async function deleteStrength(id: string) {
    setStrengthBusy(true);
    setSessions((prev) => prev.filter((s) => s.id !== id)); // optimistic
    try {
      const res = await apiFetch(`/api/strength/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        showError("Couldn't remove that session.");
        await loadSessions(); // reconcile — session reappears
      }
    } catch {
      await loadSessions();
    } finally {
      setStrengthBusy(false);
    }
  }

  async function confirmAddStrength() {
    if (!addDate) return;
    setAddBusy(true);
    try {
      const res = await apiFetch("/api/strength/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: addType, date: addDate.toISOString(), force: true }),
      });
      if (res.ok) {
        haptic("success");
        setAddDate(null);
        await loadSessions();
      } else {
        haptic("warning");
        showError("Couldn't add that session.");
      }
    } finally {
      setAddBusy(false);
    }
  }

  // ── Skip (from the detail sheet) ──────────────────────────────────────────
  async function skipDetailItem() {
    if (!detailSheet) return;
    setSkipBusy(true);
    try {
      let ok = false;
      if (detailSheet.kind === "run") {
        const id = detailSheet.workout.id;
        if (!id || !resolvedPlanId) return;
        const res = await apiFetch(`/api/plans/${resolvedPlanId}/workouts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "skipped" }),
        });
        ok = res.ok;
        if (ok) {
          setPlan((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              weeks: prev.weeks.map((wk) => ({
                ...wk,
                workouts: wk.workouts.map((w) =>
                  w.id === id ? { ...w, status: "skipped" } : w
                ),
              })),
            };
          });
        }
      } else {
        const id = detailSheet.session.id;
        const res = await apiFetch(`/api/strength/sessions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "skipped" }),
        });
        ok = res.ok;
        if (ok) {
          setSessions((prev) =>
            prev.map((s) => (s.id === id ? { ...s, status: "skipped" } : s))
          );
        }
      }
      if (ok) {
        haptic("success");
        setDetailSheet(null);
      } else {
        haptic("warning");
        showError("Couldn't skip that workout. Try again.");
      }
    } catch {
      haptic("warning");
      showError("Couldn't skip that workout. Try again.");
    } finally {
      setSkipBusy(false);
    }
  }

  // ── Drag lifecycle ────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    const [kind, id] = String(event.active.id).split(":");
    if (kind === "run") {
      const workout = allWorkouts.find((w) => w.id === id);
      if (workout) setActiveDrag({ kind: "run", workout });
    } else if (kind === "strength") {
      const session = sessions.find((s) => s.id === id);
      if (session) setActiveDrag({ kind: "strength", session });
    }
    haptic("light");
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    const [kind, id] = String(active.id).split(":");
    const targetMs = Number(String(over.id).split(":")[1]);
    if (Number.isNaN(targetMs)) return;
    const targetDate = new Date(targetMs);
    if (kind === "run") moveRun(id, targetDate);
    else if (kind === "strength") moveStrength(id, targetDate);
  }

  // ── Move-picker handler (sheet fallback) ──────────────────────────────────
  function pickMoveDay(date: Date) {
    if (!movePicker) return;
    if (movePicker.kind === "run" && movePicker.workout.id) {
      moveRun(movePicker.workout.id, date);
    } else if (movePicker.kind === "strength") {
      moveStrength(movePicker.session.id, date);
    }
    setMovePicker(null);
  }

  // Derived values for the tap-detail sheet.
  const detailTitle =
    detailSheet?.kind === "run"
      ? detailSheet.workout.title
      : detailSheet?.kind === "strength"
      ? detailSheet.session.title || strengthMeta(detailSheet.session.type).label
      : "";
  const detailTypeLabel =
    detailSheet?.kind === "run"
      ? detailSheet.workout.type.charAt(0).toUpperCase() + detailSheet.workout.type.slice(1)
      : detailSheet?.kind === "strength"
      ? `Strength · ${strengthMeta(detailSheet.session.type).label}`
      : "";
  const detailDate =
    detailSheet?.kind === "run"
      ? detailSheet.workout.date
      : detailSheet?.kind === "strength"
      ? new Date(detailSheet.session.date)
      : null;
  const detailHref =
    detailSheet?.kind === "run"
      ? `/workout/${detailSheet.workout.id}`
      : detailSheet?.kind === "strength"
      ? `/strength/session/${detailSheet.session.id}`
      : "#";
  const detailStatus =
    detailSheet?.kind === "run"
      ? detailSheet.workout.status
      : detailSheet?.kind === "strength"
      ? detailSheet.session.status
      : undefined;

  // The current day of the item being moved via the picker (disabled in grid),
  // and the Mon–Sun days of the week that item lives in.
  const movePickerDate =
    movePicker?.kind === "run"
      ? movePicker.workout.date
      : movePicker?.kind === "strength"
      ? new Date(movePicker.session.date)
      : null;
  const movePickerDays = movePickerDate
    ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(movePickerDate), i))
    : [];

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title="Training calendar"
        large={false}
        centerAlways
        left={
          <TransitionLink
            href="/plan"
            aria-label="Back to plan"
            className="press flex h-11 w-11 items-center justify-center rounded-lg active:bg-elevated"
          >
            <ChevronLeft className="h-5 w-5 text-text-1" strokeWidth={2.5} />
          </TransitionLink>
        }
        right={
          <TransitionLink
            href="/plan/manage"
            aria-label="Manage plan"
            className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
          >
            <SlidersHorizontal className="h-4 w-4 text-text-2" strokeWidth={2} />
          </TransitionLink>
        }
      />

      <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-tabbar pt-2">
        {/* Error note */}
        <AnimatePresence>
          {errorNote && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="sticky top-14 z-20 flex items-center gap-2 rounded-[var(--radius-input)] bg-danger/10 px-3 py-2 text-[12.5px] text-danger backdrop-blur"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              <span>{errorNote}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Continuous calendar — every plan week, long-press a card to drag */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {plan.weeks.map((week) => {
            const days = weekDaysFor(plan, week.weekNumber);
            if (days.length === 0) return null;
            const isCurrent = isCurrentWeek(week);
            const dimmed = isPastWeek(week);

            return (
              <section
                key={week.weekNumber}
                ref={isCurrent ? currentWeekRef : undefined}
                className={`scroll-mt-16 ${
                  isCurrent
                    ? "-mx-2 rounded-[var(--radius-card)] border border-accent/30 px-2 py-2"
                    : ""
                }`}
              >
                {/* Week header */}
                <header className="mb-1.5 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-text-1">
                      {formatDayMonth(days[0])} – {formatDayMonth(days[6])}
                    </span>
                    <span className="rounded-full bg-[#0B0C0E] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                      Week {week.weekNumber}
                    </span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${PHASE_BADGE[week.phase]}`}
                    >
                      {week.phase}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-text-3 tabular-nums">
                    Total: {week.targetKm} km
                  </p>
                </header>

                <div className="flex flex-col gap-1">
                  {days.map((day, idx) => {
                    const run = week.workouts.find((w) => sameDay(w.date, day));
                    const strength = sessions.find((s) =>
                      sameDay(new Date(s.date), day)
                    );
                    return (
                      <DayRow
                        key={idx}
                        dayIdx={idx}
                        date={day}
                        run={run}
                        strength={strength}
                        onOpenRun={(w) => setDetailSheet({ kind: "run", workout: w })}
                        onOpenStrength={(s) =>
                          setDetailSheet({ kind: "strength", session: s })
                        }
                        onAddStrength={(d) => {
                          haptic("light");
                          setAddType("lower_achilles");
                          setViolations([]);
                          setAddDate(d);
                        }}
                        dimmed={dimmed}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}

          <DragOverlay dropAnimation={null}>
            {activeDrag?.kind === "run" ? (
              <div className="flex items-stretch overflow-hidden rounded-[var(--radius-input)] bg-elevated opacity-95 shadow-lg">
                <div
                  className="w-[3px] shrink-0"
                  style={{ backgroundImage: runSpine(activeDrag.workout.type) }}
                />
                <div className="min-w-0 px-2 py-2">
                  <p className="truncate text-[15px] font-bold leading-tight text-text-1">
                    {activeDrag.workout.title}
                  </p>
                  {activeDrag.workout.targetKm != null && (
                    <p className="mt-0.5 text-[12px] text-text-3 tabular-nums">
                      {activeDrag.workout.targetKm} km
                    </p>
                  )}
                </div>
              </div>
            ) : activeDrag?.kind === "strength" ? (
              <div className="flex items-stretch overflow-hidden rounded-[var(--radius-input)] bg-elevated opacity-95 shadow-lg">
                <div
                  className="w-[3px] shrink-0"
                  style={{ backgroundImage: STRENGTH_SPINE }}
                />
                <div className="flex min-w-0 items-center gap-1.5 px-2 py-2">
                  <Dumbbell className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={2} />
                  <span className="truncate text-[15px] font-bold text-text-1">
                    {activeDrag.session.title ||
                      `${strengthMeta(activeDrag.session.type).label} Strength`}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <p className="text-center text-[11px] text-text-3">
          Press and hold a card to drag it to another day.
        </p>

        {/* Plan overview */}
        <div className="h-px bg-hairline mt-2" />
        <PlanHeader plan={plan} />
      </div>

      {/* Card detail sheet (tap a card) */}
      <Sheet open={!!detailSheet} onClose={() => setDetailSheet(null)}>
        {detailSheet && detailDate && (
          <div className="flex flex-col gap-3 px-1 pb-2 pt-2">
            <div>
              <h2 className="text-[19px] font-bold leading-tight text-text-1">
                {detailTitle}
              </h2>
              <p className="mt-1 text-[13px] text-text-3">
                {detailTypeLabel} ·{" "}
                {detailDate.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>

            {/* View full detail */}
            <TransitionLink
              href={detailHref}
              onClick={() => setDetailSheet(null)}
              className="press flex items-center justify-between rounded-[var(--radius-input)] bg-elevated px-4 py-3"
            >
              <span className="text-[14px] font-semibold text-text-1">
                View {detailSheet.kind === "run" ? "workout" : "session"}
              </span>
              <ChevronRightIcon className="h-4 w-4 text-text-3" strokeWidth={2} />
            </TransitionLink>

            {/* Move (accessible fallback for drag) */}
            <button
              onClick={() => {
                haptic("light");
                setMovePicker(detailSheet);
                setDetailSheet(null);
              }}
              className="press flex items-center justify-between rounded-[var(--radius-input)] bg-elevated px-4 py-3"
            >
              <span className="flex items-center gap-2 text-[14px] font-semibold text-text-1">
                <CalendarClock className="h-4 w-4 text-text-3" strokeWidth={2} />
                Move to another day
              </span>
            </button>

            {/* Skip */}
            {detailStatus !== "completed" && detailStatus !== "skipped" && (
              <button
                onClick={skipDetailItem}
                disabled={skipBusy}
                className="press flex items-center justify-between rounded-[var(--radius-input)] bg-elevated px-4 py-3 disabled:opacity-40"
              >
                <span className="flex items-center gap-2 text-[14px] font-semibold text-warn">
                  <SkipForward className="h-4 w-4" strokeWidth={2} />
                  Skip workout
                </span>
              </button>
            )}

            {/* Remove (strength only) */}
            {detailSheet.kind === "strength" && (
              <button
                onClick={() => {
                  haptic("medium");
                  deleteStrength(detailSheet.session.id);
                  setDetailSheet(null);
                }}
                disabled={strengthBusy}
                className="press flex items-center justify-between rounded-[var(--radius-input)] bg-elevated px-4 py-3 disabled:opacity-40"
              >
                <span className="flex items-center gap-2 text-[14px] font-semibold text-danger">
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                  Remove session
                </span>
              </button>
            )}

            <button
              onClick={() => setDetailSheet(null)}
              className="press mx-auto mt-1 flex items-center gap-1 text-[13px] font-medium text-text-3"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Cancel
            </button>
          </div>
        )}
      </Sheet>

      {/* Move-to-another-day picker (tap fallback for drag) */}
      <Sheet
        open={!!movePicker}
        onClose={() => setMovePicker(null)}
        title="Move to another day"
      >
        {movePicker && movePickerDate && (
          <div className="flex flex-col gap-4 px-1 pb-2">
            <p className="text-[13px] text-text-2">
              <span className="font-semibold text-text-1">
                {movePicker.kind === "run"
                  ? movePicker.workout.title
                  : strengthMeta(movePicker.session.type).label}
              </span>{" "}
              — pick a new day.
            </p>
            <div className="grid grid-cols-7 gap-1.5">
              {movePickerDays.map((d, i) => {
                const current = sameDay(d, movePickerDate);
                return (
                  <button
                    key={i}
                    disabled={current}
                    onClick={() => pickMoveDay(d)}
                    className={`flex flex-col items-center rounded-[var(--radius-input)] py-2.5 text-center transition-colors disabled:opacity-40 ${
                      current ? "bg-accent text-on-accent" : "bg-elevated text-text-2 press"
                    }`}
                  >
                    <span className="text-[9px] font-bold uppercase">{DOW[i]}</span>
                    <span className="text-[15px] font-bold tabular-nums">{d.getDate()}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[12px] text-text-3">
              {movePicker.kind === "run"
                ? "Landing on another run swaps their days. The calendar event moves too."
                : "Landing on another session swaps their days. The calendar event moves too."}
            </p>
          </div>
        )}
      </Sheet>

      {/* Add-strength sheet */}
      <Sheet
        open={!!addDate}
        onClose={() => setAddDate(null)}
        title="Add strength"
      >
        {addDate && (
          <div className="flex flex-col gap-4 px-1 pb-2">
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">
                Session
              </p>
              <Segmented
                value={addType}
                onChange={(v) => setAddType(v as SessionType)}
                options={[
                  { value: "upper", label: "Upper" },
                  { value: "lower", label: "Lower" },
                  { value: "lower_achilles", label: "L+Ach" },
                  { value: "full_body", label: "Full" },
                ]}
              />
            </div>

            <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated px-3 py-2 text-[13px] text-text-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
              <span>
                {addDate.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>

            {/* Constraint feedback */}
            {violations.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {violations.map((v, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 rounded-[var(--radius-input)] px-3 py-2 text-[12.5px] ${
                      v.severity === "error" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"
                    }`}
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                    <span>{v.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="flex items-center gap-2 rounded-[var(--radius-input)] px-3 py-2 text-[12.5px]"
                style={{ backgroundColor: "rgba(74,222,128,0.10)", color: "#4ADE80" }}
              >
                <CalendarClock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                <span>No conflicts with your runs this week.</span>
              </div>
            )}

            <Button
              full
              onClick={confirmAddStrength}
              busy={addBusy}
              variant={violations.some((v) => v.severity === "error") ? "danger" : "primary"}
            >
              {violations.some((v) => v.severity === "error")
                ? "Schedule anyway"
                : "Schedule session"}
            </Button>
            <button
              onClick={() => setAddDate(null)}
              className="press mx-auto flex items-center gap-1 text-[13px] font-medium text-text-3"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              Cancel
            </button>
          </div>
        )}
      </Sheet>

      <BottomNav active="plan" />
    </main>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <PlanPageInner />
    </Suspense>
  );
}
