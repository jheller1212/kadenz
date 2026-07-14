import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, isNull } from "drizzle-orm";
import { db, strengthPlanSettings } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";
import {
  ensureStrengthSchedule,
  pruneAutoSchedule,
} from "@/lib/strength/schedule";

const SettingsSchema = z.object({
  goal: z.enum(["running_focus", "all_round"]),
  durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  sessionsPerWeek: z.number().int().min(1).max(4),
  ability: z.enum(["beginner", "intermediate", "advanced"]),
  availableDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  equipment: z.array(z.string().max(30)).max(12),
  active: z.boolean().optional().default(true),
}).refine((s) => s.availableDays.length >= s.sessionsPerWeek, {
  message: "Pick at least as many days as sessions per week",
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
    const [existing] = await db
      .select({ id: strengthPlanSettings.id })
      .from(strengthPlanSettings)
      .where(profCond(profileId));

    if (existing) {
      await db
        .update(strengthPlanSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(strengthPlanSettings.id, existing.id));
    } else {
      await db.insert(strengthPlanSettings).values({ ...data, profileId });
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
