import { db } from "@/db";
import { customWorkoutSlots, customWorkoutTemplates } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { currentUserId } from "@/db/with-user";
import { ownedBy } from "@/lib/api/owned";

export { estimateWorkoutDuration } from "./estimate";

export interface CustomWorkoutSlot {
  id: string;
  exerciseSlug: string;
  sets: number;
  repLow: number;
  repHigh: number;
  weightKg: number | null;
  restSeconds: number;
  sortOrder: number;
}

export interface CustomWorkoutTemplate {
  id: string;
  name: string;
  profileId: string | null;
  slots: CustomWorkoutSlot[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomWorkoutSlotInput {
  exerciseSlug: string;
  sets: number;
  repLow: number;
  repHigh: number;
  weightKg?: number;
  restSeconds: number;
}

// NULL profile_id = owner (same convention as wellness/strength scoping).
// Also scoped to the caller's tenant (ownedBy) — profile alone isn't enough
// once there's more than one account, since profileId is only unique within
// one household.
function profileCond(profileId: string | null) {
  return and(
    ownedBy(customWorkoutTemplates),
    profileId
      ? eq(customWorkoutTemplates.profileId, profileId)
      : isNull(customWorkoutTemplates.profileId)
  );
}

function toSlotDto(
  s: typeof customWorkoutSlots.$inferSelect
): CustomWorkoutSlot {
  return {
    id: s.id,
    exerciseSlug: s.exerciseSlug,
    sets: s.sets,
    repLow: s.repLow,
    repHigh: s.repHigh,
    weightKg: s.weightKg,
    restSeconds: s.restSeconds,
    sortOrder: s.sortOrder,
  };
}

export async function listCustomWorkouts(
  profileId: string | null
): Promise<CustomWorkoutTemplate[]> {
  const templates = await db
    .select()
    .from(customWorkoutTemplates)
    .where(profileCond(profileId))
    .orderBy(asc(customWorkoutTemplates.createdAt));

  return Promise.all(
    templates.map(async (t) => {
      const slots = await db
        .select()
        .from(customWorkoutSlots)
        .where(eq(customWorkoutSlots.templateId, t.id))
        .orderBy(asc(customWorkoutSlots.sortOrder));
      return { ...t, slots: slots.map(toSlotDto) };
    })
  );
}

export async function getCustomWorkout(
  id: string,
  profileId: string | null
): Promise<CustomWorkoutTemplate | null> {
  const [template] = await db
    .select()
    .from(customWorkoutTemplates)
    .where(and(eq(customWorkoutTemplates.id, id), profileCond(profileId)));

  if (!template) return null;

  const slots = await db
    .select()
    .from(customWorkoutSlots)
    .where(eq(customWorkoutSlots.templateId, id))
    .orderBy(asc(customWorkoutSlots.sortOrder));

  return { ...template, slots: slots.map(toSlotDto) };
}

export async function createCustomWorkout(
  name: string,
  profileId: string | null,
  slots: CustomWorkoutSlotInput[]
): Promise<CustomWorkoutTemplate> {
  const [template] = await db
    .insert(customWorkoutTemplates)
    .values({ name, profileId, userId: currentUserId() })
    .returning();

  let slotRows: (typeof customWorkoutSlots.$inferSelect)[] = [];
  if (slots.length > 0) {
    slotRows = await db
      .insert(customWorkoutSlots)
      .values(
        slots.map((slot, idx) => ({
          templateId: template.id,
          exerciseSlug: slot.exerciseSlug,
          sets: slot.sets,
          repLow: slot.repLow,
          repHigh: slot.repHigh,
          weightKg: slot.weightKg ?? null,
          restSeconds: slot.restSeconds,
          sortOrder: idx,
        }))
      )
      .returning();
  }

  return { ...template, slots: slotRows.map(toSlotDto) };
}

export async function updateCustomWorkout(
  id: string,
  profileId: string | null,
  name: string,
  slots: CustomWorkoutSlotInput[]
): Promise<CustomWorkoutTemplate | null> {
  const existing = await getCustomWorkout(id, profileId);
  if (!existing) return null;

  // Replace-all-slots must be atomic — a failure between delete and insert
  // would leave a template with zero slots, which the API schema forbids.
  return db.transaction(async (tx) => {
    const [template] = await tx
      .update(customWorkoutTemplates)
      .set({ name, updatedAt: new Date() })
      .where(and(ownedBy(customWorkoutTemplates), eq(customWorkoutTemplates.id, id)))
      .returning();

    await tx
      .delete(customWorkoutSlots)
      .where(eq(customWorkoutSlots.templateId, id));

    let slotRows: (typeof customWorkoutSlots.$inferSelect)[] = [];
    if (slots.length > 0) {
      slotRows = await tx
        .insert(customWorkoutSlots)
        .values(
          slots.map((slot, idx) => ({
            templateId: id,
            exerciseSlug: slot.exerciseSlug,
            sets: slot.sets,
            repLow: slot.repLow,
            repHigh: slot.repHigh,
            weightKg: slot.weightKg ?? null,
            restSeconds: slot.restSeconds,
            sortOrder: idx,
          }))
        )
        .returning();
    }

    return { ...template, slots: slotRows.map(toSlotDto) };
  });
}

export async function deleteCustomWorkout(
  id: string,
  profileId: string | null
): Promise<boolean> {
  const deleted = await db
    .delete(customWorkoutTemplates)
    .where(and(eq(customWorkoutTemplates.id, id), profileCond(profileId)))
    .returning({ id: customWorkoutTemplates.id });
  return deleted.length > 0;
}
