import { NextRequest } from "next/server";
import { z } from "zod";
import { db, activities, workouts, blocks, plans } from "@/db";
import { eq, and, gte, ne, asc } from "drizzle-orm";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";

// ── POST /api/activities/[id]/insights ───────────────────────────────────────
// Generates (or returns the cached) AI workout insight for an activity. The
// feature is dark unless ANTHROPIC_API_KEY is configured — the client hides
// the card on a 501. The result is cached on the activity row so it is
// generated once; { regenerate: true } re-runs and overwrites the cache.

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";

const BodySchema = z
  .object({
    regenerate: z.boolean().optional(),
    // HR zone split computed client-side (zone bounds are a device setting).
    hrZones: z
      .array(z.object({ label: z.string().max(20), pct: z.number() }))
      .max(6)
      .optional(),
  })
  .strict();

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

const RACE_LABELS: Record<string, string> = {
  "5k": "5K",
  "10k": "10K",
  half: "half marathon",
  marathon: "marathon",
};

interface StoredSplit {
  split: number;
  average_speed: number;
}

export const POST = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "not_configured" }, { status: 501 });
  }

  const { id } = await params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — treat as {}.
  }
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Validation failed" }, { status: 422 });
  }
  const { regenerate, hrZones } = parsed.data;

  // Outside the try below so its 404 reaches withSession directly.
  const activity = await requireOwned(activities, id);

  try {
    if (activity.aiInsight && !regenerate) {
      return Response.json({
        insight: activity.aiInsight,
        generatedAt: activity.aiInsightGeneratedAt?.toISOString() ?? null,
      });
    }

    // ── Assemble compact run context ─────────────────────────────────────────
    const lines: string[] = [];
    lines.push(
      `Run: ${(activity.distanceKm ?? 0).toFixed(2)} km in ${Math.round(
        (activity.durationSeconds ?? 0) / 60
      )} min` +
        (activity.avgPaceSecKm ? `, avg pace ${formatPace(activity.avgPaceSecKm)}` : "") +
        (activity.avgHr ? `, avg HR ${activity.avgHr} bpm (max ${activity.maxHr ?? "?"})` : "") +
        (activity.elevationGain != null ? `, ${Math.round(activity.elevationGain)} m elevation gain` : "")
    );
    if (activity.startDate) {
      lines.push(`Date: ${activity.startDate.toISOString().slice(0, 10)}`);
    }

    const rawSplits = Array.isArray(activity.splitsJson)
      ? (activity.splitsJson as StoredSplit[])
      : [];
    if (rawSplits.length > 0) {
      const paces = rawSplits
        .filter((s) => s.average_speed > 0)
        .map((s) => formatPace(Math.round(1000 / s.average_speed)));
      if (paces.length > 0) lines.push(`Km splits: ${paces.join(", ")}`);
    }

    if (hrZones && hrZones.some((zone) => zone.pct > 0)) {
      lines.push(
        `HR zone time: ${hrZones
          .filter((zone) => zone.pct > 0)
          .map((zone) => `${zone.label} ${Math.round(zone.pct)}%`)
          .join(", ")}`
      );
    }

    // Linked planned workout + its targets.
    if (activity.workoutId) {
      const [workout] = await db
        .select()
        .from(workouts)
        .where(and(eq(workouts.id, activity.workoutId), ownedBy(workouts)))
        .limit(1);
      if (workout) {
        const workoutBlocks = await db
          .select()
          .from(blocks)
          .where(and(eq(blocks.workoutId, workout.id), ownedBy(blocks)))
          .orderBy(blocks.sortOrder);
        const targets = workoutBlocks
          .map((b) => {
            const parts: string[] = [b.type];
            if (b.reps && b.repDistanceKm) parts.push(`${b.reps}x${Math.round(b.repDistanceKm * 1000)}m`);
            else if (b.distanceKm) parts.push(`${b.distanceKm} km`);
            else if (b.durationMinutes) parts.push(`${b.durationMinutes} min`);
            if (b.targetPaceSecKm) parts.push(`@ ${formatPace(b.targetPaceSecKm)}`);
            return parts.join(" ");
          })
          .join("; ");
        lines.push(
          `Planned workout: "${workout.title}" (${workout.type})${targets ? ` — ${targets}` : ""}`
        );
      }
    } else {
      lines.push("Planned workout: none (unplanned run)");
    }

    // Plan context: goal race + the next planned session.
    const [activePlan] = await db
      .select({
        id: plans.id,
        raceDistance: plans.raceDistance,
        raceDate: plans.raceDate,
        goalTimeSeconds: plans.goalTimeSeconds,
      })
      .from(plans)
      .where(and(ownedBy(plans), eq(plans.status, "active")))
      .limit(1);
    if (activePlan) {
      const daysToRace = Math.max(
        0,
        Math.round((activePlan.raceDate.getTime() - Date.now()) / 86400000)
      );
      lines.push(
        `Training for: ${RACE_LABELS[activePlan.raceDistance] ?? activePlan.raceDistance}, race in ${daysToRace} days`
      );
      const refDate = activity.startDate ?? new Date();
      const [nextWorkout] = await db
        .select({ title: workouts.title, type: workouts.type, date: workouts.date })
        .from(workouts)
        .where(
          and(
            ownedBy(workouts),
            eq(workouts.planId, activePlan.id),
            eq(workouts.status, "planned"),
            ne(workouts.type, "rest"),
            gte(workouts.date, refDate)
          )
        )
        .orderBy(asc(workouts.date))
        .limit(1);
      if (nextWorkout) {
        lines.push(
          `Next planned session: "${nextWorkout.title}" (${nextWorkout.type}) on ${nextWorkout.date.toISOString().slice(0, 10)}`
        );
      }
    }

    // ── Generate ─────────────────────────────────────────────────────────────
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system:
          "You write the post-run insight card in Kadenz, a running training app. " +
          "Write 3-4 encouraging but specific sentences addressed directly to the runner as 'you'. " +
          "Ground every observation in the numbers provided — pacing consistency, heart rate control, " +
          "how the run compared to its planned targets, and how it fits the goal race. " +
          "If something was off target, frame it constructively. " +
          "Plain prose only: no headings, no bullet points, no emojis, no markdown.",
        messages: [{ role: "user", content: lines.join("\n") }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Insight generation failed:", res.status, text);
      return Response.json({ error: "generation_failed" }, { status: 502 });
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const insight = (data.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("")
      .trim();
    if (!insight) {
      return Response.json({ error: "generation_failed" }, { status: 502 });
    }

    const generatedAt = new Date();
    await db
      .update(activities)
      .set({ aiInsight: insight, aiInsightGeneratedAt: generatedAt })
      .where(and(eq(activities.id, id), ownedBy(activities)));

    return Response.json({ insight, generatedAt: generatedAt.toISOString() });
  } catch (err) {
    console.error("Error generating activity insight:", err);
    return Response.json({ error: "Failed to generate insight" }, { status: 500 });
  }
});
