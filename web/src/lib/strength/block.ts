// Standalone strength blocks: structure for athletes training strength without
// a running plan. A block has a length, a start, and its own deload rhythm —
// the things the running plan would otherwise provide.

export const BLOCK_LENGTH_OPTIONS = [8, 12, 16] as const;
export type BlockLength = (typeof BLOCK_LENGTH_OPTIONS)[number];

/** Every fourth week is a deload — the standard strength-training cadence. */
export const DELOAD_EVERY = 4;

/** 1-based week number within the block for a given date, or null if outside. */
export function blockWeekNumber(
  date: Date,
  blockStart: Date,
  blockWeeks: number
): number | null {
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const startMonday = mondayOf(blockStart);
  const week = Math.floor((date.getTime() - startMonday.getTime()) / msPerWeek) + 1;
  if (week < 1 || week > blockWeeks) return null;
  return week;
}

/** Deload weeks are every 4th, and the final week of a block always deloads. */
export function isDeloadWeek(weekNumber: number, blockWeeks: number): boolean {
  if (weekNumber === blockWeeks) return true;
  return weekNumber % DELOAD_EVERY === 0;
}

/**
 * Sessions to schedule in a block week. Deloads drop one (floor 1) exactly as
 * a running plan's deload does, so both modes feel the same to the athlete.
 */
export function blockWeekBudget(
  weekNumber: number | null,
  blockWeeks: number,
  rotationLength: number
): number {
  // Outside the block there is nothing to schedule.
  if (weekNumber === null) return 0;
  if (isDeloadWeek(weekNumber, blockWeeks)) return Math.max(1, rotationLength - 1);
  return rotationLength;
}

function mondayOf(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0)
  );
  const dow = d.getUTCDay(); // 0=Sun
  const shift = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + shift);
  return d;
}

/** Last day covered by a block that starts on `start` and runs `weeks` weeks. */
export function blockEndDate(start: Date, weeks: number): Date {
  const end = mondayOf(start);
  end.setUTCDate(end.getUTCDate() + weeks * 7 - 1);
  return end;
}
