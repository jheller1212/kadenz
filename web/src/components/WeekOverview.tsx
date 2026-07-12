"use client";

export interface WeekDay {
  date: Date;
  type: string | null; // null = rest day
  status: string; // "planned" | "completed" | "skipped" | "missed"
  targetKm?: number | null;
}

interface Props {
  days: WeekDay[];
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

const typeColors: Record<string, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
  race: "#FF4D4D",
};

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function isPast(date: Date): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return date < now;
}

export function WeekOverview({ days }: Props) {
  return (
    <div
      className="k-card p-4"
      role="region"
      aria-label="Week overview"
    >
      <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">
        This Week
      </span>
      <div className="mt-3 flex justify-between">
        {days.map((day, i) => {
          const today = isToday(day.date);
          const past = isPast(day.date);
          const hasWorkout = day.type !== null && day.type !== "rest";
          const completed = day.status === "completed";
          const workoutColor = day.type ? (typeColors[day.type] ?? "#FAFAFA") : null;

          return (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <span
                className={`text-[10px] font-medium ${today ? "text-accent" : "text-text-3"}`}
              >
                {DAY_LABELS[i]}
              </span>

              {/* Day circle */}
              <div
                className={`relative flex items-center justify-center w-8 h-8 rounded-full
                  ${today ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}
                `}
                style={
                  completed && hasWorkout
                    ? { backgroundColor: workoutColor ?? "#FAFAFA" }
                    : { backgroundColor: "var(--color-elevated)" }
                }
                aria-label={`${day.date.toLocaleDateString("en", { weekday: "long" })}: ${
                  !hasWorkout
                    ? "rest"
                    : completed
                    ? "completed"
                    : "planned"
                }`}
              >
                {/* Completed: checkmark */}
                {completed && hasWorkout && (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="var(--color-bg)"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}

                {/* Planned: dot */}
                {!completed && hasWorkout && !today && (
                  <div
                    className="w-2 h-2 rounded-full"
                    style={
                      past
                        ? { backgroundColor: "var(--color-text-3)" }
                        : { backgroundColor: workoutColor ?? "var(--color-text-2)" }
                    }
                  />
                )}

                {/* Today + planned: accent dot */}
                {today && !completed && (
                  <div className="w-2 h-2 rounded-full bg-accent" />
                )}

                {/* Rest day */}
                {!hasWorkout && (
                  <div className="w-1.5 h-1.5 rounded-full bg-hairline" />
                )}
              </div>

              {/* Distance label */}
              <span
                className={`text-[10px] ${today ? "text-text-1 font-semibold" : "text-text-3"}`}
              >
                {day.targetKm ? `${day.targetKm}k` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
