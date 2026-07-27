import { describe, expect, it } from "vitest";
import { buildRetireDeleteBatch, type RetireCandidateWorkout } from "../plan-retire-rules";

describe("buildRetireDeleteBatch", () => {
  it("queues a gcal delete only for rows with a gcalEventId", () => {
    const rows: RetireCandidateWorkout[] = [
      { id: "w1", gcalEventId: "gcal-1", garminWorkoutId: null },
      { id: "w2", gcalEventId: null, garminWorkoutId: null },
    ];
    const { gcalDeletes, garminDeletes } = buildRetireDeleteBatch(rows);
    expect(gcalDeletes).toEqual([{ workoutId: "w1", gcalEventId: "gcal-1" }]);
    expect(garminDeletes).toEqual([]);
  });

  it("queues a garmin delete only for rows with a garminWorkoutId", () => {
    const rows: RetireCandidateWorkout[] = [
      { id: "w1", gcalEventId: null, garminWorkoutId: "garmin-1" },
      { id: "w2", gcalEventId: null, garminWorkoutId: null },
    ];
    const { gcalDeletes, garminDeletes } = buildRetireDeleteBatch(rows);
    expect(garminDeletes).toEqual([{ workoutId: "w1", garminWorkoutId: "garmin-1" }]);
    expect(gcalDeletes).toEqual([]);
  });

  it("queues both surfaces for a row pushed to both", () => {
    const rows: RetireCandidateWorkout[] = [
      { id: "w1", gcalEventId: "gcal-1", garminWorkoutId: "garmin-1" },
    ];
    const { gcalDeletes, garminDeletes } = buildRetireDeleteBatch(rows);
    expect(gcalDeletes).toEqual([{ workoutId: "w1", gcalEventId: "gcal-1" }]);
    expect(garminDeletes).toEqual([{ workoutId: "w1", garminWorkoutId: "garmin-1" }]);
  });

  it("queues nothing for a plan whose workouts were never pushed anywhere", () => {
    const rows: RetireCandidateWorkout[] = [
      { id: "w1", gcalEventId: null, garminWorkoutId: null },
      { id: "w2", gcalEventId: null, garminWorkoutId: null },
    ];
    const { gcalDeletes, garminDeletes } = buildRetireDeleteBatch(rows);
    expect(gcalDeletes).toEqual([]);
    expect(garminDeletes).toEqual([]);
  });

  it("replacing a plan queues deletes for every one of the previous plan's pushed workouts", () => {
    // Simulates the reported bug: an old plan with a mix of run and rest
    // workouts, some pushed to both surfaces, some only to one.
    const oldPlanWorkouts: RetireCandidateWorkout[] = [
      { id: "run-1", gcalEventId: "g-1", garminWorkoutId: "m-1" },
      { id: "run-2", gcalEventId: "g-2", garminWorkoutId: "m-2" },
      { id: "run-3", gcalEventId: "g-3", garminWorkoutId: null },
      { id: "rest-1", gcalEventId: null, garminWorkoutId: null },
    ];
    const { gcalDeletes, garminDeletes } = buildRetireDeleteBatch(oldPlanWorkouts);
    expect(gcalDeletes.map((d) => d.workoutId)).toEqual(["run-1", "run-2", "run-3"]);
    expect(garminDeletes.map((d) => d.workoutId)).toEqual(["run-1", "run-2"]);
  });
});
