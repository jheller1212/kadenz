// ── Warm-up & mobility routines ───────────────────────────────────────────────
// Static, coach-standard drill sets played by the WarmupPlayer. Each drill is a
// timed segment; the player counts each down and moves on. No schema, no DB.

export interface Drill {
  name: string;
  /** How to do it, one short line. */
  cue: string;
  /** Seconds for this drill. */
  seconds: number;
}

export interface Routine {
  id: string;
  title: string;
  subtitle: string;
  drills: Drill[];
}

export const ROUTINES: Routine[] = [
  {
    id: "dynamic-warmup",
    title: "Dynamic warm-up",
    subtitle: "Before a run: wake the legs up",
    drills: [
      { name: "March on the spot", cue: "Easy, tall posture. Get moving.", seconds: 30 },
      { name: "Ankle circles", cue: "15 each way, each foot.", seconds: 30 },
      { name: "Leg swings — front/back", cue: "Hold something; swing each leg.", seconds: 40 },
      { name: "Leg swings — side to side", cue: "Open the hips; each leg.", seconds: 40 },
      { name: "Walking lunges", cue: "Long, controlled steps.", seconds: 40 },
      { name: "High knees", cue: "Quick feet, drive the knees up.", seconds: 30 },
      { name: "Butt kicks", cue: "Heels to glutes, light and springy.", seconds: 30 },
      { name: "Strides", cue: "2–3 relaxed build-ups to ~80%.", seconds: 40 },
    ],
  },
  {
    id: "post-run-mobility",
    title: "Post-run mobility",
    subtitle: "After a run: ease down",
    drills: [
      { name: "Calf stretch", cue: "Wall or step; each side.", seconds: 40 },
      { name: "Hip flexor stretch", cue: "Half-kneel, tuck the hips; each side.", seconds: 40 },
      { name: "Hamstring stretch", cue: "Soft knee, hinge forward; each side.", seconds: 40 },
      { name: "Glute figure-4", cue: "Seated or lying; each side.", seconds: 40 },
      { name: "Quad stretch", cue: "Stand tall, heel to glute; each side.", seconds: 40 },
      { name: "Easy walk", cue: "Loosen off and breathe.", seconds: 40 },
    ],
  },
];

export function routineById(id: string): Routine | undefined {
  return ROUTINES.find((r) => r.id === id);
}

/** Total routine length in seconds. */
export function routineSeconds(r: Routine): number {
  return r.drills.reduce((s, d) => s + d.seconds, 0);
}
