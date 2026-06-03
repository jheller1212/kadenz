// Strava webhook + activity processing moved to:
// - /app/api/strava/webhook/route.ts (webhook endpoint)
// - /lib/sync/strava-client.ts (OAuth, token management, activity processing)
//
// Remaining TODOs for future phases:
// TODO: Pace analysis — compare actual pace per block vs target pace
// TODO: Advanced matching — use workout type + distance to resolve conflicts
