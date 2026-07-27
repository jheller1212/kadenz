import { NextRequest } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db, profiles } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";
import { evaluateProfileDelete } from "@/lib/profile-delete";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().trim().max(20).optional(),
});

const DeleteSchema = z.object({
  // Exact-name confirmation, entered by the person removing the profile — a
  // bare `DELETE ?id=` (or a malformed/replayed one) can never succeed.
  confirmName: z.string().trim().min(1).max(40),
});

// ── GET /api/profiles ─────────────────────────────────────────────────────────
// Household guest profiles (the owner has no row — NULL profile_id everywhere).
// Soft-deleted profiles are excluded so a "removed" person never reappears.

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.active, true))
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
// Soft-deletes the profile: flips `active` to false and leaves every strength
// session, check-in, and custom workout in place. A hard, unrecoverable wipe
// of training history is deliberately not exposed here — see PR description
// for why (soft delete over a confirmation-gated hard delete or an
// archive-only refusal).
//
// Two things must both be true for this to succeed:
//  1. `confirmName` in the body must exactly match the profile's current
//     name, so a bare `DELETE ?id=` (or a stray/replayed one) always fails.
//  2. The profile being removed must not be the caller's own active profile
//     — you can't remove the household member you're currently switched to
//     (the client has no way to detect that and fall back to the owner mid
//     -session), so switch to another profile (or Owner) first.

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  try {
    const [target] = await db
      .select({ id: profiles.id, name: profiles.name, active: profiles.active })
      .from(profiles)
      .where(eq(profiles.id, id))
      .limit(1);

    const decision = evaluateProfileDelete(
      target,
      parsed.data.confirmName,
      getActiveProfileId(request)
    );
    if (!decision.ok) {
      return Response.json({ error: decision.error }, { status: decision.status });
    }

    await db
      .update(profiles)
      .set({ active: false })
      .where(and(eq(profiles.id, id), eq(profiles.active, true)));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error removing profile:", err);
    return Response.json({ error: "Failed to remove profile" }, { status: 500 });
  }
}
