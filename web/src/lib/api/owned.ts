import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { currentUserId } from "@/db/with-user";
import { notFound } from "./errors";

// ── Resolving a resource by id ────────────────────────────────────────────────
//
// The leak audit found twenty-four routes that took an id from the URL or the
// request body, looked the row up by that id alone, and answered. Every one of
// them was a correct query for a one-athlete database and a cross-user read (or,
// for DELETE /api/race-times, a cross-user delete) the moment there were two.
//
// The shape of the fix is that no route resolves a row by id any more. It asks
// for a row that is BOTH that id AND this caller's, and gets nothing back
// otherwise. That is one function rather than twenty-four filters, because
// twenty-four filters is twenty-four chances to write twenty-three.
//
// Row level security already refuses the same rows, and would do so even if
// this file did not exist. Both are kept deliberately:
//
//   - The policy is the guarantee. It holds for queries nobody thought about,
//     including ones written after this comment.
//   - The filter is the intent, and the performance. It reads as ownership at
//     the call site instead of being invisible database configuration, it lets
//     the planner use the per-table user_id index, and it means a route is still
//     correct if it is ever run on a connection whose context is missing.
//
// A missing context is not silently tolerated: currentUserId() throws, which
// surfaces as a 500 rather than as an empty list.

/** A table that carries its owner directly, so a row can be scoped in one query. */
type OwnedTable = PgTable & {
  id: PgColumn;
  userId: PgColumn;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `WHERE user_id = <caller>` for `table`, for list queries that have no id.
 *
 * Compose it with the query's own conditions: `where(and(ownedBy(t), ...))`.
 */
export function ownedBy(table: OwnedTable): SQL {
  return eq(table.userId, currentUserId());
}

/**
 * The row with this id belonging to the caller, or null.
 *
 * Null covers three cases the caller does not need to distinguish, and should
 * not: no such row, a row owned by someone else, and an id that is not even a
 * uuid. A non-uuid returns null rather than reaching Postgres, which would
 * answer a malformed id with a 500 (`invalid input syntax for type uuid`) and so
 * make "this id is real but not yours" and "this id is nonsense" tell apart.
 */
export async function findOwned<T extends OwnedTable>(
  table: T,
  id: unknown
): Promise<T["$inferSelect"] | null> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  // `as never` on the table: drizzle's `from()` return type is computed from a
  // concrete table, and it cannot reduce that computation while the table is
  // still a generic parameter. The row shape is restored by the cast on the
  // result, which is the type the signature promises.
  const rows = (await db
    .select()
    .from(table as never)
    .where(and(eq(table.id, id), eq(table.userId, currentUserId())))
    .limit(1)) as Array<T["$inferSelect"]>;
  return rows[0] ?? null;
}

/**
 * The row with this id belonging to the caller, or a thrown 404.
 *
 * Use this at the top of any route that takes an id, before doing anything with
 * it. The thrown error is turned into a response by withSession, so the handler
 * body can be written as though the row is always the caller's, which after
 * this line it is.
 */
export async function requireOwned<T extends OwnedTable>(
  table: T,
  id: unknown
): Promise<T["$inferSelect"]> {
  const row = await findOwned(table, id);
  if (!row) throw notFound();
  return row;
}

/**
 * Asserts the caller owns the row, without loading it, for routes that only
 * need permission to proceed (a child-table write, a cascade).
 */
export async function requireOwnership(
  table: OwnedTable,
  id: unknown
): Promise<void> {
  await requireOwned(table, id);
}
