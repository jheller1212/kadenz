import { resolveRequestUserId } from "@/lib/request-user";
import { UNANSWERED_DEVICE_SETUP } from "@/lib/device-setup";
import { loadDeviceSetup } from "@/lib/user-device-setup";
import { withSession } from "@/lib/api/with-session";
import { getVerifiedProfileId } from "@/lib/profiles";
import { getReadinessData } from "./service";

// ── GET /api/readiness ────────────────────────────────────────────────────────
// Readiness score for the Today view: latest wellness check-in (≤48 h), recent
// pain flags, recent strength RPE, and the run-load trend. Profile-scoped for
// wellness/strength; run load is the owner's (guests have no runs).
// The computation lives in service.ts so /api/today/bootstrap runs the exact
// same thing instead of a second copy.

export const GET = withSession(async (request) => {
  const profileId = await getVerifiedProfileId(request);

  try {
    // What the athlete said they wanted connected. Drives two things below:
    // whether the card may claim a recovery baseline is still building, and
    // whether it should say out loud that the score comes from the check-in
    // alone. Falls back to the unanswered state, which behaves exactly as the
    // endpoint did before this existed.
    const userId = await resolveRequestUserId(request);
    const deviceSetup = userId
      ? await loadDeviceSetup(userId)
      : UNANSWERED_DEVICE_SETUP;

    return Response.json(await getReadinessData(profileId, deviceSetup));
  } catch (err) {
    console.error("DB error computing readiness:", err);
    return Response.json({ error: "Failed to compute readiness" }, { status: 500 });
  }
});
