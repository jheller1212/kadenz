import { NextRequest } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, profiles } from "@/db";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().max(20).optional(),
});

// ── GET /api/profiles ─────────────────────────────────────────────────────────
// Household guest profiles (the owner has no row — NULL profile_id everywhere).

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(profiles)
      .orderBy(asc(profiles.createdAt));
    return Response.json(rows);
  } catch (err) {
    console.error("DB error listing profiles:", err);
    return Response.json({ error: "Failed to fetch profiles" }, { status: 500 });
  }
}

// ── POST /api/profiles ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  try {
    const [row] = await db
      .insert(profiles)
      .values({ name: parsed.data.name, color: parsed.data.color ?? null })
      .returning();
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error("DB error creating profile:", err);
    return Response.json({ error: "Failed to create profile" }, { status: 500 });
  }
}

// ── DELETE /api/profiles?id= ──────────────────────────────────────────────────
// Removes the profile AND all its scoped data (sessions/wellness cascade).

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  try {
    await db.delete(profiles).where(eq(profiles.id, id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error deleting profile:", err);
    return Response.json({ error: "Failed to delete profile" }, { status: 500 });
  }
}
