// Compares row counts per table between Neon (source) and Supabase (target)
// after restore-supabase.sh. Fails loudly, and with a nonzero exit code, on
// any mismatch — a restore that silently dropped rows is the worst outcome
// this whole migration can produce, and the only way to catch it is to count.
//
// Usage:
//   NEON_DATABASE_URL=postgres://... SUPABASE_DATABASE_URL=postgres://... \
//     node scripts/supabase-migration/verify-row-counts.mjs
//
// Both URLs should be direct (non-pooled) connections — this runs one
// COUNT(*) per table on each side, sequentially, not high-frequency app
// traffic, so there is no reason to route it through the pooler.

import postgres from "postgres";

async function tableList(sql) {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

async function countAll(sql, tables) {
  const counts = {};
  for (const t of tables) {
    const [row] = await sql.unsafe(`SELECT count(*)::bigint AS n FROM "${t}"`);
    counts[t] = Number(row.n);
  }
  return counts;
}

async function main() {
  const neonUrl = process.env.NEON_DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  if (!neonUrl || !supabaseUrl) {
    console.error("Both NEON_DATABASE_URL and SUPABASE_DATABASE_URL must be set.");
    process.exit(1);
  }

  const neon = postgres(neonUrl, { max: 1, onnotice: () => {} });
  const supabase = postgres(supabaseUrl, { max: 1, onnotice: () => {} });

  try {
    const neonTables = await tableList(neon);
    const supabaseTables = await tableList(supabase);

    const onlyInNeon = neonTables.filter((t) => !supabaseTables.includes(t));
    const onlyInSupabase = supabaseTables.filter((t) => !neonTables.includes(t));

    let failures = 0;
    if (onlyInNeon.length > 0) {
      failures++;
      console.error(`Tables in Neon but missing on Supabase: ${onlyInNeon.join(", ")}`);
    }
    if (onlyInSupabase.length > 0) {
      // Not automatically fatal — Supabase's own internal tables live in
      // other schemas, but a public-schema table with no Neon counterpart is
      // still worth a loud note, e.g. a table the migration chain created
      // that never existed on Neon (expected — the schema itself changed).
      console.warn(`Tables on Supabase but not in Neon (informational): ${onlyInSupabase.join(", ")}`);
    }

    console.log(`\nCounting rows in ${neonTables.length} Neon tables and comparing to Supabase…\n`);
    const neonCounts = await countAll(neon, neonTables);
    const supabaseCounts = await countAll(
      supabase,
      neonTables.filter((t) => supabaseTables.includes(t))
    );

    const rows = [];
    for (const t of neonTables) {
      const n = neonCounts[t];
      const s = supabaseCounts[t] ?? null;
      const match = s !== null && s === n;
      if (!match) failures++;
      rows.push({ table: t, neon: n, supabase: s, match });
    }

    const width = Math.max(...rows.map((r) => r.table.length), "table".length);
    console.log(`${"table".padEnd(width)}  ${"neon".padStart(10)}  ${"supabase".padStart(10)}  status`);
    for (const r of rows) {
      const status = r.match ? "OK" : "MISMATCH";
      console.log(
        `${r.table.padEnd(width)}  ${String(r.neon).padStart(10)}  ${String(r.supabase ?? "—").padStart(10)}  ${status}`
      );
    }

    console.log("");
    if (failures > 0) {
      console.error(`${failures} table(s) failed the row count comparison. Do not treat this restore as trustworthy.`);
      process.exit(1);
    }
    console.log("Every table's row count matches. Restore verified.");
  } finally {
    await neon.end({ timeout: 5 });
    await supabase.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(1);
});
