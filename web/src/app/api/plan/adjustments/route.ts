import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, lt, lte, ne, inArray } from "drizzle-orm";
import { db, plans, workouts } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { queueGarminWorkoutMove } from "@/lib/sync/garmin-sync";
import { isConnected } from "@/lib/sync/gcal-client";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";
import { currentUserId } from "@/db/with-user";

// ── Plan adjustments ("adjustment tray") ─────────────────────────────────────
// Detects missed run sessions and lets the athlete realign: mark them missed,
// or redistribute their volume across the week's remaining runs. Works entirely
// on existing columns (status / date / targetKm) — no schema change.

const LOOKBACK_DAYS = 21; // don't nag about ancient backlog
const REDISTRIBUTE_CAP = 0.5; // add at most +50% of a run's own target

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Parse a client-supplied epoch-ms boundary. The client sends its LOCAL
// start-of-today / end-of-week because "missed" is a calendar-day judgement:
// the server clock is UTC on Vercel, and workout dates are stored at the
// athlete's local midnight (e.g. 22:00Z the day before for UTC+2), so a
// UTC-midnight cutoff would flag the current local day's run as missed hours
// before that day is actually over. Fall back to the server clock when absent.
function parseMs(v: string | null): Date | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d;
}

function thisWeekEnd(): Date {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const toSunday = dow === 0 ? 0 : 7 - dow;
  const end = new Date(now);
  end.setDate(now.getDate() + toSunday);
  end.setHours(23, 59, 59, 999);
  return end;
}

async function activePlanId(): Promise<string | null> {
  const [p] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.status, "active"), ownedBy(plans)))
    .limit(1);
  return p?.id ?? null;
}

// ── GET — surface missed sessions + redistribution context ────────────────────

export const GET = withSession(async (request: NextRequest) => {
  try {
    const planId = await activePlanId();
    if (!planId) return Response.json({ hasMissed: false, missed: [] });

    const url = new URL(request.url);
    const today = parseMs(url.searchParams.get("todayStart")) ?? startOfToday();
    const weekEnd = parseMs(url.searchParams.get("weekEnd")) ?? thisWeekEnd();
    const from = new Date(today);
    from.setDate(from.getDate() - LOOKBACK_DAYS);

    const missed = await db
      .select({
        id: workouts.id,
        date: workouts.date,
        type: workouts.type,
        title: workouts.title,
        targetKm: workouts.targetKm,
      })
      .from(workouts)
      .where(
        and(
          eq(workouts.planId, planId),
          ownedBy(workouts),
          eq(workouts.status, "planned"),
          ne(workouts.type, "rest"),
          gte(workouts.date, from),
          lt(workouts.date, today)
        )
      )
      .orderBy(workouts.date);

    // Remaining planned runs from today through the end of this calendar week.
    const remaining = await db
      .select({ id: workouts.id, targetKm: workouts.targetKm })
      .from(workouts)
      .where(
        and(
          eq(workouts.planId, planId),
          ownedBy(workouts),
          eq(workouts.status, "planned"),
          ne(workouts.type, "rest"),
          gte(workouts.date, today),
          lte(workouts.date, weekEnd)
        )
      );

    const missedKm = missed.reduce((s, w) => s + (w.targetKm ?? 0), 0);

    return Response.json({
      hasMissed: missed.length > 0,
      missed: missed.map((m) => ({ ...m, targetKm: m.targetKm ?? 0 })),
      missedKm: Math.round(missedKm * 10) / 10,
      remainingThisWeek: remaining.length,
      canRedistribute: remaining.length > 0 && missedKm > 0,
    });
  } catch (err) {
    console.error("DB error building plan adjustments:", err);
    return Response.json({ error: "Failed to load adjustments" }, { status: 500 });
  }
});

// ── POST — apply an adjustment ────────────────────────────────────────────────

const ApplySchema = z
  .object({
    action: z.enum(["skip", "redistribute"]),
    workoutIds: z.array(z.string().uuid()).min(1).max(50),
    // Client's local start-of-today / end-of-week (epoch ms) — see parseMs.
    todayStart: z.number().int().positive().optional(),
    weekEnd: z.number().int().positive().optional(),
  })
  .strict();

export const POST = withSession(async (request: NextRequest) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ApplySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const { action, workoutIds } = parsed.data;
  const today = parsed.data.todayStart ? new Date(parsed.data.todayStart) : startOfToday();
  const weekEnd = parsed.data.weekEnd ? new Date(parsed.data.weekEnd) : thisWeekEnd();

  try {
    const planId = await activePlanId();
    if (!planId) return Response.json({ error: "No active plan" }, { status: 404 });

    // Only act on rows that really are this plan's still-planned past sessions.
    const targets = await db
      .select({ id: workouts.id, targetKm: workouts.targetKm })
      .from(workouts)
      .where(
        and(
          eq(workouts.planId, planId),
          ownedBy(workouts),
          eq(workouts.status, "planned"),
          lt(workouts.date, today),
          inArray(workouts.id, workoutIds)
        )
      );

    if (targets.length === 0) {
      return Response.json({ error: "No matching missed sessions" }, { status: 422 });
    }
    const targetIds = targets.map((t) => t.id);
    const touched = new Set<string>();

    // Mark the missed sessions in both actions.
    await db
      .update(workouts)
      .set({ status: "missed", updatedAt: new Date() })
      .where(and(inArray(workouts.id, targetIds), ownedBy(workouts)));
    targetIds.forEach((id) => touched.add(id));

    let redistributed = 0;
    if (action === "redistribute") {
      const missedKm = targets.reduce((s, t) => s + (t.targetKm ?? 0), 0);
      const remaining = await db
        .select({ id: workouts.id, targetKm: workouts.targetKm })
        .from(workouts)
        .where(
          and(
            eq(workouts.planId, planId),
            ownedBy(workouts),
            eq(workouts.status, "planned"),
            ne(workouts.type, "rest"),
            gte(workouts.date, today),
            lte(workouts.date, weekEnd)
          )
        );

      if (remaining.length > 0 && missedKm > 0) {
        // Even share, but never add more than +50% of a run's own target.
        let pool = missedKm;
        const share = missedKm / remaining.length;
        for (const r of remaining) {
          const base = r.targetKm ?? 0;
          const cap = base * REDISTRIBUTE_CAP;
          const add = Math.min(share, cap, pool);
          if (add <= 0.05) continue;
          const newKm = Math.round((base + add) * 10) / 10;
          await db
            .update(workouts)
            .set({ targetKm: newKm, updatedAt: new Date() })
            .where(and(eq(workouts.id, r.id), ownedBy(workouts)));
          pool -= add;
          touched.add(r.id);
          redistributed++;
        }
      }
    }

    // Fan out to the watch (independent of GCal — self-gates on Garmin config)
    // and to Google Calendar if connected, for everything we touched.
    for (const id of touched) {
      queueGarminWorkoutMove(id).catch((e) =>
        console.error("Failed to queue Garmin workout update:", e)
      );
    }
    const adjustmentUserId = currentUserId();
    isConnected(adjustmentUserId)
      .then((connected) => {
        if (!connected) return;
        for (const id of touched) {
          queueWorkoutSync(id, "update", adjustmentUserId, "gcal").catch((e) =>
            console.error("Failed to queue workout sync:", e)
          );
        }
      })
      .catch(() => {});

    return Response.json({
      action,
      missedMarked: targetIds.length,
      redistributed,
    });
  } catch (err) {
    console.error("DB error applying plan adjustment:", err);
    return Response.json({ error: "Failed to apply adjustment" }, { status: 500 });
  }
});
