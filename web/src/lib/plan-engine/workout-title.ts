// Render-time run titles.
//
// plan-generator.ts bakes a title like "Easy Run 8km" onto the workout row
// once, at generation time, always in km. Every screen and every downstream
// consumer then renders that stored string verbatim, so an athlete who
// switches to miles keeps seeing the km number in the title forever, even
// though every distance STAT on the same screen already goes through
// displayDistance() and shows miles correctly.
//
// This derives the title from the workout's live numeric fields instead, so
// it moves when the unit setting does. Only easy/long/tempo get rebuilt:
// interval titles are in meters (a distance-unit-independent convention in
// running, same in km or miles) and race titles use a race-distance label
// ("10K", "Half Marathon"), so neither needs a km/mi conversion. Anything
// else — or a workout fetched without the block data tempo needs — falls
// back to the stored title unchanged.
//
// The server-generated artifacts (Google Calendar event summary, the Garmin
// workout label, the push reminder body) call this helper too. They used to
// fall back to the STORED title, because units lived in localStorage only and
// the cron has no browser to read it from, so a miles athlete saw a km title
// on the watch, in the calendar and in the notification. users.distance_unit
// (migration 0057, read via lib/user-units.ts) is the server-side copy that
// closed that gap; each of those callers loads it and passes it in.
//
// Relative import, not "@/" — there is no vitest config in this repo, so the
// alias does not resolve under the test runner (see training/session.ts).
import { displayDistance, distanceUnitLabel } from "../units";

export interface TitleBlock {
  type: string;
  distanceKm?: number | null;
}

export interface TitleWorkout {
  type: string;
  title: string;
  targetKm?: number | null;
  blocks?: TitleBlock[] | null;
}

export function displayWorkoutTitle(
  workout: TitleWorkout,
  unit?: "km" | "miles"
): string {
  const label = distanceUnitLabel(unit);

  if (workout.type === "easy" && workout.targetKm != null) {
    return `Easy Run ${displayDistance(workout.targetKm, 1, unit)} ${label}`;
  }
  if (workout.type === "long" && workout.targetKm != null) {
    return `Long Run ${displayDistance(workout.targetKm, 1, unit)} ${label}`;
  }
  if (workout.type === "tempo") {
    const workBlock = workout.blocks?.find((b) => b.type === "work");
    if (workBlock?.distanceKm != null) {
      return `Tempo Run ${displayDistance(workBlock.distanceKm, 1, unit)} ${label}`;
    }
  }
  return workout.title;
}
