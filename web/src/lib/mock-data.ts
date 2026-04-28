export type WorkoutType = "easy" | "tempo" | "interval" | "long" | "rest";

export interface WorkoutBlock {
  label: string;
  description: string;
  duration: string;
  pace?: string;
}

export interface Workout {
  type: WorkoutType;
  title: string;
  description: string;
  targetDistance: number; // km
  targetDuration: string; // e.g. "55 min"
  paceTarget: string; // e.g. "5:30–5:50 /km"
  blocks: WorkoutBlock[];
}

export interface DayOverview {
  date: Date;
  workout: Workout | null;
  completed: boolean;
}

const today = new Date();
today.setHours(0, 0, 0, 0);

function daysFromToday(offset: number): Date {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d;
}

// Start of current week (Monday)
const dayOfWeek = today.getDay(); // 0=Sun
const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

export const todayWorkout: Workout = {
  type: "tempo",
  title: "Threshold Run",
  description:
    "Build lactate threshold with a sustained effort in the comfortably hard zone. Keep breathing controlled.",
  targetDistance: 10,
  targetDuration: "52 min",
  paceTarget: "4:55–5:10 /km",
  blocks: [
    {
      label: "Warm-up",
      description: "Easy jog, relaxed",
      duration: "10 min",
      pace: "6:00–6:30 /km",
    },
    {
      label: "Tempo",
      description: "Comfortably hard, sustained effort",
      duration: "30 min",
      pace: "4:55–5:10 /km",
    },
    {
      label: "Cool-down",
      description: "Easy jog, shake out legs",
      duration: "10 min",
      pace: "6:15–6:45 /km",
    },
  ],
};

export const weekDays: DayOverview[] = [
  {
    date: daysFromToday(mondayOffset),
    workout: {
      type: "easy",
      title: "Recovery Run",
      description: "Easy aerobic base",
      targetDistance: 7,
      targetDuration: "45 min",
      paceTarget: "6:00–6:30 /km",
      blocks: [],
    },
    completed: true,
  },
  {
    date: daysFromToday(mondayOffset + 1),
    workout: {
      type: "interval",
      title: "Track Intervals",
      description: "6×800m at 5K pace",
      targetDistance: 9,
      targetDuration: "50 min",
      paceTarget: "4:20–4:30 /km",
      blocks: [],
    },
    completed: true,
  },
  {
    date: daysFromToday(mondayOffset + 2),
    workout: {
      type: "easy",
      title: "Easy Run",
      description: "Low aerobic effort",
      targetDistance: 6,
      targetDuration: "40 min",
      paceTarget: "6:10–6:40 /km",
      blocks: [],
    },
    completed: true,
  },
  {
    date: today,
    workout: todayWorkout,
    completed: false,
  },
  {
    date: daysFromToday(mondayOffset + 4),
    workout: {
      type: "easy",
      title: "Recovery Run",
      description: "Active recovery",
      targetDistance: 5,
      targetDuration: "35 min",
      paceTarget: "6:20–6:50 /km",
      blocks: [],
    },
    completed: false,
  },
  {
    date: daysFromToday(mondayOffset + 5),
    workout: null, // rest day
    completed: false,
  },
  {
    date: daysFromToday(mondayOffset + 6),
    workout: {
      type: "long",
      title: "Long Run",
      description: "Build endurance base at conversational pace",
      targetDistance: 18,
      targetDuration: "1h 55 min",
      paceTarget: "6:00–6:20 /km",
      blocks: [],
    },
    completed: false,
  },
];

export const weeklyStats = {
  plannedKm: weekDays.reduce((sum, d) => sum + (d.workout?.targetDistance ?? 0), 0),
  completedKm: weekDays
    .filter((d) => d.completed)
    .reduce((sum, d) => sum + (d.workout?.targetDistance ?? 0), 0),
  daysCompleted: weekDays.filter((d) => d.completed).length,
  totalDays: weekDays.filter((d) => d.workout !== null).length,
};
