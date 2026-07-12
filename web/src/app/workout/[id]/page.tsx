"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, MoreHorizontal, CheckCircle2, Flame, Wind, HeartPulse, SkipForward } from "lucide-react";
import { formatPace } from "@/lib/plan-engine/pace-zones";
import { useSettings } from "@/lib/useSettings";
import { PaceChart, PaceBadge } from "@/components/PaceChart";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { GuidedRun, type GuidedRunFinish } from "@/components/GuidedRun";
import { AnimatePresence } from "motion/react";
import { Radio } from "lucide-react";

// RPE mapping per workout zone
const ZONE_RPE: Record<string, string> = {
  warmup: "RPE 2-3",
  cooldown: "RPE 2-3",
  recovery: "RPE 2-3",
  work: "RPE 7-8",
};
const TYPE_RPE: Record<string, string> = {
  easy: "RPE 3-4",
  recovery: "RPE 2-3",
  long: "RPE 3-4",
  tempo: "RPE 7-8",
  interval: "RPE 8-9",
  race: "RPE 9-10",
};

// ── Types ────────────────────────────────────────────────────────────────────

interface WorkoutBlock {
  type: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  targetPaceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceKm?: number | null;
  repRestSeconds?: number | null;
  sortOrder: number;
}

interface WorkoutDetail {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  targetKm?: number | null;
  targetDurationMinutes?: number | null;
  status: string;
  date: string;
  dayOfWeek: number;
  blocks: WorkoutBlock[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const typeColors: Record<string, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
  race: "#FF4D4D",
};

const typeLabels: Record<string, string> = {
  easy: "Easy Run",
  recovery: "Recovery",
  tempo: "Tempo",
  interval: "Intervals",
  long: "Long Run",
  race: "Race",
};

const BLOCK_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  work: "Session",
  recovery: "Recovery jog",
  cooldown: "Cool-down",
};

const BLOCK_ICON: Record<string, typeof Flame> = {
  warmup: Flame,
  work: HeartPulse,
  recovery: Wind,
  cooldown: Flame,
};

// ── Coaching tips per workout type ──────────────────────────────────────────

function getCoachingTip(type: string, targetKm?: number | null, maxPace?: number | null): string {
  const paceStr = maxPace ? formatPace(maxPace) : null;

  switch (type) {
    case "easy":
    case "recovery":
      return `Keep this run genuinely easy. You get no extra fitness points for going fast on easy days! ${
        paceStr ? `Stay slower than ${paceStr}/km and` : "Focus on"
      } relaxed, conversational running.`;
    case "long":
      return `Build endurance at a comfortable pace. Start easy and stay controlled throughout. ${
        targetKm && targetKm > 20 ? "Consider carrying water and fuel for this one." : "Focus on time on feet, not speed."
      }`;
    case "tempo":
      return "Comfortably hard — you should be able to speak in short sentences but not hold a full conversation. Stay controlled and resist going too fast early.";
    case "interval":
      return "Push hard during the work intervals, then recover fully between reps. The rest is important — don't cut it short. Quality over quantity.";
    case "race":
      return "Race day! Trust your training. Start conservatively and negative-split if you can. You've earned this.";
    default:
      return "Run at the prescribed effort level and listen to your body.";
  }
}

// ── Pace to speed conversion (for treadmill) ────────────────────────────────

function paceToSpeed(secPerKm: number): string {
  const kmPerHour = 3600 / secPerKm;
  return kmPerHour.toFixed(1);
}

// ── Options sheet ────────────────────────────────────────────────────────────

