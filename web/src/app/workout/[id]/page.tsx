"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { formatPace } from "@/lib/plan-engine/pace-zones";

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

const typeGradients: Record<string, string> = {
  easy: "from-[#1a3a1a] to-bg",
  recovery: "from-[#1a3a1a] to-bg",
  tempo: "from-[#3a2a00] to-bg",
  interval: "from-[#2a1a3a] to-bg",
  long: "from-[#1a2a3a] to-bg",
  race: "from-[#3a1a1a] to-bg",
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

const BLOCK_ICONS: Record<string, string> = {
  warmup: "M13 10V3L4 14h7v7l9-11h-7z",
  work: "M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M12 2a10 10 0 110 20 10 10 0 010-20z",
  recovery: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
  cooldown: "M13 10V3L4 14h7v7l9-11h-7z",
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

// ── Bottom Sheet Menu ───────────────────────────────────────────────────────

function ActionSheet({
  open,
  onClose,
  onSkip,
  workoutTitle,
}: {
  open: boolean;
  onClose: () => void;
  onSkip: () => void;
  workoutTitle: string;
}) {
  if (!open) return null;

  const actions = [
    { label: "Skip workout", icon: "M13 5l7 7-7 7M5 5l7 7-7 7", action: onSkip },
    { label: "Add a workout time", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", action: () => {} },
    { label: "Move workout", icon: "M8 7h12M8 12h12M8 17h12M3 7h.01M3 12h.01M3 17h.01", action: () => {} },
  ];

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 max-w-md mx-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-4 mb-2 rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden divide-y divide-hairline">
          {actions.map(({ label, icon, action }) => (
            <button
              key={label}
              onClick={() => { action(); onClose(); }}
              className="w-full flex items-center gap-3 px-5 py-4 text-left text-sm font-medium text-text-1 active:bg-elevated transition-colors"
            >
              <svg className="w-5 h-5 text-text-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mx-4 mb-6 w-[calc(100%-2rem)] rounded-[var(--radius-card)] bg-surface border border-hairline py-4 text-sm font-bold text-text-1 active:bg-elevated transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Workout Detail Page ────────────────────────────────────────────────

export default function WorkoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [workout, setWorkout] = useState<WorkoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"outdoor" | "treadmill">("outdoor");
  const [menuOpen, setMenuOpen] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        // Fetch from today API and find this workout
        const res = await fetch("/api/today");
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        const found = data.weekWorkouts?.find((w: WorkoutDetail) => w.id === id);
        if (found) setWorkout(found);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleComplete() {
    if (!workout || completing) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        setWorkout((prev) => prev ? { ...prev, status: "completed" } : prev);
      }
    } catch { /* silent */ } finally {
      setCompleting(false);
    }
  }

  async function handleSkip() {
    if (!workout) return;
    try {
      await fetch(`/api/workouts/${workout.id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualKm: 0 }),
      });
      router.back();
    } catch { /* silent */ }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!workout) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-text-2">Workout not found</p>
        <button onClick={() => router.back()} className="text-accent text-sm font-semibold">Go back</button>
      </div>
    );
  }

  const color = typeColors[workout.type] ?? "#FAFAFA";
  const gradient = typeGradients[workout.type] ?? "from-elevated to-bg";
  const isCompleted = workout.status === "completed";
  const workoutDate = new Date(workout.date);
  const dateStr = workoutDate.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

  // Get max easy pace for coaching tip
  const easyBlock = workout.blocks.find((b) => b.type === "warmup" || b.type === "cooldown");
  const maxPace = easyBlock?.maxPaceSecKm ?? workout.blocks[0]?.maxPaceSecKm;

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Gradient header */}
      <div className={`bg-gradient-to-b ${gradient} pt-12 pb-6 px-4`}>
        {/* Nav bar */}
        <div className="flex items-center justify-between max-w-md mx-auto mb-6">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-bg/30 backdrop-blur flex items-center justify-center"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-text-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMenuOpen(true)}
              className="text-text-2 px-2 py-1"
              aria-label="More options"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
            {/* Completion circle */}
            {isCompleted ? (
              <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center">
                <svg className="w-4 h-4 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full border-2 border-text-3" />
            )}
          </div>
        </div>

        {/* Workout title area */}
        <div className="max-w-md mx-auto">
          <h1 className="text-2xl font-extrabold text-text-1">{workout.title}</h1>
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-sm text-text-2">
              {typeLabels[workout.type] ?? workout.type} · {dateStr}
            </span>
          </div>

          {/* Stats row */}
          <div className="flex gap-6 mt-5">
            {workout.targetKm != null && (
              <div>
                <p className="text-xs text-text-3 uppercase tracking-wide">Distance</p>
                <p className="text-xl font-extrabold text-text-1">{workout.targetKm}km</p>
              </div>
            )}
            {workout.targetDurationMinutes != null && (
              <div>
                <p className="text-xs text-text-3 uppercase tracking-wide">Time</p>
                <p className="text-xl font-extrabold text-text-1">
                  {workout.targetDurationMinutes > 5
                    ? `${workout.targetDurationMinutes - 5}m - ${workout.targetDurationMinutes + 5}m`
                    : `~${workout.targetDurationMinutes}m`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 max-w-md mx-auto w-full px-4 pb-28">
        {/* Divider */}
        <div className="h-px bg-hairline my-5" />

        {/* Details header + Outdoor/Treadmill toggle */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-text-1">Details</h2>
          <div className="flex rounded-full bg-elevated border border-hairline p-0.5">
            <button
              onClick={() => setMode("outdoor")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                mode === "outdoor" ? "bg-surface text-text-1 shadow-sm" : "text-text-3"
              }`}
            >
              Outdoor
            </button>
            <button
              onClick={() => setMode("treadmill")}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                mode === "treadmill" ? "bg-surface text-text-1 shadow-sm" : "text-text-3"
              }`}
            >
              Treadmill
            </button>
          </div>
        </div>

        {/* Workout blocks */}
        <div className="flex flex-col gap-1">
          {workout.blocks.map((block, i) => {
            const isWork = block.type === "work";
            const blockColor = isWork ? color : "var(--color-text-3)";

            return (
              <div key={i}>
                {/* Block header */}
                <div className="flex items-center gap-3 py-3">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke={blockColor} strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={BLOCK_ICONS[block.type] ?? BLOCK_ICONS.work} />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-text-1">
                      {isWork ? BLOCK_LABEL[block.type] : `${BLOCK_LABEL[block.type] ?? block.type} (${block.durationMinutes ?? block.distanceKm ? `${block.distanceKm}km` : ""}${block.durationMinutes ? `${block.durationMinutes} mins` : ""})`}
                    </p>
                  </div>
                </div>

                {/* Work block detail */}
                {isWork && (
                  <div className="ml-8 mb-3">
                    <div
                      className="border-l-4 pl-4 py-2"
                      style={{ borderLeftColor: color }}
                    >
                      <p className="text-sm font-bold text-text-1">
                        {block.reps && block.repDistanceKm
                          ? `${block.reps}×${Math.round(block.repDistanceKm * 1000)}m`
                          : block.distanceKm
                          ? `${block.distanceKm}km`
                          : ""
                        }
                        {block.targetPaceSecKm && (
                          <span className="font-normal text-text-2">
                            {mode === "treadmill"
                              ? ` at ${paceToSpeed(block.targetPaceSecKm)} km/h`
                              : ` at ${formatPace(block.targetPaceSecKm)}/km`
                            }
                          </span>
                        )}
                      </p>
                      {block.minPaceSecKm && block.maxPaceSecKm && (
                        <p className="text-xs text-text-3 mt-0.5">
                          {mode === "treadmill"
                            ? `Speed: ${paceToSpeed(block.maxPaceSecKm)} – ${paceToSpeed(block.minPaceSecKm)} km/h`
                            : `Pace range: ${formatPace(block.minPaceSecKm)} – ${formatPace(block.maxPaceSecKm)}/km`
                          }
                        </p>
                      )}
                      {block.repRestSeconds != null && (
                        <p className="text-xs text-text-3 mt-0.5">{block.repRestSeconds}s rest between reps</p>
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
        </div>

        {/* Divider */}
        <div className="h-px bg-hairline my-5" />

        {/* Coaching tip */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-text-1">Coach tip</p>
            <p className="text-sm text-text-2 mt-1 leading-relaxed">
              {getCoachingTip(workout.type, workout.targetKm, maxPace)}
            </p>
          </div>
        </div>
      </main>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-bg/90 backdrop-blur-md border-t border-hairline px-4 py-4">
        <div className="max-w-md mx-auto">
          {isCompleted ? (
            <div className="w-full rounded-[var(--radius-input)] bg-elevated border border-hairline py-4 text-center text-sm font-bold text-text-2 flex items-center justify-center gap-2">
              <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Completed
            </div>
          ) : (
            <button
              onClick={handleComplete}
              disabled={completing}
              className="w-full rounded-[var(--radius-input)] bg-text-1 text-bg font-bold text-sm py-4 active:scale-[0.98] transition-transform disabled:opacity-60"
            >
              {completing ? "Saving..." : "Start Workout"}
            </button>
          )}
        </div>
      </div>

      {/* Action sheet */}
      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSkip={handleSkip}
        workoutTitle={workout.title}
      />
    </div>
  );
}
