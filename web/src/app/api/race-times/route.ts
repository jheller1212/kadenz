import { db, personalRecords } from "@/db";
import { eq } from "drizzle-orm";

const VALID_DISTANCES = ["5k", "10k", "half", "marathon", "mile"] as const;
const VALID_SOURCES = ["race", "time_trial", "estimate"] as const;

function isValidDistance(v: unknown): v is (typeof VALID_DISTANCES)[number] {
  return typeof v === "string" && (VALID_DISTANCES as readonly string[]).includes(v);
}

function isValidSource(v: unknown): v is (typeof VALID_SOURCES)[number] {
  return typeof v === "string" && (VALID_SOURCES as readonly string[]).includes(v);
}

// GET /api/race-times — list all personal records
export async function GET() {
  try {
    const records = await db
      .select()
      .from(personalRecords)
      .orderBy(personalRecords.createdAt);

    return Response.json(records);
  } catch (err) {
    console.error("DB error fetching race times:", err);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

// POST /api/race-times — add or update a race time
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { distance, timeSeconds, date, source } = body;

    if (!isValidDistance(distance)) {
      return Response.json({ error: `Invalid distance. Must be one of: ${VALID_DISTANCES.join(", ")}` }, { status: 400 });
    }
    if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds) || timeSeconds <= 0) {
      return Response.json({ error: "timeSeconds must be a positive number" }, { status: 400 });
    }
    if (source !== undefined && !isValidSource(source)) {
      return Response.json({ error: `Invalid source. Must be one of: ${VALID_SOURCES.join(", ")}` }, { status: 400 });
    }

    // Check if record for this distance already exists
    const [existing] = await db
      .select()
      .from(personalRecords)
      .where(eq(personalRecords.distance, distance))
      .limit(1);

    if (existing) {
      // Update
      const [updated] = await db
        .update(personalRecords)
        .set({
          timeSeconds,
          date: date ? new Date(date) : null,
          source: source ?? "race",
        })
        .where(eq(personalRecords.id, existing.id))
        .returning();

      return Response.json(updated);
    }

    // Insert
    const [record] = await db
      .insert(personalRecords)
      .values({
        distance,
        timeSeconds,
        date: date ? new Date(date) : null,
        source: source ?? "race",
      })
      .returning();

    return Response.json(record);
  } catch (err) {
    console.error("DB error saving race time:", err);
    return Response.json({ error: "Failed to save" }, { status: 500 });
  }
}

// DELETE /api/race-times — delete a race time by id
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    await db.delete(personalRecords).where(eq(personalRecords.id, id));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error deleting race time:", err);
    return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}