function OptionsSheet({
  open,
  onClose,
  onSkip,
}: {
  open: boolean;
  onClose: () => void;
  onSkip: () => void;
}) {
  const actions = [{ label: "Skip workout", Icon: SkipForward, action: onSkip }];

  return (
    <Sheet open={open} onClose={onClose} title="Workout options">
      <div className="flex flex-col gap-1 pb-2">
        {actions.map(({ label, Icon, action }) => (
          <button
            key={label}
            onClick={() => {
              haptic("light");
              action();
              onClose();
            }}
            className="press flex w-full items-center gap-3 rounded-[var(--radius-input)] px-2 py-3.5 text-left active:bg-elevated"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated">
              <Icon className="h-[18px] w-[18px] text-text-2" strokeWidth={1.9} />
            </span>
            <span className="text-[15px] font-medium text-text-1">{label}</span>
          </button>
        ))}
        <div className="pt-2">
          <Button variant="secondary" full onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

// ── Back button ──────────────────────────────────────────────────────────────

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

// ── Main Workout Detail Page ────────────────────────────────────────────────

export default function WorkoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  useSwipeBack();
  const { id } = use(params);
  const router = useRouter();
  const settings = useSettings();
  const useMiles = settings.units === "miles";
  const showPace = settings.paceTargets;
  const showEasyPace = settings.paceTargetsEasyRuns;
  const useRpe = settings.workoutTargetMode === "rpe";
  const [workout, setWorkout] = useState<WorkoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mode, setMode] = useState<"outdoor" | "treadmill">("outdoor");
  const [menuOpen, setMenuOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [guiding, setGuiding] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await apiFetch(`/api/workouts/${id}`);
        if (res.status === 404) {
          setError("Workout not found.");
          return;
        }
        if (!res.ok) throw new Error("Failed");
        setWorkout(await res.json());
      } catch {
        setError("Couldn't load this workout. Please try again.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleComplete() {
    if (!workout || completing) return;
    setCompleting(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        haptic("success");
        setWorkout((prev) => prev ? { ...prev, status: "completed" } : prev);
      } else {
        setActionError("Couldn't save your workout. Please try again.");
      }
    } catch {
      setActionError("Couldn't save your workout. Please try again.");
    } finally {
      setCompleting(false);
    }
  }

  async function handleGuidedFinish(summary: GuidedRunFinish) {
    setGuiding(false);
    if (!workout) return;
    setActionError(null);
    try {
      const res = await apiFetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          summary.distanceKm != null ? { actualKm: summary.distanceKm } : {}
        ),
      });
      if (res.ok) {
        haptic("success");
        setWorkout((prev) => (prev ? { ...prev, status: "completed" } : prev));
      } else {
        setActionError("Run saved locally, but we couldn't mark it complete. Try again.");
      }
    } catch {
      setActionError("Run saved locally, but we couldn't mark it complete. Try again.");
    }
  }

  async function handleSkip() {
    if (!workout) return;
    try {
      const res = await apiFetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualKm: 0 }),
      });
      if (res.ok) {
        router.back();
      } else {
        setActionError("Couldn't skip this workout. Please try again.");
      }
    } catch {
      setActionError("Couldn't skip this workout. Please try again.");
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Workout" large={false} left={<BackButton />} />
        <div className="px-4 pb-tabbar flex flex-col gap-3 pt-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (error || !workout) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Workout" large={false} left={<BackButton />} />
        <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center pb-tabbar">
          <p className="text-[15px] text-text-2">{error ?? "Workout not found"}</p>
          <Button variant="secondary" onClick={() => router.back()}>Go back</Button>
        </div>
      </main>
    );
  }

  const color = typeColors[workout.type] ?? "#FAFAFA";
  const isCompleted = workout.status === "completed";
  const workoutDate = new Date(workout.date);
  const dateStr = workoutDate.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

  // Get max easy pace for coaching tip
  const easyBlock = workout.blocks.find((b) => b.type === "warmup" || b.type === "cooldown");
  const maxPace = easyBlock?.maxPaceSecKm ?? workout.blocks[0]?.maxPaceSecKm;

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title={workout.title}
        large={false}
        left={<BackButton />}
        right={
          <button
            onClick={() => {
              haptic("light");
              setMenuOpen(true);
            }}
            className="press flex h-9 w-9 items-center justify-center rounded-full"
            aria-label="More options"
          >
            <MoreHorizontal className="h-5 w-5 text-text-2" strokeWidth={2} />
          </button>
        }
      />

      <div className="px-4 pb-tabbar flex flex-col gap-4 pt-1">
        {/* Hero card with workout-type accent */}
        <section
          className="rounded-[var(--radius-card)] p-4"
          style={{ backgroundColor: `${color}1A` }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[13px] font-semibold text-text-2">
                  {typeLabels[workout.type] ?? workout.type} · {dateStr}
                </span>
              </div>
              <h1 className="mt-1.5 text-[22px] font-bold tracking-tight text-text-1">{workout.title}</h1>
            </div>
            {isCompleted ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent">
                <CheckCircle2 className="h-5 w-5 text-on-accent" strokeWidth={2.4} />
              </div>
            ) : (
              <div className="h-8 w-8 shrink-0 rounded-full border-2 border-text-3" />
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-end gap-6 mt-5">
            {workout.targetKm != null && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Distance</p>
                <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                  {useMiles ? `${(workout.targetKm * 0.621371).toFixed(1)}mi` : `${workout.targetKm}km`}
                </p>
              </div>
            )}
            {workout.targetDurationMinutes != null && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-text-3">Time</p>
                <p className="text-[22px] font-extrabold tabular-nums text-text-1">
                  {workout.targetDurationMinutes > 5
                    ? `${workout.targetDurationMinutes - 5}m - ${workout.targetDurationMinutes + 5}m`
                    : `~${workout.targetDurationMinutes}m`}
                </p>
              </div>
            )}
            <div className="ml-auto">
              <PaceBadge blocks={workout.blocks} workoutType={workout.type} color={color} useMiles={useMiles} />
            </div>
          </div>

          {/* Pace structure visualization */}
          {workout.blocks.length > 0 && (
            <div className="mt-4">
              <PaceChart
                blocks={workout.blocks}
                workoutType={workout.type}
                variant="full"
                color={color}
                useMiles={useMiles}
              />
            </div>
          )}
        </section>

        {actionError && (
          <div className="rounded-[var(--radius-card)] bg-danger/10 p-4 text-[13px] text-danger">
            {actionError}
          </div>
        )}

        {/* Details header + Outdoor/Treadmill toggle */}
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold text-text-1">Details</h2>
          <Segmented
            options={[
              { value: "outdoor", label: "Outdoor" },
              { value: "treadmill", label: "Treadmill" },
            ]}
            value={mode}
            onChange={setMode}
            className="w-[200px]"
          />
        </div>

        {/* Workout blocks */}
        <section className="k-card p-4 flex flex-col gap-1">
          {workout.blocks.map((block, i) => {
            const isWork = block.type === "work";
            const blockColor = isWork ? color : "var(--k-text-3)";
            const BlockIcon = BLOCK_ICON[block.type] ?? HeartPulse;

            return (
              <div key={i}>
                {/* Block header */}
                <div className="flex items-center gap-3 py-2.5">
                  <BlockIcon className="h-5 w-5 shrink-0" style={{ color: blockColor }} strokeWidth={1.75} />
                  <div className="flex-1">
                    <p className="text-[15px] font-medium text-text-1">
                      {isWork ? BLOCK_LABEL[block.type] : `${BLOCK_LABEL[block.type] ?? block.type} (${block.durationMinutes ?? block.distanceKm ? `${block.distanceKm}km` : ""}${block.durationMinutes ? `${block.durationMinutes} mins` : ""})`}
                    </p>
                  </div>
                </div>

                {/* Work block detail */}
                {isWork && (
                  <div className="ml-8 mb-3">
                    <div
                      className="border-l-4 pl-4 py-2 rounded-r-[var(--radius-input)]"
                      style={{ borderLeftColor: color, backgroundColor: "var(--k-elevated)" }}
                    >
                      <p className="text-[15px] font-bold text-text-1">
                        {block.reps && block.repDistanceKm
                          ? `${block.reps}×${Math.round(block.repDistanceKm * 1000)}m`
                          : block.distanceKm
                          ? `${useMiles ? `${(block.distanceKm * 0.621371).toFixed(1)}mi` : `${block.distanceKm}km`}`
                          : ""
                        }
                        {(() => {
                          const isEasy = workout.type === "easy" || workout.type === "recovery";
                          const shouldShowPace = showPace && (isEasy ? showEasyPace : true);
                          if (useRpe && block.targetPaceSecKm) {
                            return <span className="font-normal text-text-2"> at {ZONE_RPE[block.type] ?? TYPE_RPE[workout.type] ?? "RPE 5-6"}</span>;
                          }
                          if (shouldShowPace && block.targetPaceSecKm) {
                            const unit = useMiles ? "/mi" : "/km";
                            return <span className="font-normal text-text-2">
                              {mode === "treadmill"
                                ? ` at ${paceToSpeed(block.targetPaceSecKm)} km/h`
                                : ` at ${formatPace(block.targetPaceSecKm, useMiles)}${unit}`
                              }
                            </span>;
                          }
                          return null;
                        })()}
                      </p>
                      {(() => {
                        const isEasy = workout.type === "easy" || workout.type === "recovery";
                        const shouldShowPace = showPace && (isEasy ? showEasyPace : true) && !useRpe;
                        if (!shouldShowPace || !block.minPaceSecKm || !block.maxPaceSecKm) return null;
                        const unit = useMiles ? "/mi" : "/km";
                        return (
                          <p className="text-[13px] text-text-3 mt-0.5">
                            {mode === "treadmill"
                              ? `Speed: ${paceToSpeed(block.maxPaceSecKm)} – ${paceToSpeed(block.minPaceSecKm)} km/h`
                              : `Pace range: ${formatPace(block.minPaceSecKm, useMiles)} – ${formatPace(block.maxPaceSecKm, useMiles)}${unit}`
                            }
                          </p>
                        );
                      })()}
                      {block.repRestSeconds != null && (
                        <p className="text-[13px] text-text-3 mt-0.5">{block.repRestSeconds}s rest between reps</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Dashed divider between blocks */}
                {i < workout.blocks.length - 1 && (
                  <div className="ml-8 border-b border-dashed border-hairline" />
                )}
              </div>
            );
          })}
        </section>

        {/* Coaching tip */}
        <section className="k-card p-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/20 mt-0.5">
            <HeartPulse className="h-5 w-5 text-accent" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-[15px] font-bold text-text-1">Coach tip</p>
            <p className="mt-1 text-[13px] text-text-2 leading-relaxed">
              {getCoachingTip(workout.type, workout.targetKm, maxPace)}
            </p>
          </div>
        </section>

        {/* Primary action */}
        <div className="pt-1 flex flex-col gap-2.5">
          {isCompleted ? (
            <div className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-input)] bg-elevated py-4 text-center text-[15px] font-bold text-text-2">
              <CheckCircle2 className="h-4 w-4 text-accent" strokeWidth={2.5} />
              Completed
            </div>
          ) : (
            <>
              <Button
                variant="primary"
                full
                size="lg"
                onClick={() => {
                  haptic("medium");
                  setGuiding(true);
                }}
              >
                <span className="flex items-center justify-center gap-2">
                  <Radio className="h-5 w-5" strokeWidth={2.2} />
                  Start guided run
                </span>
              </Button>
              <Button variant="secondary" full busy={completing} onClick={handleComplete}>
                {completing ? "Saving..." : "Mark complete"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Guided run overlay */}
      <AnimatePresence>
        {guiding && (
          <GuidedRun
            title={workout.title}
            blocks={workout.blocks}
            useMiles={useMiles}
            onFinish={handleGuidedFinish}
            onClose={() => setGuiding(false)}
          />
        )}
      </AnimatePresence>

      {/* Options sheet */}
      <OptionsSheet open={menuOpen} onClose={() => setMenuOpen(false)} onSkip={handleSkip} />
    </main>
  );
}
