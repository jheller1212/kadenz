// Pure text parser for src/db/schema.ts. Deliberately does not import the
// schema module and run it through drizzle's runtime introspection: a plain
// regex walk over the source keeps this testable on a small fixture string
// (see __tests__/parseSchema.test.ts) without dragging in drizzle-orm's
// pg-core types, and it gives us the one thing runtime introspection
// wouldn't: a line number to point a reader at.

export interface SchemaColumn {
  /** The TS property name, e.g. "equipmentOverride". */
  name: string;
  /** The SQL column name from the first string arg, e.g. "equipment_override". */
  dbName: string | null;
  /** 1-based line number of the column definition. */
  line: number;
}

export interface SchemaTable {
  /** The exported const name, e.g. "strengthSessions". */
  key: string;
  /** The SQL table name, e.g. "strength_sessions". */
  tableName: string | null;
  /** 1-based line number of the `export const X = pgTable(` line. */
  line: number;
  columns: SchemaColumn[];
}

const TABLE_START = /^export const (\w+)\s*=\s*pgTable\(/;

// pgTable is called in two shapes in this codebase:
//   pgTable("name", { ... })              -- columns object opens inline,
//                                            so its properties sit at 2 spaces.
//   pgTable(\n  "name",\n  { ... },\n ...) -- columns object starts on its
//                                            own line, properties sit at 4.
// Only that top-level indent is a sibling column; anything deeper is inside
// a column's own value (a jsonb .$type<> generic, a chained
// .references({...}) options object, etc.) and must not be mistaken for one.
function columnIndent(tableStartLine: string): number {
  return tableStartLine.trimEnd().endsWith("{") ? 2 : 4;
}

/**
 * Parses drizzle `pgTable` definitions out of a schema.ts source string.
 * Table order in the output follows source order; columns follow their
 * declaration order within each table.
 */
export function parseSchema(source: string): SchemaTable[] {
  const lines = source.split("\n");
  const starts: { key: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = TABLE_START.exec(lines[i]);
    if (m) starts.push({ key: m[1], line: i + 1 });
  }

  return starts.map((start, idx) => {
    const blockEnd = idx + 1 < starts.length ? starts[idx + 1].line - 1 : lines.length;
    // Table name is the first quoted string within a few lines of the
    // pgTable( call, whether it's inline (`pgTable("users", {`) or on its
    // own line (multi-arg call with an options object).
    let tableName: string | null = null;
    for (let i = start.line - 1; i < Math.min(start.line + 2, blockEnd); i++) {
      const nameMatch = /"([a-z0-9_]+)"/.exec(lines[i]);
      if (nameMatch) {
        tableName = nameMatch[1];
        break;
      }
    }

    const indent = columnIndent(lines[start.line - 1]);
    const columnLine = new RegExp(`^ {${indent}}([a-zA-Z_][a-zA-Z0-9_]*):\\s*(.*)$`);

    const columns: SchemaColumn[] = [];
    for (let i = start.line; i < blockEnd; i++) {
      const cm = columnLine.exec(lines[i]);
      if (!cm) continue;
      const dbNameMatch = /^[a-zA-Z]+\(\s*"([a-z0-9_]+)"/.exec(cm[2]);
      columns.push({
        name: cm[1],
        dbName: dbNameMatch ? dbNameMatch[1] : null,
        line: i + 1,
      });
    }

    return { key: start.key, tableName, line: start.line, columns };
  });
}
