"use client";

import Link from "next/link";
import React, { useMemo, useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BottomNav } from "@/components/BottomNav";
import { WorkoutTypeBadge } from "@/components/WorkoutTypeBadge";
import { formatPace } from "@/lib/plan-engine/pace-zones";
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

// ── Workout row (sortable) ────────────────────────────────────────────────────

function WorkoutRow({
  workout,
  expanded,
  onToggle,
  dimmed,
}: {
  workout: GeneratedWorkout;
  expanded: boolean;
  onToggle: () => void;
  dimmed: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: workout.sortOrder.toString() });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  if (workout.type === "rest") {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`flex items-center gap-3 py-2.5 px-1 ${dimmed ? "opacity-40" : ""}`}
      >
        <div className="w-1 self-stretch rounded-full bg-hairline shrink-0" />
        <p className="text-sm text-text-3">Rest day</p>
        <p className="ml-auto text-xs text-text-3">
          {workout.date.toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
          })}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        borderLeftWidth: 3,
        borderLeftColor: WORKOUT_BAR_COLOR[workout.type],
      } as React.CSSProperties}
      className={`rounded-[var(--radius-input)] border border-hairline bg-elevated overflow-hidden mb-2 ${dimmed ? "opacity-50" : ""}`}
    >
      {/* Row header — tap to expand */}
      <button
        className="w-full flex items-center gap-3 px-3 py-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {/* Drag handle */}
        <span
          {...attributes}
          {...listeners}
          className="shrink-0 flex flex-col gap-[3px] cursor-grab active:cursor-grabbing p-1 -ml-1 touch-none"
          aria-label="Drag to reorder"
          onClick={(e) => e.stopPropagation()}
        >
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-3.5 h-[2px] rounded-full bg-text-3 block" />
          ))}
        </span>

        {/* Date */}
        <div className="shrink-0 w-10 text-center">
          <p className="text-[10px] font-bold uppercase text-text-3">
            {workout.date.toLocaleDateString("en-US", { weekday: "short" })}
          </p>
          <p className="text-sm font-semibold text-text-2">{workout.date.getDate()}</p>
        </div>

        {/* Type badge + title */}
        <div className="flex-1 min-w-0">
          <WorkoutTypeBadge type={workout.type} />
          <p className="mt-0.5 text-sm font-semibold text-text-1 truncate">
            {workout.title}
          </p>
        </div>

        {/* Stats */}
        <div className="shrink-0 text-right">
          {workout.targetKm != null && (
            <p className="text-sm font-bold text-text-1">{workout.targetKm} km</p>
          )}
          {workout.targetDurationMinutes != null && (
            <p className="text-xs text-text-3">
              {formatDuration(workout.targetDurationMinutes)}
            </p>
          )}
        </div>

        {/* Chevron */}
        <svg
          className={`w-4 h-4 text-text-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-hairline pt-3">
          {workout.description && (
            <p className="text-xs text-text-2 mb-3 leading-relaxed">
              {workout.description}
            </p>
          )}
          {workout.blocks.length > 0 && (
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
          )}
        </div>
      )}
    </div>
  );
}

// ── Week card ─────────────────────────────────────────────────────────────────

function WeekCard({
  week,
  isCurrent,
  isPast,
}: {
  week: GeneratedWeek;
  isCurrent: boolean;
  isPast: boolean;
}) {
  const [workouts, setWorkouts] = useState(week.workouts);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWorkouts((prev) => {
      const oldIdx = prev.findIndex((w) => w.sortOrder.toString() === active.id);
      const newIdx = prev.findIndex((w) => w.sortOrder.toString() === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  const firstDate = workouts[0]?.date;
  const lastDate = workouts[workouts.length - 1]?.date;
  const nonRest = workouts.filter((w) => w.type !== "rest");

  return (
    <section
      className={`rounded-[var(--radius-card)] border bg-surface overflow-hidden ${
        isCurrent ? "border-accent/50" : "border-hairline"
      } ${isPast ? "opacity-60" : ""}`}
    >
      {/* Week header */}
      <div className={`px-4 pt-4 pb-3 ${isCurrent ? "bg-accent/5" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            {firstDate && lastDate && (
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-3">
                {formatDate(firstDate)} – {formatDate(lastDate)}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <h2
                className={`text-xl font-extrabold ${
                  isCurrent ? "text-accent" : "text-text-1"
                }`}
              >
                Week {week.weekNumber}
              </h2>
              {isCurrent && (
                <span className="rounded-full bg-accent/20 border border-accent/30 px-2 py-0.5 text-[10px] font-bold text-accent uppercase tracking-wider">
                  Current
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap justify-end">
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${PHASE_BADGE[week.phase]}`}
            >
              {week.phase}
            </span>
            {week.type !== "normal" && (
              <span className="rounded-full bg-elevated border border-hairline px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-text-2">
                {week.type}
              </span>
            )}
          </div>
        </div>

        {/* Coloured volume bar */}
        <div className="mt-3 flex gap-0.5 h-1.5">
          {nonRest.map((w, i) => (
            <div
              key={i}
              className="flex-1 rounded-full"
              style={{ backgroundColor: WORKOUT_BAR_COLOR[w.type] }}
            />
          ))}
        </div>

        {/* Week summary */}
        <div className="mt-2 flex items-center justify-between text-xs text-text-3">
          <span>{nonRest.length} workouts</span>
          <span className="font-semibold text-text-2">{week.targetKm} km total</span>
        </div>
      </div>

      {/* Drag-sortable workout list */}
      <div className="px-3 pb-3 pt-1 border-t border-hairline">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={workouts.map((w) => w.sortOrder.toString())}
            strategy={verticalListSortingStrategy}
          >
            {workouts.map((workout) => {
              const id = workout.sortOrder.toString();
              return (
                <WorkoutRow
                  key={id}
                  workout={workout}
                  expanded={expandedId === id}
                  onToggle={() =>
                    setExpandedId(expandedId === id ? null : id)
                  }
                  dimmed={isPast}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}

// ── Plan header ───────────────────────────────────────────────────────────────

const RACE_SHORT: Record<GeneratedPlan["raceDistance"], string> = {
  "5k": "5K",
  "10k": "10K",
  half: "Half",
  marathon: "26.2",
};

function PlanHeader({ plan }: { plan: GeneratedPlan }) {
  const totalKm = plan.weeks.reduce((sum, w) => sum + w.targetKm, 0);
  const maxKm = Math.max(...plan.weeks.map((w) => w.targetKm));

  return (
    <section className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-3">
            Active plan
          </p>
          <h1 className="mt-1 text-xl font-extrabold leading-tight text-text-1 truncate">
            {plan.name}
          </h1>
          <p className="mt-1 text-sm text-text-2">
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

      {/* Micro volume chart */}
      <div className="mt-4 flex gap-0.5 items-end h-8">
        {plan.weeks.map((week) => {
          const pct = maxKm > 0 ? (week.targetKm / maxKm) * 100 : 0;
          const color =
            week.type === "race"
              ? "#FF4D4D"
              : week.type === "deload"
              ? "#FFB547"
              : "#C8FF3C";
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

function EmptyState() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col items-center justify-center px-4 pb-28">
        <section className="w-full rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-elevated border border-hairline flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-7 h-7 text-text-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
              />
            </svg>
          </div>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-3">
            No active plan
          </p>
          <h1 className="mt-2 text-2xl font-extrabold text-text-1">
            Build your plan
          </h1>
          <p className="mt-2 text-sm text-text-2 leading-relaxed">
            Create a personalised race plan and your week-by-week training
            schedule will appear here.
          </p>
          <Link
            href="/create"
            className="mt-6 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-bold text-on-accent active:scale-95 transition-transform"
          >
            Create plan
          </Link>
        </section>
      </main>
      <BottomNav active="plan" />
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pb-28 pt-10">
        <div className="h-8 w-48 rounded-lg bg-elevated animate-pulse" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5 flex flex-col gap-3">
          <div className="h-5 w-32 rounded bg-elevated animate-pulse" />
          <div className="h-7 w-56 rounded bg-elevated animate-pulse" />
          <div className="h-4 w-40 rounded bg-elevated animate-pulse" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 h-32 animate-pulse" />
        ))}
      </main>
      <BottomNav active="plan" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Week selector dropdown ──────────────────────────────────────────────────

function WeekDropdown({
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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="absolute top-0 left-0 right-0 max-w-md mx-auto mt-16 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="m-4 rounded-[var(--radius-card)] border border-hairline bg-surface max-h-[60vh] overflow-y-auto">
          <div className="p-3">
            <p className="text-xs font-semibold text-text-3 uppercase tracking-widest px-2 mb-2">Select week</p>
            {weeks.map((week) => {
              const isCurrent = isCurrentWeek(week);
              const isSelected = week.weekNumber === selectedWeek;
              const firstDate = week.workouts[0]?.date;
              const lastDate = week.workouts[week.workouts.length - 1]?.date;

              return (
                <button
                  key={week.weekNumber}
                  onClick={() => { onSelect(week.weekNumber); onClose(); }}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[var(--radius-input)] text-left transition-colors ${
                    isSelected ? "bg-accent/10" : "active:bg-elevated"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${isSelected ? "text-accent" : "text-text-1"}`}>
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
        </div>
      </div>
    </div>
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

  // Swipe refs
  const touchStartX = React.useRef(0);

  useEffect(() => {
    async function loadPlan() {
      try {
        let url: string;
        if (planId) {
          url = `/api/plans/${planId}`;
        } else {
          const listRes = await fetch("/api/plans");
          if (!listRes.ok) throw new Error("Failed to fetch plans");
          const plans = await listRes.json();
          const active = (plans as { id: string; status: string }[]).find(
            (p) => p.status === "active"
          );
          if (!active) { setLoading(false); return; }
          url = `/api/plans/${active.id}`;
        }

        const res = await fetch(url);
        if (!res.ok) { setLoading(false); return; }

        const raw = await res.json();
        const adapted = adaptApiPlan(raw);
        setPlan(adapted);

        // Default to current week
        const currentIdx = adapted.weeks.findIndex((w) => isCurrentWeek(w));
        if (currentIdx >= 0) {
          setSelectedWeekNum(adapted.weeks[currentIdx].weekNumber);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    loadPlan();
  }, [planId]);

  if (loading) return <LoadingSkeleton />;
  if (!plan) return <EmptyState />;

  const selectedWeek = plan.weeks.find((w) => w.weekNumber === selectedWeekNum) ?? plan.weeks[0];
  const totalWeeks = plan.weeks.length;

  function goToWeek(n: number) {
    setSelectedWeekNum(Math.max(1, Math.min(n, totalWeeks)));
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

  const firstDate = selectedWeek.workouts[0]?.date;
  const lastDate = selectedWeek.workouts[selectedWeek.workouts.length - 1]?.date;
  const nonRest = selectedWeek.workouts.filter((w) => w.type !== "rest");
  const isCurrent = isCurrentWeek(selectedWeek);

  return (
    <div className="min-h-screen bg-bg">
      <main
        className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-28 pt-8"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Top header: back + week selector + nav arrows */}
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>

          {/* Week selector with dropdown */}
          <button
            onClick={() => setDropdownOpen(true)}
            className="flex items-center gap-1.5 active:opacity-70 transition-opacity"
          >
            <span className="text-base font-bold text-text-1">
              Week {selectedWeekNum}
            </span>
            <svg className="w-3.5 h-3.5 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Nav arrows */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => goToWeek(selectedWeekNum - 1)}
              disabled={selectedWeekNum <= 1}
              className="w-8 h-8 rounded-full bg-elevated border border-hairline flex items-center justify-center disabled:opacity-30"
              aria-label="Previous week"
            >
              <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => goToWeek(selectedWeekNum + 1)}
              disabled={selectedWeekNum >= totalWeeks}
              className="w-8 h-8 rounded-full bg-elevated border border-hairline flex items-center justify-center disabled:opacity-30"
              aria-label="Next week"
            >
              <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </header>

        {/* Week info bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {firstDate && lastDate && (
              <span className="text-xs text-text-3">
                {formatDate(firstDate)} – {formatDate(lastDate)}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${PHASE_BADGE[selectedWeek.phase]}`}>
              {selectedWeek.phase}
            </span>
            {selectedWeek.type !== "normal" && (
              <span className="rounded-full bg-elevated border border-hairline px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-2">
                {selectedWeek.type}
              </span>
            )}
          </div>
          <span className="text-xs font-semibold text-text-2">{selectedWeek.targetKm} km</span>
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
        <div className="flex items-center justify-between text-xs text-text-3">
          <span>{nonRest.length} workouts</span>
          <span>
            {isCurrent && <span className="text-accent font-semibold mr-1">Current week</span>}
            {selectedWeekNum} of {totalWeeks}
          </span>
        </div>

        {/* Workout list for this week */}
        <div className="flex flex-col gap-2">
          <DndContext
            sensors={useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))}
            collisionDetection={closestCenter}
            onDragEnd={() => {}}
          >
            <SortableContext
              items={selectedWeek.workouts.map((w) => w.sortOrder.toString())}
              strategy={verticalListSortingStrategy}
            >
              {selectedWeek.workouts.map((workout) => {
                const wId = workout.sortOrder.toString();
                return (
                  <WorkoutRow
                    key={wId}
                    workout={workout}
                    expanded={false}
                    onToggle={() => {}}
                    dimmed={isPastWeek(selectedWeek)}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        </div>

        {/* Plan overview link */}
        <div className="h-px bg-hairline mt-2" />
        <PlanHeader plan={plan} />
      </main>

      {/* Week dropdown */}
      <WeekDropdown
        weeks={plan.weeks}
        selectedWeek={selectedWeekNum}
        onSelect={setSelectedWeekNum}
        open={dropdownOpen}
        onClose={() => setDropdownOpen(false)}
      />

      <BottomNav active="plan" />
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <PlanPageInner />
    </Suspense>
  );
}
