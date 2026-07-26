import { describe, expect, it } from "vitest";
import {
  e1rm,
  computeSessionMetrics,
  annotatePrs,
  currentRecords,
  isNewSingleSetRecord,
  type PrSet,
} from "../pr";

const loaded = { bodyweight: false } as const;
const loadedSingleDumbbell = { bodyweight: false, dumbbells: 1 as const };
const loadedTwoDumbbells = { bodyweight: false, dumbbells: 2 as const };
const bodyweight = { bodyweight: true } as const;

function set(weightKg: number | null, reps: number | null, setType?: PrSet["setType"]): PrSet {
  return { weightKg, reps, setType };
}

describe("e1rm", () => {
  it("computes the Epley estimate", () => {
    expect(e1rm(20, 10)).toBeCloseTo(26.7, 1);
  });

  it("is 0 for a non-positive weight or rep count", () => {
    expect(e1rm(0, 10)).toBe(0);
    expect(e1rm(20, 0)).toBe(0);
  });

  it("stays monotonic at high rep counts (the reason Epley was chosen over Brzycki)", () => {
    // Brzycki (w / (1.0278 - 0.0278*reps)) goes negative well before 36 reps;
    // Epley must keep climbing since Kadenz's rep ranges go up to 25.
    expect(e1rm(10, 25)).toBeGreaterThan(e1rm(10, 20));
    expect(e1rm(10, 30)).toBeGreaterThan(e1rm(10, 25));
  });
});

describe("computeSessionMetrics — loaded exercises", () => {
  it("picks the heaviest set, with reps as the tiebreak at equal weight", () => {
    const sets = [set(10, 12), set(12.5, 8), set(12.5, 10)];
    const m = computeSessionMetrics(sets, "s1", new Date("2026-01-01"), loaded);
    expect(m.topWeightKg).toBe(12.5);
    expect(m.topWeightReps).toBe(10);
  });

  it("scales volume by dumbbell count (default two-dumbbell pair)", () => {
    const sets = [set(10, 10), set(10, 10)];
    const twoHands = computeSessionMetrics(sets, "s1", new Date(), loadedTwoDumbbells);
    const oneHand = computeSessionMetrics(sets, "s1", new Date(), loadedSingleDumbbell);
    const unspecified = computeSessionMetrics(sets, "s1", new Date(), loaded);
    expect(twoHands.volume).toBe(10 * 10 * 2 * 2);
    expect(oneHand.volume).toBe(10 * 10 * 2 * 1);
    // Omitting dumbbells defaults to the standard two-dumbbell pair, same as
    // weights.ts formatLoad.
    expect(unspecified.volume).toBe(twoHands.volume);
  });

  it("dumbbell count never changes which weight/e1rm wins, only the volume figure", () => {
    const sets = [set(15, 8)];
    const oneHand = computeSessionMetrics(sets, "s1", new Date(), loadedSingleDumbbell);
    const twoHands = computeSessionMetrics(sets, "s1", new Date(), loadedTwoDumbbells);
    expect(oneHand.topWeightKg).toBe(twoHands.topWeightKg);
    expect(oneHand.bestE1rm).toBe(twoHands.bestE1rm);
  });

  it("excludes tagged warm-up sets from every metric", () => {
    const sets = [set(20, 15, "warmup"), set(12.5, 10)];
    const m = computeSessionMetrics(sets, "s1", new Date(), loaded);
    // The warm-up (20kg) is heavier than the working set but must not win.
    expect(m.topWeightKg).toBe(12.5);
    expect(m.volume).toBe(12.5 * 10 * 2);
  });

  it("failure and drop sets still count as working sets", () => {
    const sets = [set(12.5, 6, "failure"), set(10, 8, "dropset")];
    const m = computeSessionMetrics(sets, "s1", new Date(), loaded);
    expect(m.topWeightKg).toBe(12.5);
  });
});

describe("computeSessionMetrics — bodyweight exercises", () => {
  it("falls back to reps: heaviest-set and e1rm become best reps in a set", () => {
    const sets = [set(0, 12), set(null, 18), set(0, 15)];
    const m = computeSessionMetrics(sets, "s1", new Date(), bodyweight);
    expect(m.topWeightKg).toBe(0);
    expect(m.topWeightReps).toBe(18);
    expect(m.bestE1rm).toBe(18);
  });

  it("volume becomes total reps across the session, not kg", () => {
    const sets = [set(0, 12), set(0, 10)];
    const m = computeSessionMetrics(sets, "s1", new Date(), bodyweight);
    expect(m.volume).toBe(22);
  });
});

