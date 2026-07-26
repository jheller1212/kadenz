import { getCurrentFitnessEstimate } from "@/lib/current-fitness";
import { FITNESS_WINDOW_DAYS } from "@/lib/plan-engine/fitness-estimate";

// ── GET /api/fitness-estimate ───────────────────────────────────────────────
// Current-fitness VDOT estimated from the athlete's own recent runs, plus the
// effort it came from — this is the same figure plan generation and
// recalibration use to drive paces, exposed so the athlete can see (and judge)
// where their paces come from before overriding them.

export async function GET() {
  try {
    const estimate = await getCurrentFitnessEstimate();

    if (!estimate) {
      return Response.json({
        hasEstimate: false,
        windowDays: FITNESS_WINDOW_DAYS,
      });
    }

    return Response.json({
      hasEstimate: true,
      windowDays: FITNESS_WINDOW_DAYS,
      vdot: Math.round(estimate.vdot * 10) / 10,
      source: {
        distanceKey: estimate.source.distanceKey,
        distanceKm: Math.round(estimate.source.distanceKm * 100) / 100,
        durationSeconds: estimate.source.durationSeconds,
        date: estimate.source.date.toISOString(),
      },
    });
  } catch (err) {
    console.error("DB error building fitness estimate:", err);
    return Response.json({ error: "Failed to build fitness estimate" }, { status: 500 });
  }
}
