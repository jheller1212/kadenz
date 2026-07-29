// Detail page URLs, in one place. These four pages moved from dynamic
// segments (/activity/[id]) to query params (/activity?id=...) so the app can
// ship as a static export for Capacitor — see NATIVE_APP_PLAN.md. Keeping the
// URL shape here instead of re-templating it at every call site is what
// stopped this repo's usual bug (one concept computed in several places,
// drifting) from happening again the next time one of these paths changes.

export function activityUrl(id: string): string {
  return `/activity?id=${id}`;
}

export function workoutUrl(id: string): string {
  return `/workout?id=${id}`;
}

export function strengthHistoryUrl(exerciseId: string): string {
  return `/strength/history?exerciseId=${exerciseId}`;
}

export function strengthSessionUrl(id: string): string {
  return `/strength/session?id=${id}`;
}
