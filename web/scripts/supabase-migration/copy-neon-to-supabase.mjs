// Copy all data from Neon to Supabase, table by table, in FK dependency order.
//
// Why not pg_dump: neither pg_dump nor psql is installed on this machine, and
// the dataset is small (14 MB). A driver-level copy also lets us diff the two
// schemas before touching rows and verify counts per table afterwards, which a
// plain restore would not.
//
// Connects to Supabase as `postgres` deliberately: that role carries BYPASSRLS,
// so inserts are not filtered by the tenancy policies during the copy. The app
// itself must NEVER use that role, or every policy silently stops applying.
// See kadenz_app in the cutover doc.
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const SRC = readFileSync(`${homedir()}/.kadenz-neon-url`, "utf8").trim();
const DST = readFileSync(`${homedir()}/.kadenz-supabase-url`, "utf8").trim();
const APPLY = process.argv.includes("--apply");

const src = postgres(SRC, { max: 1, prepare: false, ssl: "require" });
const dst = postgres(DST, { max: 1, prepare: false, ssl: "require" });

const cols = async (sql) => {
  const rows = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position`;
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.table_name)) m.set(r.table_name, []);
    m.get(r.table_name).push(r.column_name);
  }
  return m;
};

// Topological order over the FK graph, so a child never lands before its parent.
async function order(sql) {
  const tables = (
    await sql`SELECT tablename FROM pg_tables WHERE schemaname='public'`
  ).map((r) => r.tablename);
  const deps = await sql`
    SELECT tc.table_name AS child, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const parents = new Map(tables.map((t) => [t, new Set()]));
  for (const d of deps) {
    if (d.child !== d.parent && parents.has(d.child)) parents.get(d.child).add(d.parent);
  }
  const out = [];
  const seen = new Set();
  while (out.length < tables.length) {
    const ready = tables.filter(
      (t) => !seen.has(t) && [...parents.get(t)].every((p) => seen.has(p))
    );
    // A self-reference or a cycle leaves nothing ready. Those tables go last
    // rather than stalling the sort.
    if (ready.length === 0) {
      for (const t of tables) if (!seen.has(t)) { out.push(t); seen.add(t); }
      break;
    }
    for (const t of ready) { out.push(t); seen.add(t); }
  }
  return out;
}

const [sc, dc] = await Promise.all([cols(src), cols(dst)]);

// A column on one side and not the other means the schemas drifted. Copying
// anyway would silently drop that data, so report it before writing a row.
const drift = [];
for (const [t, c] of sc) {
  if (!dc.has(t)) { drift.push(`table ${t} missing on target`); continue; }
  const missing = c.filter((x) => !dc.get(t).includes(x));
  const extra = dc.get(t).filter((x) => !c.includes(x));
  if (missing.length) drift.push(`${t}: target lacks ${missing.join(", ")}`);
  if (extra.length) drift.push(`${t}: target has extra ${extra.join(", ")}`);
}
for (const t of dc.keys()) if (!sc.has(t)) drift.push(`table ${t} missing on source`);

console.log(drift.length ? "SCHEMA DIFFERENCES:" : "Schemas match.");
for (const d of drift) console.log("  " + d);

const tables = await order(dst);
const counts = [];
for (const t of tables) {
  const [{ c }] = await src.unsafe(`SELECT count(*)::int AS c FROM "${t}"`);
  counts.push([t, c]);
}
console.log("\nSource rows:");
for (const [t, c] of counts) if (c > 0) console.log(`  ${t}: ${c}`);
console.log(`  total: ${counts.reduce((a, [, c]) => a + c, 0)}`);

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to copy.");
  await src.end(); await dst.end();
  process.exit(0);
}

console.log("\nCopying...");
for (const [t, c] of counts) {
  if (c === 0) continue;
  const shared = sc.get(t).filter((x) => dc.get(t).includes(x));
  const rows = await src.unsafe(
    `SELECT ${shared.map((x) => `"${x}"`).join(",")} FROM "${t}"`
  );
  // Batched so one oversized statement cannot exceed the wire limit on the
  // stream-heavy tables.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await dst`INSERT INTO ${dst(t)} ${dst(chunk, ...shared)} ON CONFLICT DO NOTHING`;
  }
  const [{ c: got }] = await dst.unsafe(`SELECT count(*)::int AS c FROM "${t}"`);
  console.log(`  ${t}: ${got}/${c}${got === c ? "" : "  MISMATCH"}`);
}

console.log("\nVerifying every table...");
let bad = 0;
for (const [t, c] of counts) {
  const [{ c: got }] = await dst.unsafe(`SELECT count(*)::int AS c FROM "${t}"`);
  if (got !== c) { console.log(`  MISMATCH ${t}: source ${c}, target ${got}`); bad++; }
}
console.log(bad === 0 ? "All row counts match." : `${bad} table(s) mismatched.`);

await src.end(); await dst.end();
process.exit(bad === 0 ? 0 : 1);
