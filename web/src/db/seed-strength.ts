import { db, strengthExercises } from "./index";
import { EXERCISES } from "../lib/strength/program";

// ── Strength exercise seeder ──────────────────────────────────────────────────
// Idempotent: upserts each exercise by its stable `slug`. Run with:
//   npm run seed:strength

async function seed() {
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

  console.log(`Seeded ${rows.length} strength exercises.`);
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Strength seed failed:", err);
    process.exit(1);
  });
