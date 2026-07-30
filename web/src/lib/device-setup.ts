// What the athlete told us they want connected, and what follows from it.
//
// Kadenz used to assume a watch. Every recovery number, every imported run and
// the readiness warm-up copy all started from "your device will fill this in".
// An athlete with no device is not a lapsed athlete, and the app has to be able
// to tell the difference between "we are still waiting for your watch" and "you
// told us there is no watch". That difference is this module.
//
// Client-safe on purpose: the onboarding step, the Today prompt and the
// readiness card all read these helpers, so nothing here may touch the
// database. The server-side reader/writer lives in lib/user-device-setup.ts.

/** Everything the athlete can be offered in the setup step. */
export const CONNECTION_IDS = ["strava", "garmin", "gcal"] as const;
export type ConnectionId = (typeof CONNECTION_IDS)[number];

/**
 * Connections that bring training data *in*.
 *
 * gcal is deliberately absent: it is a push target. Workouts go out to the
 * calendar and nothing comes back, so an athlete whose only connection is
 * Google Calendar still records everything by hand.
 */
export const DATA_SOURCE_IDS = ["strava", "garmin"] as const;

/**
 * Connections that can supply overnight physiology (HRV, resting heart rate,
 * sleep duration) to lib/physiology.ts.
 *
 * Only Garmin today. Strava has activities and no wellness at all, so a
 * Strava-only athlete must never be shown "building your recovery baseline" —
 * that baseline has no source and would never finish building.
 */
export const PHYSIOLOGY_SOURCE_IDS = ["garmin"] as const;

export interface DeviceSetup {
  /** ISO timestamp of when the athlete answered, or null if never asked. */
  completedAt: string | null;
  connections: ConnectionId[];
}

export const UNANSWERED_DEVICE_SETUP: DeviceSetup = {
  completedAt: null,
  connections: [],
};

/**
 * Narrows arbitrary stored JSON to known connection ids, deduped and in the
 * canonical order of CONNECTION_IDS.
 *
 * The column is jsonb, so anything could be in there: an older build's id, a
 * hand-edited row, null. Unknown entries are dropped rather than rejected —
 * a stale id must not make the whole preference unreadable and put the athlete
 * back in the "never answered" state, which is the one state that starts
 * prompting again.
 */
export function parseConnections(value: unknown): ConnectionId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(value.filter((v): v is string => typeof v === "string"));
  return CONNECTION_IDS.filter((id) => seen.has(id));
}

/** True once the athlete has answered, whatever they answered. */
export function isSetupAnswered(setup: DeviceSetup): boolean {
  return setup.completedAt !== null;
}

/**
 * True when the athlete has answered and picked nothing that feeds data in.
 *
 * This is the "record by hand" athlete. It is a deliberate choice, so the app
 * stops offering to connect things and the readiness card explains what it is
 * actually scoring from.
 */
export function isManualOnly(setup: DeviceSetup): boolean {
  return (
    isSetupAnswered(setup) &&
    !DATA_SOURCE_IDS.some((id) => setup.connections.includes(id))
  );
}

/**
 * True when a recovery baseline is genuinely on its way, so the readiness card
 * may say it is still building one.
 *
 * The bug this exists to prevent: the warm-up state needs 21 nights of HRV or
 * resting heart rate (MIN_BASELINE_NIGHTS in lib/physiology.ts). An athlete
 * with no device collects zero of them, so "building your baseline (0/21)"
 * would sit there for good, promising a number that can never arrive.
 *
 * Unanswered counts as true: an athlete who has not been asked yet may well
 * have a watch already syncing, and suppressing a real warm-up would be the
 * opposite mistake.
 */
export function expectsPhysiology(setup: DeviceSetup): boolean {
  if (!isSetupAnswered(setup)) return true;
  return PHYSIOLOGY_SOURCE_IDS.some((id) => setup.connections.includes(id));
}

/** True when the setup step should still be offered to this athlete. */
export function shouldPromptSetup(setup: DeviceSetup): boolean {
  return !isSetupAnswered(setup);
}
