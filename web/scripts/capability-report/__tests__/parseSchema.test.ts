import { describe, expect, it } from "vitest";
import { parseSchema } from "../parseSchema";

// A hand-built fixture, not a copy of the live schema.ts, so this test
// doesn't churn every time a real column gets added or removed.
const FIXTURE = `import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const widgets = pgTable("widgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  metadata: text("metadata")
    .array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const gadgets = pgTable(
  "gadgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countOverride: integer("count_override"),
  },
  (t) => [],
);

export const sprockets = pgTable("sprockets", {
  id: uuid("id").primaryKey().defaultRandom(),
  torqueOverride: integer("torque_override"),
});
`;

describe("parseSchema", () => {
  const tables = parseSchema(FIXTURE);

  it("finds every pgTable in source order", () => {
    expect(tables.map((t) => t.key)).toEqual(["widgets", "gadgets", "sprockets"]);
  });

  it("handles the inline pgTable(name, { ... }) call shape", () => {
    const sprockets = tables.find((t) => t.key === "sprockets")!;
    expect(sprockets.tableName).toBe("sprockets");
    const override = sprockets.columns.find((c) => c.name === "torqueOverride");
    expect(override).toBeDefined();
    expect(override!.dbName).toBe("torque_override");
  });

  it("reports a known-present table with its SQL name and line", () => {
    const widgets = tables.find((t) => t.key === "widgets");
    expect(widgets).toBeDefined();
    expect(widgets!.tableName).toBe("widgets");
    expect(widgets!.line).toBe(3);
  });

  it("reports a known-present column with db name and line", () => {
    const widgets = tables.find((t) => t.key === "widgets")!;
    const name = widgets.columns.find((c) => c.name === "name");
    expect(name).toBeDefined();
    expect(name!.dbName).toBe("name");
    expect(name!.line).toBe(5);
  });

  it("does not report a column that was never declared", () => {
    const widgets = tables.find((t) => t.key === "widgets")!;
    expect(widgets.columns.find((c) => c.name === "doesNotExist")).toBeUndefined();
  });

  it("handles the multi-line pgTable(name, columns, extras) call shape", () => {
    const gadgets = tables.find((t) => t.key === "gadgets")!;
    expect(gadgets.tableName).toBe("gadgets");
    const override = gadgets.columns.find((c) => c.name === "countOverride");
    expect(override).toBeDefined();
    expect(override!.dbName).toBe("count_override");
  });

  it("does not confuse a whole other table for missing evidence", () => {
    expect(tables.find((t) => t.key === "flywheels")).toBeUndefined();
  });
});
