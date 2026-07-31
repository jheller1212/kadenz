import { db, personalRecords } from "@/db";
import { and, eq } from "drizzle-orm";
import { currentUserId } from "@/db/with-user";
import { withSession } from "@/lib/api/with-session";
import { badRequest, notFound } from "@/lib/api/errors";
import { ownedBy, requireOwned } from "@/lib/api/owned";

const VALID_DISTANCES = ["5k", "10k", "half", "marathon", "mile"] as const;
const VALID_SOURCES = ["race", "time_trial", "estimate"] as const;

function isValidDistance(v: unknown): v is (typeof VALID_DISTANCES)[number] {
  return typeof v === "string" && (VALID_DISTANCES as readonly string[]).includes(v);
}

function isValidSource(v: unknown): v is (typeof VALID_SOURCES)[number] {
  return typeof v === "string" && (VALID_SOURCES as readonly string[]).includes(v);
}

// GET /api/race-times — list the caller's personal records
export const GET = withSession(async () => {
  const records = await db
    .select()
    .from(personalRecords)
    .where(ownedBy(personalRecords))
    .orderBy(personalRecords.createdAt);

  return Response.json(records);
});

// POST /api/race-times — add or update one of the caller's race times
export const POST = withSession(async (req) => {
  const body = await req.json();
  const { distance, timeSeconds, date, source } = body;

  if (!isValidDistance(distance)) {
    throw badRequest(`Invalid distance. Must be one of: ${VALID_DISTANCES.join(", ")}`);
  }
  if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds) || timeSeconds <= 0) {
    throw badRequest("timeSeconds must be a positive number");
  }
  if (source !== undefined && !isValidSource(source)) {
    throw badRequest(`Invalid source. Must be one of: ${VALID_SOURCES.join(", ")}`);
  }

  // One record per distance PER ATHLETE. Without the owner in this lookup, a
  // second user setting a 10k time would find and overwrite the first user's.
  const [existing] = await db
    .select()
    .from(personalRecords)
    .where(and(ownedBy(personalRecords), eq(personalRecords.distance, distance)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(personalRecords)
      .set({
        timeSeconds,
        date: date ? new Date(date) : null,
        source: source ?? "race",
      })
      .where(and(ownedBy(personalRecords), eq(personalRecords.id, existing.id)))
      .returning();

    return Response.json(updated);
  }

  const [record] = await db
    .insert(personalRecords)
    .values({
      userId: currentUserId(),
      distance,
      timeSeconds,
      date: date ? new Date(date) : null,
      source: source ?? "race",
    })
    .returning();

  return Response.json(record);
});

// DELETE /api/race-times — delete one of the caller's race times by id
//
// The id arrives in the body, and until this change nothing checked whose id it
// was: any signed-in caller could delete another athlete's personal record, for
// real, by guessing or observing a uuid. It was the only confirmed destructive
// cross-user leak in the phase 3 audit. requireOwned answers 404 for a record
// the caller does not own, and the delete then names the owner as well, so a
// row can only be removed by the athlete it belongs to.
export const DELETE = withSession(async (req) => {
  const { id } = await req.json();
  if (!id) throw badRequest("id required");

  const record = await requireOwned(personalRecords, id);

  const deleted = await db
    .delete(personalRecords)
    .where(and(ownedBy(personalRecords), eq(personalRecords.id, record.id)))
    .returning({ id: personalRecords.id });
  if (deleted.length === 0) throw notFound();

  return Response.json({ ok: true });
});
