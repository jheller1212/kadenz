import { db } from "@/db";
import { and, between } from "drizzle-orm";

// ── GET /api/strength/today ───────────────────────────────────────────────────
// This week's strength sessions + today's session, for the Today view.

export async function GET() {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekSessions = await db.query.strengthSessions.findMany({
      where: (s) => and(between(s.date, weekStart, weekEnd)),
      orderBy: (s, { asc }) => [asc(s.date), asc(s.sortOrder)],
      with: { sets: { orderBy: (st, { asc }) => [asc(st.setNumber)] } },
    });

    const todaySession =
      weekSessions.find((s) => {
        const d = new Date(s.date);
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }) ?? null;

    return Response.json({ todaySession, weekSessions });
  } catch (err) {
    console.error("DB error fetching strength today:", err);
    return Response.json({ error: "Failed to fetch strength today" }, { status: 500 });
  }
}
