import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, isNull } from "drizzle-orm";
import { db, strengthPlanSettings } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";
import {
  ensureStrengthSchedule,
  pruneAutoSchedule,
} from "@/lib/strength/schedule";

const EQUIPMENT_VALUES = [
  "dumbbell", "barbell", "bench", "chair", "box", "kettlebell", "pullup_bar", "band",
] as const;

const SettingsSchema = z.object({
  goal: z.enum(["running_focus", "all_round"]),
  durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  sessionsPerWeek: z.number().int().min(1).max(4),
  ability: z.enum(["beginner", "intermediate", "advanced"]),
  availableDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  equipment: z.array(z.enum(EQUIPMENT_VALUES)).max(EQUIPMENT_VALUES.length),
  active: z.boolean().optional().default(true),
  // Standalone block (only meaningful without a running plan to follow).
  blockWeeks: z.union([z.literal(8), z.literal(12), z.literal(16)]).nullish(),
  blockStartDate: z.string().datetime().nullish(),
  // Cold-start load personalisation — optional, nullable; skipping them keeps
  // today's global default loads (see lib/strength/load-model.ts).
  bodyweightKg: z.number().min(20).max(300).nullable().optional(),
  sex: z.enum(["male", "female", "unspecified"]).nullable().optional(),
}).refine((s) => new Set(s.availableDays).size >= s.sessionsPerWeek, {
  message: "Pick at least as many distinct days as sessions per week",
});

function profCond(profileId: string | null) {
  return profileId
    ? eq(strengthPlanSettings.profileId, profileId)
    : isNull(strengthPlanSettings.profileId);
}

export async function GET(request: NextRequest) {
  try {
    const [settings] = await db
      .select()
      .from(strengthPlanSettings)
      .where(profCond(getActiveProfileId(request)));
    return Response.json(settings ?? null);
  } catch (err) {
    console.error("[plan-settings] get failed", err);
    return Response.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const profileId = getActiveProfileId(request);

  let data: z.infer<typeof SettingsSchema>;
  try {
    data = SettingsSchema.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "Invalid request", details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }

  try {
    // Update-first, insert-on-miss; the partial unique index (0015) makes the
    // insert race-safe, and a lost race falls through to the update.
    const { blockStartDate, blockWeeks, ...rest } = data;
    const values = {
      ...rest,
      availableDays: [...new Set(data.availableDays)],
      blockWeeks: blockWeeks ?? null,
      // A block needs a start; default to today so the athlete's week 1 is
      // the week they set it up.
      blockStartDate: blockWeeks
        ? blockStartDate
          ? new Date(blockStartDate)
          : new Date()
        : null,
    };
    const updated = await db
      .update(strengthPlanSettings)
      .set({ ...values, updatedAt: new Date() })
      .where(profCond(profileId))
      .returning({ id: strengthPlanSettings.id });
    if (updated.length === 0) {
      const inserted = await db
        .insert(strengthPlanSettings)
        .values({ ...values, profileId })
        .onConflictDoNothing()
        .returning({ id: strengthPlanSettings.id });
      if (inserted.length === 0) {
        await db
          .update(strengthPlanSettings)
          .set({ ...values, updatedAt: new Date() })
          .where(profCond(profileId));
      }
    }

    // Rebuild the upcoming auto schedule from the new preferences. Completed
    // and manually created sessions are never touched.
    await pruneAutoSchedule(profileId);
    const { created } = data.active
      ? await ensureStrengthSchedule(profileId)
      : { created: 0 };

    return Response.json({ ok: true, created });
  } catch (err) {
    console.error("[plan-settings] save failed", err);
    return Response.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