describe("annotatePrs", () => {
  it("flags the first logged session as a PR, and only strictly-better sessions after", () => {
    const sessions = [
      computeSessionMetrics([set(10, 10)], "s1", new Date("2026-01-01"), loaded),
      computeSessionMetrics([set(10, 10)], "s2", new Date("2026-01-08"), loaded), // tie, not a PR
      computeSessionMetrics([set(12.5, 10)], "s3", new Date("2026-01-15"), loaded), // real PR
      computeSessionMetrics([set(10, 12)], "s4", new Date("2026-01-22"), loaded), // lighter, not a PR
    ];
    const annotated = annotatePrs(sessions);
    expect(annotated[0].pr.weight).toBe(true);
    expect(annotated[1].pr.weight).toBe(false);
    expect(annotated[2].pr.weight).toBe(true);
    expect(annotated[3].pr.weight).toBe(false);
  });

  it("never flags an empty session as a PR", () => {
    const sessions = [computeSessionMetrics([], "s1", new Date(), loaded)];
    const annotated = annotatePrs(sessions);
    expect(annotated[0].pr).toEqual({ weight: false, e1rm: false, volume: false });
  });
});

describe("currentRecords", () => {
  it("returns the best-to-date value and the date it was set for each metric independently", () => {
    const sessions = [
      computeSessionMetrics([set(10, 10)], "s1", new Date("2026-01-01"), loaded), // vol 200
      computeSessionMetrics([set(12.5, 6)], "s2", new Date("2026-01-08"), loaded), // heavier, lower vol (150)
    ];
    const records = currentRecords(sessions);
    expect(records.topWeightKg).toBe(12.5);
    expect(records.topWeightDate).toEqual(new Date("2026-01-08"));
    // Session 1 still holds the volume record even though it's not the
    // heaviest — the two records track independently.
    expect(records.bestVolume).toBe(200);
    expect(records.bestVolumeDate).toEqual(new Date("2026-01-01"));
  });
});

describe("isNewSingleSetRecord", () => {
  it("is true the very first time an exercise is logged", () => {
    const result = isNewSingleSetRecord(set(10, 10), [], loaded);
    expect(result).toEqual({ weight: true, e1rm: true });
  });

  it("is false for a set that doesn't beat prior history", () => {
    const prior = [set(12.5, 10)];
    const result = isNewSingleSetRecord(set(10, 10), prior, loaded);
    expect(result).toEqual({ weight: false, e1rm: false });
  });

  it("flags a same-weight, more-reps set as a weight PR (a real improvement)", () => {
    const prior = [set(12.5, 8)];
    const result = isNewSingleSetRecord(set(12.5, 10), prior, loaded);
    expect(result.weight).toBe(true);
  });

  it("a warm-up set never registers as a PR, even if it's heavier than history", () => {
    const prior = [set(10, 10)];
    const result = isNewSingleSetRecord(set(20, 5, "warmup"), prior, loaded);
    expect(result).toEqual({ weight: false, e1rm: false });
  });

  it("a warm-up set in prior history is never counted as the bar to beat", () => {
    // A 20kg warm-up sits in history; a genuine 15kg working set should still
    // register as a PR because the warm-up must not count as prior best.
    const prior = [set(20, 5, "warmup"), set(10, 10)];
    const result = isNewSingleSetRecord(set(15, 8), prior, loaded);
    expect(result.weight).toBe(true);
  });

  it("bodyweight exercises detect a PR by reps alone", () => {
    const prior = [set(0, 15)];
    const beats = isNewSingleSetRecord(set(0, 18), prior, bodyweight);
    const fallsShort = isNewSingleSetRecord(set(0, 12), prior, bodyweight);
    expect(beats).toEqual({ weight: true, e1rm: true });
    expect(fallsShort).toEqual({ weight: false, e1rm: false });
  });

  it("per-hand (single dumbbell) lifts compare on the per-dumbbell weight, unaffected by dumbbell count", () => {
    const prior = [set(15, 10)];
    const result = isNewSingleSetRecord(set(17.5, 10), prior, loadedSingleDumbbell);
    expect(result.weight).toBe(true);
  });
});
