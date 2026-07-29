// Single source of truth for the `activities.provider` values and the
// (provider, externalId) pair written alongside the legacy stravaId/garminId
// columns (see drizzle/0050_activity_provider_external_id.sql). Every write
// path must build this pair through buildProviderExternalId rather than
// writing the string literal itself — the repo's dominant bug shape is one
// concept computed in several places that quietly drifts (docs/DUPLICATION.md).

export const ACTIVITY_PROVIDER = {
  strava: "strava",
  garmin: "garmin",
  // Room for phone-platform sources feeding activities directly from the
  // native app (see NATIVE_APP_PLAN.md) once those land.
  appleHealth: "apple_health",
  healthConnect: "health_connect",
} as const;

export type ActivityProvider =
  (typeof ACTIVITY_PROVIDER)[keyof typeof ACTIVITY_PROVIDER];

export interface ProviderExternalId {
  provider: ActivityProvider;
  externalId: string;
}

// Builds the { provider, externalId } pair for a write. externalId is
// normalized to a string since the legacy stravaId/garminId columns are text
// even though the upstream provider ids are numeric.
export function buildProviderExternalId(
  provider: ActivityProvider,
  id: string | number
): ProviderExternalId {
  return { provider, externalId: String(id) };
}
