"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  GripVertical,
  CalendarClock,
  SlidersHorizontal,
  Dumbbell,
  Trash2,
  X,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
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
import { WorkoutTypeBadge } from "@/components/WorkoutTypeBadge";
import { PaceChart } from "@/components/PaceChart";
import { formatPace } from "@/lib/plan-engine/pace-zones";
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
    hillyArea: (raw.hillyArea as boolean) ?? false,
    weeks: ((raw.weeks as Record<string, unknown>[]) ?? []).map((week) => ({
      weekNumber: week.weekNumber as number,
      phase: week.phase as GeneratedWeek["phase"],
      type: week.type as GeneratedWeek["type"],
      targetKm: (week.targetKm as number) ?? 0,
      workouts: ((week.workouts as Record<string, unknown>[]) ?? []).map((wo) => ({
        id: wo.id as string | undefined,
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
  easy:     "#4ADE80",
  recovery: "#4ADE80",
  long:     "#60A5FA",
  tempo:    "#FFB547",
  interval: "#C084FC",
  race:     "#FF4D4D",
  rest:     "#2A2A2E",
};

const BLOCK_LABEL: Record<string, string> = {
  warmup:   "Warm-up",
  work:     "Work",
  recovery: "Recovery",
  cooldown: "Cool-down",
};

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

type SessionType = "upper" | "lower" | "lower_achilles";

interface StrengthSession {
  id: string;
  date: string;
  type: SessionType;
  title: string;
  status: string;
}

interface Violation {
  code: string;
  severity: "error" | "warn";
  message: string;
}

const STRENGTH_META: Record<SessionType, { label: string; color: string }> = {
  upper: { label: "Upper", color: "#60A5FA" },
  lower: { label: "Lower", color: "#C084FC" },
  lower_achilles: { label: "Lower + Achilles", color: "#FFB547" },
};

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

// ── Block detail row ──────────────────────────────────────────────────────────

function BlockRow({
  block,
  index,
  total,
}: {
  block: GeneratedBlock;
  index: number;
  total: number;
}) {
  const isWork = block.type === "work";
  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-col items-center pt-0.5 shrink-0">
        <div
          className={`w-2 h-2 rounded-full ${isWork ? "bg-accent" : "bg-hairline"}`}
        />
        {index < total - 1 && (
          <div className="w-px flex-1 bg-hairline mt-0.5 min-h-[20px]" />
        )}
      </div>
      <div className="flex-1 flex items-start justify-between pb-3">
        <div>
          <p className="text-sm font-medium text-text-1">
            {BLOCK_LABEL[block.type] ?? block.type}
            {block.reps && block.repDistanceKm && (
              <span className="text-text-3 font-normal ml-1.5">
                {block.reps}×{block.repDistanceKm * 1000}m
              </span>
            )}
          </p>
          {block.distanceKm != null && (
            <p className="text-xs text-text-3">{block.distanceKm} km</p>
          )}
          {block.durationMinutes != null && (
            <p className="text-xs text-text-3">{block.durationMinutes} min rest</p>
          )}
          {block.repRestSeconds != null && block.reps && (
            <p className="text-xs text-text-3">{block.repRestSeconds}s rest between reps</p>
          )}
        </div>
        {block.targetPaceSecKm != null && (
          <p className="text-xs font-semibold text-text-2 tabular-nums shrink-0 ml-2">
            {formatPace(block.targetPaceSecKm)}/km
          </p>
        )}
      </div>
    </div>
  );
}

// ── Run chip (draggable) ──────────────────────────────────────────────────────

function RunChip({
  workout,
  expanded,
  onToggle,
  onMove,
  dimmed,
}: {
  workout: GeneratedWorkout;
  expanded: boolean;
  onToggle: () => void;
  onMove?: () => void;
  dimmed: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `run:${workout.id}`,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      className={`rounded-[var(--radius-input)] bg-surface overflow-hidden shadow-sm ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-stretch">
        {/* Colored type accent strip */}
        <div
          className="w-1 shrink-0"
          style={{ backgroundColor: WORKOUT_BAR_COLOR[workout.type] }}
        />

        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="shrink-0 flex items-center justify-center w-7 cursor-grab active:cursor-grabbing touch-none text-text-3"
          aria-label="Drag to another day"
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.9} />
        </span>

        {/* Body — tap to expand */}
        <button
          className="press flex-1 min-w-0 flex items-center gap-2 py-2 pr-2 text-left"
          onClick={() => {
            haptic("light");
            onToggle();
          }}
          aria-expanded={expanded}
        >
          <div className="flex-1 min-w-0">
            <WorkoutTypeBadge type={workout.type} />
            <p className="mt-0.5 text-[14px] font-medium text-text-1 truncate">
              {workout.title}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {workout.targetKm != null && (
              <p className="text-[14px] font-bold text-text-1 tabular-nums">
                {workout.targetKm} km
              </p>
            )}
            {workout.targetDurationMinutes != null && (
              <p className="text-[11px] text-text-3">
                {formatDuration(workout.targetDurationMinutes)}
              </p>
            )}
          </div>
          <ChevronDown
            className={`h-4 w-4 text-text-3 shrink-0 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
            strokeWidth={2}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t border-hairline pt-3">
              {workout.description && (
                <p className="text-[13px] text-text-2 mb-3 leading-relaxed">
                  {workout.description}
                </p>
              )}
              {workout.blocks.length > 0 && (
                <>
                  <div className="mb-3">
                    <PaceChart
                      blocks={workout.blocks}
                      workoutType={workout.type}
                      variant="full"
                      color={WORKOUT_BAR_COLOR[workout.type]}
                    />
                  </div>
                  <div className="flex flex-col">
                    {workout.blocks.map((block, i) => (
                      <BlockRow
                        key={i}
                        block={block}
                        index={i}
                        total={workout.blocks.length}
                      />
                    ))}
                  </div>
                </>
              )}
              {onMove && workout.id && (
                <button
                  onClick={() => {
                    haptic("light");
                    onMove();
                  }}
                  className="press mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-elevated py-2.5 text-[13px] font-semibold text-text-2"
                >
                  <CalendarClock className="h-4 w-4" strokeWidth={2} />
                  Move to another day
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Strength chip (draggable) ─────────────────────────────────────────────────

function StrengthChip({
  session,
  onMove,
  onDelete,
  dimmed,
  busy,
}: {
  session: StrengthSession;
  onMove: () => void;
  onDelete: () => void;
  dimmed: boolean;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `strength:${session.id}`,
  });
  const meta = STRENGTH_META[session.type];

  return (
    <div
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : undefined }}
      className={`rounded-[var(--radius-input)] overflow-hidden ${
        dimmed ? "opacity-50" : ""
      }`}
    >
      <div
        className="flex items-stretch"
        style={{ backgroundColor: `${meta.color}1A` }}
      >
        {/* Colored type accent strip */}
        <div className="w-1 shrink-0" style={{ backgroundColor: meta.color }} />

        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="shrink-0 flex items-center justify-center w-7 cursor-grab active:cursor-grabbing touch-none"
          style={{ color: meta.color }}
          aria-label="Drag to another day"
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.9} />
        </span>

        {/* Body — tap to move */}
        <button
          onClick={() => {
            haptic("light");
            onMove();
          }}
          className="press flex-1 min-w-0 flex items-center gap-2 py-2 text-left"
        >
          <Dumbbell
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: meta.color }}
            strokeWidth={2}
          />
          <span className="truncate text-[13px] font-semibold text-text-1">
            {meta.label}
          </span>
          {session.status === "completed" && (
            <span
              className="ml-auto text-[10px] font-bold uppercase"
              style={{ color: "#4ADE80" }}
            >
              done
            </span>
          )}
        </button>

        {/* Delete */}
        <button
          onClick={() => {
            haptic("medium");
            onDelete();
          }}
          disabled={busy}
          aria-label="Remove strength session"
          className="press flex h-9 w-9 shrink-0 items-center justify-center text-text-3 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ── Day row (droppable) ───────────────────────────────────────────────────────

function DayRow({
  dayIdx,
  date,
  run,
  strength,
  expandedRunId,
  onToggleRun,
  onMoveRun,
  onMoveStrength,
  onDeleteStrength,
  onAddStrength,
  dimmed,
  strengthBusy,
}: {
  dayIdx: number;
  date: Date;
  run: GeneratedWorkout | undefined;
  strength: StrengthSession | undefined;
  expandedRunId: string | null;
  onToggleRun: (id: string) => void;
  onMoveRun: (workout: GeneratedWorkout) => void;
  onMoveStrength: (session: StrengthSession) => void;
  onDeleteStrength: (id: string) => void;
  onAddStrength: (dayIdx: number) => void;
  dimmed: boolean;
  strengthBusy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayIdx}` });
  const isToday = sameDay(date, new Date());
  const isRest = run?.type === "rest";

  return (
    <div
      ref={setNodeRef}
      className={`rounded-[var(--radius-card)] border px-2 py-2 transition-colors ${
        isOver
          ? "border-accent bg-accent/10"
          : isToday
          ? "border-accent/30 bg-accent/5"
          : "border-hairline bg-surface"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Day label */}
        <div className="w-10 shrink-0 pt-1.5 text-center">
          <p className="text-[10px] font-bold uppercase tracking-wide text-text-3">
            {DOW[dayIdx]}
          </p>
          <p
            className={`text-[15px] font-bold tabular-nums ${
              isToday ? "text-accent" : "text-text-1"
            }`}
          >
            {date.getDate()}
          </p>
        </div>

        {/* Activity chips */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {run &&
            (isRest ? (
              <div
                className={`flex items-center gap-2 rounded-[var(--radius-input)] px-2 py-2 ${
                  dimmed ? "opacity-50" : ""
                }`}
              >
                <div className="w-1 self-stretch rounded-full bg-hairline shrink-0" />
                <span className="text-[13px] text-text-3">Rest day</span>
              </div>
            ) : (
              <RunChip
                workout={run}
                expanded={expandedRunId === run.id}
                onToggle={() => run.id && onToggleRun(run.id)}
                onMove={run.id ? () => onMoveRun(run) : undefined}
                dimmed={dimmed}
              />
            ))}

          {strength && (
            <StrengthChip
              session={strength}
              onMove={() => onMoveStrength(strength)}
              onDelete={() => onDeleteStrength(strength.id)}
              dimmed={dimmed}
              busy={strengthBusy}
            />
          )}

          {!strength && (
            <button
              onClick={() => onAddStrength(dayIdx)}
              className="press flex items-center gap-1.5 self-start rounded-[var(--radius-input)] border border-dashed border-hairline px-2.5 py-1.5 text-[12px] font-medium text-text-3"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              Add strength
            </button>
          )}
        </div>
      </div>
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
    <section className="rounded-[var(--radius-card)] bg-surface p-5">
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

// ── Phase divider ─────────────────────────────────────────────────────────────

function PhaseDivider({ phase }: { phase: WeekPhase }) {
  return (
    <div className="flex items-center gap-3" role="separator">
      <div className="h-px flex-1 bg-hairline" />
      <span
        className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${PHASE_BADGE[phase]}`}
      >
        {phase} phase
      </span>
      <div className="h-px flex-1 bg-hairline" />
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function PlanEmptyState() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Plan" large left={<ProfileAvatar />} />
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
      <NavBar title="Plan" large left={<ProfileAvatar />} />
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

// ── Week selector sheet ──────────────────────────────────────────────────────

function WeekSheet({
  weeks,
  selectedWeek,
  onSelect,
  open,
  onClose,
}: {
  weeks: GeneratedWeek[];
  selectedWeek: number;
  onSelect: (n: number) => void;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Select week">
      <div className="pb-4">
        {weeks.map((week) => {
          const isCurrent = isCurrentWeek(week);
          const isSelected = week.weekNumber === selectedWeek;
          const firstDate = week.workouts[0]?.date;
          const lastDate = week.workouts[week.workouts.length - 1]?.date;

          return (
            <button
              key={week.weekNumber}
              onClick={() => {
                haptic("light");
                onSelect(week.weekNumber);
                onClose();
              }}
              className={`press w-full flex items-center justify-between px-3 py-3 rounded-[var(--radius-input)] text-left ${
                isSelected ? "bg-accent/10" : "active:bg-elevated"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-[15px] font-bold ${isSelected ? "text-accent" : "text-text-1"}`}>
                  Week {week.weekNumber}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${PHASE_BADGE[week.phase]}`}>
                  {week.phase}
                </span>
                {isCurrent && (
                  <span className="text-[9px] font-bold text-accent uppercase">Now</span>
                )}
              </div>
              <div className="text-right">
                {firstDate && lastDate && (
                  <p className="text-[10px] text-text-3">
                    {formatDate(firstDate)} – {formatDate(lastDate)}
                  </p>
                )}
                <p className="text-[10px] text-text-3">{week.targetKm} km</p>
              </div>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

// ── Main plan page (week-focused) ────────────────────────────────────────────

function PlanPageInner() {
  const searchParams = useSearchParams();
  const planId = searchParams.get("id");

  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeekNum, setSelectedWeekNum] = useState<number>(1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null);
  const [resolvedPlanId, setResolvedPlanId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Strength sessions for the visible week.
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

  // Add-strength sheet state.
  const [addDayIdx, setAddDayIdx] = useState<number | null>(null);
  const [addType, setAddType] = useState<SessionType>("lower_achilles");
  const [violations, setViolations] = useState<Violation[]>([]);
  const [addBusy, setAddBusy] = useState(false);

  // Swipe refs
  const touchStartX = React.useRef(0);

  // DnD sensors — must be at top level (hooks rules)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
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
        const adapted = adaptApiPlan(raw);
        setPlan(adapted);

        // Default to current week on first load only (don't yank the view
        // back after a reschedule reload).
        if (reloadKey === 0) {
          const currentIdx = adapted.weeks.findIndex((w) => isCurrentWeek(w));
          if (currentIdx >= 0) {
            setSelectedWeekNum(adapted.weeks[currentIdx].weekNumber);
          }
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    loadPlan();
  }, [planId, reloadKey]);

  // Fetch strength sessions for the visible week's date window.
  const loadSessions = useCallback(async () => {
    if (!plan) return;
    const days = weekDaysFor(plan, selectedWeekNum);
    if (days.length === 0) return;
    const from = new Date(days[0]);
    from.setHours(0, 0, 0, 0);
    const to = new Date(days[6]);
    to.setHours(23, 59, 59, 999);
    try {
      const res = await apiFetch(
        `/api/strength/sessions?from=${from.toISOString()}&to=${to.toISOString()}`
      );
      if (res.ok) setSessions((await res.json()) as StrengthSession[]);
    } catch {
      /* ignore — leave prior sessions in place */
    }
  }, [plan, selectedWeekNum]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadSessions();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions, reloadKey]);

  // Re-validate the add-strength sheet whenever its day/type changes.
  useEffect(() => {
    if (addDayIdx == null || !plan) return;
    const days = weekDaysFor(plan, selectedWeekNum);
    const date = days[addDayIdx];
    if (!date) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/strength/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: addType, date: date.toISOString() }),
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
  }, [addDayIdx, addType, plan, selectedWeekNum]);

  if (loading) return <LoadingSkeleton />;
  if (!plan) return <PlanEmptyState />;

  const selectedWeek = plan.weeks.find((w) => w.weekNumber === selectedWeekNum) ?? plan.weeks[0];
  const totalWeeks = plan.weeks.length;
  const weekWorkouts = selectedWeek.workouts;
  const days = weekDaysFor(plan, selectedWeekNum);
  const isPast = isPastWeek(selectedWeek);

  function goToWeek(n: number) {
    setSelectedWeekNum(Math.max(1, Math.min(n, totalWeeks)));
  }

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
  // empty pre-start day is a single move.
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
        weeks: prev.weeks.map((wk) => {
          if (wk.weekNumber !== selectedWeekNum) return wk;
          return {
            ...wk,
            workouts: wk.workouts.map((w) => {
              if (w.id === runId)
                return { ...w, date: runDate, dayOfWeek: runDate.getDay() };
              if (otherId && w.id === otherId)
                return { ...w, date: otherDate, dayOfWeek: otherDate.getDay() };
              return w;
            }),
          };
        }),
      };
    });
  }

  async function moveRun(runId: string, targetDayIdx: number) {
    const targetDate = days[targetDayIdx];
    if (!targetDate) return;
    const dragged = weekWorkouts.find((w) => w.id === runId);
    if (!dragged || !dragged.id || sameDay(dragged.date, targetDate)) return;
    const target = weekWorkouts.find((w) => sameDay(w.date, targetDate));
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

  async function moveStrength(sessionId: string, targetDayIdx: number) {
    const targetDate = days[targetDayIdx];
    if (!targetDate) return;
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
    if (addDayIdx == null) return;
    const date = days[addDayIdx];
    if (!date) return;
    setAddBusy(true);
    try {
      const res = await apiFetch("/api/strength/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: addType, date: date.toISOString(), force: true }),
      });
      if (res.ok) {
        haptic("success");
        setAddDayIdx(null);
        await loadSessions();
      } else {
        haptic("warning");
        showError("Couldn't add that session.");
      }
    } finally {
      setAddBusy(false);
    }
  }

  // ── Drag lifecycle ────────────────────────────────────────────────────────
  function handleDragStart(event: DragStartEvent) {
    const [kind, id] = String(event.active.id).split(":");
    if (kind === "run") {
      const workout = weekWorkouts.find((w) => w.id === id);
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
    const targetIdx = Number(String(over.id).split(":")[1]);
    if (Number.isNaN(targetIdx)) return;
    if (kind === "run") moveRun(id, targetIdx);
    else if (kind === "strength") moveStrength(id, targetIdx);
  }

  // ── Move-picker handler (sheet fallback) ──────────────────────────────────
  function pickMoveDay(idx: number) {
    if (!movePicker) return;
    if (movePicker.kind === "run" && movePicker.workout.id) {
      moveRun(movePicker.workout.id, idx);
    } else if (movePicker.kind === "strength") {
      moveStrength(movePicker.session.id, idx);
    }
    setMovePicker(null);
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goToWeek(selectedWeekNum + 1); // swipe left → next
      else goToWeek(selectedWeekNum - 1);           // swipe right → prev
    }
  }

  const firstDate = weekWorkouts[0]?.date;
  const lastDate = weekWorkouts[weekWorkouts.length - 1]?.date;
  const nonRest = weekWorkouts.filter((w) => w.type !== "rest");
  const isCurrent = isCurrentWeek(selectedWeek);
  const hasError = violations.some((v) => v.severity === "error");

  // The current day of the item being moved via the picker (disabled in grid).
  const movePickerDate =
    movePicker?.kind === "run"
      ? movePicker.workout.date
      : movePicker?.kind === "strength"
      ? new Date(movePicker.session.date)
      : null;

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title="Your Plan"
        large={false}
        centerAlways
        left={<ProfileAvatar />}
        right={
          <TransitionLink
            href="/plan/edit"
            aria-label="Manage plan"
            className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
          >
            <SlidersHorizontal className="h-4 w-4 text-text-2" strokeWidth={2} />
          </TransitionLink>
        }
      />

      <div
        className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-tabbar pt-2"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Quick actions (Benchmark-style row) */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { href: "/plan/edit", label: "Manage Plan", Icon: SlidersHorizontal },
            { href: "/pace-insights", label: "Pace Insights", Icon: TrendingUp },
            { href: "/create", label: "New Plan", Icon: Plus },
          ].map(({ href, label, Icon }) => (
            <TransitionLink
              key={href}
              href={href}
              className="press flex flex-col items-center gap-1.5 rounded-[var(--radius-card)] bg-surface py-3"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline">
                <Icon className="h-4 w-4 text-text-1" strokeWidth={1.9} />
              </span>
              <span className="text-[11px] font-semibold text-text-2">{label}</span>
            </TransitionLink>
          ))}
        </div>
        {/* Week selector + nav arrows */}
        <header className="flex items-center justify-between">
          <button
            onClick={() => {
              haptic("light");
              goToWeek(selectedWeekNum - 1);
            }}
            disabled={selectedWeekNum <= 1}
            className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated disabled:opacity-30"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4 text-text-2" strokeWidth={2} />
          </button>

          {/* Week selector with sheet */}
          <button
            onClick={() => {
              haptic("light");
              setDropdownOpen(true);
            }}
            className="press flex items-center gap-1.5"
          >
            <span className="text-[17px] font-bold text-text-1">
              Week {selectedWeekNum}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-text-3" strokeWidth={2.5} />
          </button>

          <button
            onClick={() => {
              haptic("light");
              goToWeek(selectedWeekNum + 1);
            }}
            disabled={selectedWeekNum >= totalWeeks}
            className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated disabled:opacity-30"
            aria-label="Next week"
          >
            <ChevronRightIcon className="h-4 w-4 text-text-2" strokeWidth={2} />
          </button>
        </header>

        {/* Week info bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {firstDate && lastDate && (
              <span className="text-[13px] text-text-3">
                {formatDate(firstDate)} – {formatDate(lastDate)}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${PHASE_BADGE[selectedWeek.phase]}`}>
              {selectedWeek.phase}
            </span>
            {selectedWeek.type !== "normal" && (
              <span className="rounded-full bg-elevated px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-2">
                {selectedWeek.type}
              </span>
            )}
          </div>
          <span className="text-[13px] font-semibold text-text-2 tabular-nums">
            {selectedWeek.targetKm} km
          </span>
        </div>

        {/* Coloured volume bar */}
        <div className="flex gap-0.5 h-1.5">
          {nonRest.map((w, i) => (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{ backgroundColor: WORKOUT_BAR_COLOR[w.type] }}
            />
          ))}
        </div>

        {/* Week summary */}
        <div className="flex items-center justify-between text-[13px] text-text-3">
          <span>
            {nonRest.length} runs
            {sessions.length > 0 && ` · ${sessions.length} strength`}
          </span>
          <span>
            {isCurrent && <span className="text-accent font-semibold mr-1">Current week</span>}
            {selectedWeekNum} of {totalWeeks}
          </span>
        </div>

        {/* Error note */}
        <AnimatePresence>
          {errorNote && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex items-center gap-2 rounded-[var(--radius-input)] bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              <span>{errorNote}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified day calendar — drag any chip to another day */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-col gap-1.5">
            {days.map((day, idx) => {
              const run = weekWorkouts.find((w) => sameDay(w.date, day));
              const strength = sessions.find((s) => sameDay(new Date(s.date), day));
              return (
                <DayRow
                  key={idx}
                  dayIdx={idx}
                  date={day}
                  run={run}
                  strength={strength}
                  expandedRunId={expandedWorkout}
                  onToggleRun={(id) =>
                    setExpandedWorkout(expandedWorkout === id ? null : id)
                  }
                  onMoveRun={(w) => setMovePicker({ kind: "run", workout: w })}
                  onMoveStrength={(s) => setMovePicker({ kind: "strength", session: s })}
                  onDeleteStrength={deleteStrength}
                  onAddStrength={(dIdx) => {
                    haptic("light");
                    setAddType("lower_achilles");
                    setViolations([]);
                    setAddDayIdx(dIdx);
                  }}
                  dimmed={isPast}
                  strengthBusy={strengthBusy}
                />
              );
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeDrag?.kind === "run" ? (
              <div className="rounded-[var(--radius-input)] bg-surface shadow-lg overflow-hidden opacity-95">
                <div className="flex items-stretch">
                  <div
                    className="w-1 shrink-0"
                    style={{ backgroundColor: WORKOUT_BAR_COLOR[activeDrag.workout.type] }}
                  />
                  <div className="flex items-center gap-2 py-2 px-2">
                    <GripVertical className="h-4 w-4 text-text-3" strokeWidth={1.9} />
                    <div className="min-w-0">
                      <WorkoutTypeBadge type={activeDrag.workout.type} />
                      <p className="mt-0.5 text-[14px] font-medium text-text-1 truncate">
                        {activeDrag.workout.title}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : activeDrag?.kind === "strength" ? (
              <div
                className="rounded-[var(--radius-input)] shadow-lg overflow-hidden opacity-95"
                style={{ backgroundColor: `${STRENGTH_META[activeDrag.session.type].color}1A` }}
              >
                <div className="flex items-center gap-2 py-2 px-2">
                  <div
                    className="w-1 self-stretch shrink-0"
                    style={{ backgroundColor: STRENGTH_META[activeDrag.session.type].color }}
                  />
                  <GripVertical
                    className="h-4 w-4"
                    strokeWidth={1.9}
                    style={{ color: STRENGTH_META[activeDrag.session.type].color }}
                  />
                  <Dumbbell
                    className="h-3.5 w-3.5"
                    strokeWidth={2}
                    style={{ color: STRENGTH_META[activeDrag.session.type].color }}
                  />
                  <span className="text-[13px] font-semibold text-text-1">
                    {STRENGTH_META[activeDrag.session.type].label}
                  </span>
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        <p className="text-center text-[11px] text-text-3">
          Drag a workout or strength chip to another day.
        </p>

        {/* Plan overview */}
        <div className="h-px bg-hairline mt-2" />
        <PlanHeader plan={plan} />
      </div>

      {/* Week sheet */}
      <WeekSheet
        weeks={plan.weeks}
        selectedWeek={selectedWeekNum}
        onSelect={setSelectedWeekNum}
        open={dropdownOpen}
        onClose={() => setDropdownOpen(false)}
      />

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
                  : STRENGTH_META[movePicker.session.type].label}
              </span>{" "}
              — pick a new day.
            </p>
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((d, i) => {
                const current = sameDay(d, movePickerDate);
                return (
                  <button
                    key={i}
                    disabled={current}
                    onClick={() => pickMoveDay(i)}
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
        open={addDayIdx != null}
        onClose={() => setAddDayIdx(null)}
        title="Add strength"
      >
        {addDayIdx != null && days[addDayIdx] && (
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
                  { value: "lower_achilles", label: "L+Achilles" },
                ]}
              />
            </div>

            <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated px-3 py-2 text-[13px] text-text-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
              <span>
                {days[addDayIdx].toLocaleDateString("en-US", {
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
              variant={hasError ? "danger" : "primary"}
            >
              {hasError ? "Schedule anyway" : "Schedule session"}
            </Button>
            <button
              onClick={() => setAddDayIdx(null)}
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
