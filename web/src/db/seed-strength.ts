import { db, strengthExercises } from "./index";
import { EXERCISES } from "../lib/strength/program";

// ── Strength exercise seeder ──────────────────────────────────────────────────
// Idempotent: upserts each exercise by its stable `slug`. Run with:
//   npm run seed:strength
//
// seedStrengthExercises is exported so the e2e local-DB seed (web/e2e/seed.ts)
// can reuse this exact catalogue instead of hand-duplicating it — the two
// seeders drifting apart is exactly the "one concept, several places" bug
// shape this app keeps tripping on.

export async function seedStrengthExercises(): Promise<number> {
  const rows = EXERCISES.map((e, i) => ({
    slug: e.slug,
    name: e.name,
    category: e.category,
    equipmentNote: e.equipmentNote ?? null,
    tempoNote: e.tempoNote ?? null,
    flatGroundOnly: e.flatGroundOnly ?? false,
    slowProgressor: e.slowProgressor ?? false,
    defaultSets: e.defaultSets ?? null,
    repLow: e.repLow ?? null,
    repHigh: e.repHigh ?? null,
    startWeightKg: e.startWeightKg ?? null,
    sortOrder: i,
  }));

  for (const row of rows) {
    await db
      .insert(strengthExercises)
      .values(row)
      .onConflictDoUpdate({
        target: strengthExercises.slug,
        set: {
          name: row.name,
          category: row.category,
          equipmentNote: row.equipmentNote,
          tempoNote: row.tempoNote,
          flatGroundOnly: row.flatGroundOnly,
          slowProgressor: row.slowProgressor,
          defaultSets: row.defaultSets,
          repLow: row.repLow,
          repHigh: row.repHigh,
          startWeightKg: row.startWeightKg,
          sortOrder: row.sortOrder,
        },
      });
  }

  return rows.length;
}

// Only run as a CLI script (`npm run seed:strength`), never on import — the
// e2e seed (web/e2e/seed.ts) imports seedStrengthExercises and must not
// trigger a second process.exit() as a side effect of loading this module.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seedStrengthExercises()
    .then((count) => {
      console.log(`Seeded ${count} strength exercises.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Strength seed failed:", err);
      process.exit(1);
    });
}
