import { db, activities } from "@/db";
import { isNotNull } from "drizzle-orm";

// ── GET /api/performance ──────────────────────────────────────────────────────
// Lifetime running stats, personal records, and achievement badges derived from
// recorded activities (Benchmark-style "Performance" tab). Runs only — strength
// sessions carry no distance and are excluded.

interface RawSplit {
  paceSecKm?: number;
  paceSecKmDerived?: number;
  km?: number;
  average_speed?: number;
  split?: number;
}

// Standard race distances (km) used for projected PRs.
const RACE_DISTANCES: { key: string; label: string; km: number }[] = [
  { key: "1k", label: "1K", km: 1 },
  { key: "5k", label: "5K", km: 5 },
  { key: "10k", label: "10K", km: 10 },
  { key: "hm", label: "Half", km: 21.0975 },
  { key: "m", label: "Marathon", km: 42.195 },
];

function isRun(a: { distanceKm: number | null; strengthSessionId: string | null }) {
  return a.strengthSessionId == null && (a.distanceKm ?? 0) > 0.3;
}

// Fastest single km from a run's per-km splits (sec/km).
function fastestKmFromSplits(splitsJson: unknown): number | null {
  if (!Array.isArray(splitsJson)) return null;
  let best: number | null = null;
  for (const s of splitsJson as RawSplit[]) {
    const pace =
      s.paceSecKm ??
      (typeof s.average_speed === "number" && s.average_speed > 0
        ? Math.round(1000 / s.average_speed)
        : null);
    if (pace != null && pace > 0 && (best == null || pace < best)) best = pace;
  }
  return best;
}

