import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, plans } from "@/db";

// ── GET /api/plans/[id] ───────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const plan = await db.query.plans.findFirst({
      where: (p, { eq }) => eq(p.id, id),
      with: {
        weeks: {
          orderBy: (w, { asc }) => [asc(w.weekNumber)],
          with: {
            workouts: {
              orderBy: (wo, { asc }) => [asc(wo.sortOrder)],
              with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
            },
          },
        },
      },
    });

    if (!plan) {
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }

    return Response.json(plan);
  } catch (err) {
    console.error("DB error fetching plan:", err);
    return Response.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
}

// ── DELETE /api/plans/[id] — soft-delete (archived) ──────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [updated] = await db
      .update(plans)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning({ id: plans.id });

    if (!updated) {
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }

    return Response.json({ id: updated.id, status: "archived" });
  } catch (err) {
    console.error("DB error archiving plan:", err);
    return Response.json({ error: "Failed to archive plan" }, { status: 500 });
  }
}
