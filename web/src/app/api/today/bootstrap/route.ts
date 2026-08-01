import type { NextRequest } from "next/server";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { getVerifiedProfileId } from "@/lib/profiles";
import { localWeekRange } from "@/lib/app-time";
import { loadDeviceSetup, garminOfferedTo } from "@/lib/user-device-setup";
import { getTodaySnapshot } from "../service";
import { getPlanById } from "../../plans/service";
import { getPlanSettings } from "../../strength/plan-settings/service";
import { listStrengthSessions } from "../../strength/sessions/service";
import { getPaceInsights } from "../../pace-insights/service";
import { getReadinessData } from "../../readiness/service";
import { listWellnessLogs } from "../../wellness/service";
import { geoFromHeaders } from "../../geo/service";

// ── GET /api/today/bootstrap ──────────────────────────────────────────────────
// Everything the Today screen fires on mount, in one function invocation.
//
// The problem this exists for isn't the database — every query here runs in
// single-digit milliseconds. It's that the Today screen used to be nine
// separate serverless functions, each paying its own Vercel cold start
// (~750ms, measured against /api/geo which touches no table at all) plus its
// own database connection, with /api/plans/[id] additionally unable to even
// start until /api/today returned a plan id. This route buys back all of
// that: one cold start, one withUser transaction (every read below shares
// it — see db/with-user.ts), one round trip.
//
// Every query is copied from nowhere: it calls the same service function its
// standalone route calls (today/service.ts, plans/service.ts, ...), so this
// endpoint and the individual ones it's alongside can never drift apart. The
// individual routes still exist and still work — other screens (and the week
// pager on this one) use them, and e2e still exercises them directly.
//
// Partial failure: each section is caught on its own. A failure in, say,
// readiness must not blank out today's workout card, so a broken section
// comes back as `{ error: true }` instead of aborting the whole response.

type Section<T> = T | { error: true };

async function section<T>(label: string, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[today/bootstrap] ${label} failed:`, err);
    return { error: true };
  }
}

function isErrorSection(value: unknown): value is { error: true } {
  return !!value && typeof value === "object" && (value as { error?: unknown }).error === true;
}

export const GET = withSession(async (request: NextRequest) => {
  const userId = currentUserId();
  const profileId = await getVerifiedProfileId(request);

  // The athlete's current calendar week, same definition /api/today itself
  // uses (see lib/app-time.ts) — not the browser's local Monday, so this
  // agrees with the workouts /api/today just returned instead of a second,
  // slightly different notion of "this week".
  const { weekStart, weekEnd } = localWeekRange(new Date());

  // Device setup is read once and reused by both its own section and
  // readiness's (which needs it to decide whether a recovery baseline is
  // still building) — the alternative is the same `users` row read twice in
  // one request.
  const deviceSetupResult = await section("device-setup", async () => ({
    ...(await loadDeviceSetup(userId)),
    garminOffered: garminOfferedTo(userId),
  }));
  const deviceSetup = isErrorSection(deviceSetupResult)
    ? { completedAt: null, connections: [] }
    : deviceSetupResult;

  // Independent reads — nothing here depends on anything else in this
  // batch, so they run together instead of six serial round trips inside
  // the one transaction.
  const [
    todayResult,
    planSettingsResult,
    strengthSessionsResult,
    paceInsightsResult,
    readinessResult,
    wellnessResult,
  ] = await Promise.all([
    section("today", () => getTodaySnapshot()),
    section("strength-plan-settings", () => getPlanSettings(profileId)),
    section("strength-sessions", () =>
      listStrengthSessions(profileId, { from: weekStart, to: weekEnd })
    ),
    section("pace-insights", () => getPaceInsights()),
    section("readiness", () => getReadinessData(profileId, deviceSetup)),
    section("wellness", () => listWellnessLogs(profileId, { from: weekStart, to: weekEnd })),
  ]);

  // The one genuinely dependent call: the full plan (every week/workout/
  // block, for browsing other weeks) only makes sense once we know which
  // plan is active. Resolving it here, inside the same transaction, is what
  // kills the /api/today → /api/plans/[id] round trip in series — the
  // planId never has to make a second network hop back to the client first.
  // No ownership re-check needed: getTodaySnapshot's own query already
  // scoped `activePlan` to this caller (ownedBy(plans)), so a planId out of
  // it is already this caller's.
  let planResult: Section<Awaited<ReturnType<typeof getPlanById>>> = null;
  if (!isErrorSection(todayResult) && todayResult.activePlan && todayResult.planId) {
    const planId: string = todayResult.planId;
    planResult = await section("plan", () => getPlanById(planId));
  }

  const geoResult = await section("geo", async () => geoFromHeaders(request));

  return Response.json({
    today: todayResult,
    plan: planResult,
    strengthPlanSettings: planSettingsResult,
    deviceSetup: deviceSetupResult,
    strengthSessions: strengthSessionsResult,
    paceInsights: paceInsightsResult,
    readiness: readinessResult,
    wellness: wellnessResult,
    geo: geoResult,
  });
});