export async function GET() {
  try {
    const rows = await db
      // Best efforts are computed from per-km splits, so those are needed —
      // but laps, route polylines and AI insight text never were.
      .select({
        startDate: activities.startDate,
        sportType: activities.sportType,
        distanceKm: activities.distanceKm,
        durationSeconds: activities.durationSeconds,
        elevationGain: activities.elevationGain,
        createdAt: activities.createdAt,
        name: activities.name,
        avgPaceSecKm: activities.avgPaceSecKm,
        splitsJson: activities.splitsJson,
        id: activities.id,
        strengthSessionId: activities.strengthSessionId,
      })
      .from(activities)
      .where(isNotNull(activities.startDate));

    const runs = rows
      .filter(isRun)
      .sort(
        (a, b) =>
          new Date(a.startDate ?? a.createdAt).getTime() -
          new Date(b.startDate ?? b.createdAt).getTime()
      );

    if (runs.length === 0) {
      return Response.json({ hasData: false });
    }

    // ── Lifetime totals ──────────────────────────────────────────────────────
    const totalKm = runs.reduce((s, r) => s + (r.distanceKm ?? 0), 0);
    const totalSeconds = runs.reduce((s, r) => s + (r.durationSeconds ?? 0), 0);
    const totalElevation = runs.reduce((s, r) => s + (r.elevationGain ?? 0), 0);
    const longestRun = runs.reduce(
      (max, r) => Math.max(max, r.distanceKm ?? 0),
      0
    );

    // ── This-year / this-month rollups ───────────────────────────────────────
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let yearKm = 0;
    let monthKm = 0;
    for (const r of runs) {
      const t = new Date(r.startDate ?? r.createdAt).getTime();
      if (t >= yearStart) yearKm += r.distanceKm ?? 0;
      if (t >= monthStart) monthKm += r.distanceKm ?? 0;
    }

    // Monthly distance for the trailing 12 months (oldest → newest).
    const monthly: { label: string; km: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const from = d.getTime();
      const to = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      const km = runs.reduce((s, r) => {
        const t = new Date(r.startDate ?? r.createdAt).getTime();
        return t >= from && t < to ? s + (r.distanceKm ?? 0) : s;
      }, 0);
      monthly.push({
        label: d.toLocaleDateString("en-US", { month: "short" }),
        km: Math.round(km),
      });
    }

    // ── Personal records ─────────────────────────────────────────────────────
    // Projected best time per standard distance: the fastest sustained average
    // pace over a run at least that long, applied to the target distance.
    const records = RACE_DISTANCES.map(({ key, label, km }) => {
      if (key === "1k") {
        // Fastest single km across all runs (from splits, else short-run pace).
        let best: { pace: number; date: string } | null = null;
        for (const r of runs) {
          const fromSplit = fastestKmFromSplits(r.splitsJson);
          const cand =
            fromSplit ??
            ((r.distanceKm ?? 0) >= 0.8 ? r.avgPaceSecKm ?? null : null);
          if (cand != null && cand > 0 && (best == null || cand < best.pace)) {
            best = {
              pace: cand,
              date: new Date(r.startDate ?? r.createdAt).toISOString(),
            };
          }
        }
        return best
          ? { key, label, timeSeconds: best.pace, paceSecKm: best.pace, date: best.date }
          : { key, label, timeSeconds: null, paceSecKm: null, date: null };
      }
      let best: { pace: number; date: string } | null = null;
      for (const r of runs) {
        if ((r.distanceKm ?? 0) >= km * 0.95 && (r.avgPaceSecKm ?? 0) > 0) {
          const pace = r.avgPaceSecKm!;
          if (best == null || pace < best.pace) {
            best = {
              pace,
              date: new Date(r.startDate ?? r.createdAt).toISOString(),
            };
          }
        }
      }
      return best
        ? {
            key,
            label,
            timeSeconds: Math.round(best.pace * km),
            paceSecKm: best.pace,
            date: best.date,
          }
        : { key, label, timeSeconds: null, paceSecKm: null, date: null };
    });

    // Best average pace over any run ≥ 3 km (used for pace achievements).
    const bestPace = runs.reduce<number | null>((best, r) => {
      if ((r.distanceKm ?? 0) >= 3 && (r.avgPaceSecKm ?? 0) > 0) {
        return best == null ? r.avgPaceSecKm! : Math.min(best, r.avgPaceSecKm!);
      }
      return best;
    }, null);

    // ── Weekly streak (consecutive ISO weeks with ≥1 run, up to this week) ────
    const weekKeys = new Set(
      runs.map((r) => {
        const d = new Date(r.startDate ?? r.createdAt);
        const day = (d.getDay() + 6) % 7; // Mon=0
        d.setDate(d.getDate() - day);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
      })
    );
    const MS_WEEK = 7 * 24 * 3600 * 1000;
    const thisWeek = (() => {
      const d = new Date(now);
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    let streak = 0;
    // Allow the streak to count from this week or last week (grace for mid-week).
    let cursor = weekKeys.has(thisWeek) ? thisWeek : thisWeek - MS_WEEK;
    while (weekKeys.has(cursor)) {
      streak++;
      cursor -= MS_WEEK;
    }

    // ── Achievement badges ───────────────────────────────────────────────────
    const badges = buildBadges({
      runCount: runs.length,
      totalKm,
      longestRun,
      bestPace,
      streak,
    });

    return Response.json({
      hasData: true,
      totals: {
        runCount: runs.length,
        totalKm: Math.round(totalKm * 10) / 10,
        totalSeconds,
        totalElevation: Math.round(totalElevation),
        longestRunKm: Math.round(longestRun * 10) / 10,
        yearKm: Math.round(yearKm),
        monthKm: Math.round(monthKm),
        streakWeeks: streak,
      },
      records,
      monthly,
      badges,
    });
  } catch (err) {
    console.error("DB error building performance:", err);
    return Response.json({ error: "Failed to build performance" }, { status: 500 });
  }
}

// ── Badge ladders ──────────────────────────────────────────────────────────────
// Each ladder returns the highest tier earned + the next locked target, so the
// UI can show earned badges and one "in progress" chip per category.

interface BadgeInput {
  runCount: number;
  totalKm: number;
  longestRun: number;
  bestPace: number | null;
  streak: number;
}

interface Badge {
  category: string;
  label: string;
  earned: boolean;
  value: number;
  target: number;
}

function ladder(
  category: string,
  value: number,
  tiers: number[],
  fmt: (t: number) => string
): Badge[] {
  const out: Badge[] = [];
  let nextShown = false;
  for (const t of tiers) {
    const earned = value >= t;
    if (earned) {
      out.push({ category, label: fmt(t), earned: true, value, target: t });
    } else if (!nextShown) {
      out.push({ category, label: fmt(t), earned: false, value, target: t });
      nextShown = true;
    }
  }
  return out;
}

function buildBadges(input: BadgeInput): Badge[] {
  const badges: Badge[] = [];
  badges.push(
    ...ladder("Runs", input.runCount, [1, 10, 25, 50, 100, 250], (t) =>
      t === 1 ? "First run" : `${t} runs`
    )
  );
  badges.push(
    ...ladder("Distance", input.totalKm, [50, 100, 250, 500, 1000], (t) =>
      `${t} km logged`
    )
  );
  badges.push(
    ...ladder("Longest", input.longestRun, [5, 10, 21.0975, 30, 42.195], (t) =>
      t === 21.0975 ? "Half distance" : t === 42.195 ? "Marathon distance" : `${t} km run`
    )
  );
  badges.push(
    ...ladder("Streak", input.streak, [2, 4, 8, 16, 26], (t) => `${t}-week streak`)
  );
  // Pace ladder is inverted (lower is better) — express as targets you dip under.
  if (input.bestPace != null) {
    const paceTiers = [360, 330, 300, 270, 240]; // 6:00 → 4:00 /km
    let nextShown = false;
    for (const t of paceTiers) {
      const earned = input.bestPace <= t;
      const label = `Sub ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}/km`;
      if (earned) {
        badges.push({ category: "Pace", label, earned: true, value: input.bestPace, target: t });
      } else if (!nextShown) {
        badges.push({ category: "Pace", label, earned: false, value: input.bestPace, target: t });
        nextShown = true;
      }
    }
  }
  return badges;
}
