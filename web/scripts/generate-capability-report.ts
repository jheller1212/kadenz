#!/usr/bin/env tsx
// Generates a factual, machine-checked inventory of what exists in the
// Kadenz web app: schema tables/columns, API routes, screens, components,
// and design tokens, each with a file and line reference.
//
// This is deliberately NOT a status tracker. It never says whether a
// capability is "designed", "in progress", or "matches the brief" — it says
// only whether the code has it and where. The design project's STATUS.md
// keeps its own judgement columns; this file exists so that judgement is
// checked against evidence instead of a hand-transcribed guess that goes
// stale the moment the code moves (see the four wrong rows found on
// 2026-07-31: the exercise picker, per-session equipment override, the
// protocol-week/restart-rule UI, and --k-danger all already existed).
//
// Run from web/: npx tsx scripts/generate-capability-report.ts

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseSchema } from "./capability-report/parseSchema";
import { mergeTokenBlocks, parseCssTokens } from "./capability-report/parseTokens";
import { walkApiRoutes, walkComponents, walkPages } from "./capability-report/walk";

const WEB_ROOT = join(__dirname, "..");
const OUTPUT_PATH = join(WEB_ROOT, "docs", "CAPABILITY_REPORT.md");

function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: WEB_ROOT }).toString().trim();
  } catch {
    return "unknown (no git checkout found)";
  }
}

function gitDirty(): boolean {
  try {
    return execSync("git status --porcelain", { cwd: WEB_ROOT }).toString().trim().length > 0;
  } catch {
    return false;
  }
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|");
}

function buildSchemaSection(): string {
  const source = readFileSync(join(WEB_ROOT, "src", "db", "schema.ts"), "utf8");
  const tables = parseSchema(source);
  const lines: string[] = [
    "## Schema tables and columns",
    "",
    `Parsed from \`src/db/schema.ts\` (${tables.length} tables). A column listed here exists in the table type; it does not mean a migration has been applied to every environment.`,
    "",
  ];
  for (const table of tables) {
    lines.push(`### \`${table.key}\`${table.tableName ? ` (\`${table.tableName}\`)` : ""} — src/db/schema.ts:${table.line}`);
    lines.push("");
    lines.push("| column | db column | line |");
    lines.push("|---|---|---|");
    for (const col of table.columns) {
      lines.push(`| \`${col.name}\` | \`${col.dbName ?? "—"}\` | src/db/schema.ts:${col.line} |`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildRoutesSection(): string {
  const routes = walkApiRoutes(join(WEB_ROOT, "src", "app", "api"), WEB_ROOT);
  const lines: string[] = [
    "## API routes",
    "",
    `Walked from \`src/app/api/\` (${routes.length} route files).`,
    "",
    "| route | methods | file |",
    "|---|---|---|",
  ];
  for (const route of routes) {
    const methods = route.methods.map((m) => `${m.method} (:${m.line})`).join(", ") || "none exported";
    lines.push(`| \`${route.routePath}\` | ${methods} | ${route.filePath} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildScreensSection(): string {
  const pages = walkPages(join(WEB_ROOT, "src", "app"), WEB_ROOT);
  const lines: string[] = [
    "## Screens (`page.tsx`)",
    "",
    `Walked from \`src/app/\` (${pages.length} pages). Line count is a stub/real signal only, not a quality one.`,
    "",
    "| route | lines | file |",
    "|---|---|---|",
  ];
  for (const page of pages) {
    lines.push(`| \`${page.routePath}\` | ${page.lines} | ${page.filePath} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildComponentsSection(): string {
  const components = walkComponents(join(WEB_ROOT, "src", "components"), WEB_ROOT);
  const lines: string[] = [
    "## Components",
    "",
    `Walked from \`src/components/\` (${components.length} files). Line count distinguishes a real implementation from a stub without reading each file.`,
    "",
    "| file | lines |",
    "|---|---|",
  ];
  for (const comp of components) {
    lines.push(`| \`${comp.routePath}\` | ${comp.lines} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildTokensSection(): string {
  const source = readFileSync(join(WEB_ROOT, "src", "app", "globals.css"), "utf8");
  const blocks = parseCssTokens(source);
  const dark = mergeTokenBlocks(blocks, ":root");
  const light = mergeTokenBlocks(blocks, "html.light");
  const names = Array.from(new Set([...dark.keys(), ...light.keys()]))
    .filter((n) => n.startsWith("--k-") || n.startsWith("--vi-"))
    .sort();

  const lines: string[] = [
    "## Design tokens",
    "",
    `Parsed from \`src/app/globals.css\`: \`--k-*\` and \`--vi-*\` custom properties in the top-level \`:root\` (dark) and \`html.light\` (light) blocks (${names.length} tokens). Element-level overrides (e.g. \`.k-dark-surface\`) are not tracked here.`,
    "",
    "| token | dark (`:root`) | light (`html.light`) |",
    "|---|---|---|",
  ];
  for (const name of names) {
    const d = dark.get(name);
    const l = light.get(name);
    const dCell = d ? `${mdEscape(d.value)} (:${d.line})` : "not set";
    const lCell = l ? `${mdEscape(l.value)} (:${l.line})` : "not set — falls back to dark";
    lines.push(`| \`${name}\` | ${dCell} | ${lCell} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const sha = gitSha();
  const dirty = gitDirty();
  const generatedAt = new Date().toISOString();

  const header = [
    "# Kadenz capability report",
    "",
    "Generated, not hand-maintained. Regenerate with `npm run report:capabilities` from `web/` " +
      "(runs `scripts/generate-capability-report.ts`).",
    "",
    `Generated at \`${generatedAt}\` from commit \`${sha}\`${dirty ? " (working tree had uncommitted changes at generation time)" : ""}.`,
    "",
    "This file answers only \"what exists in the code, with proof\": every row below has a file and " +
      "line reference, and every reference is re-derived from the source on each run, not copied " +
      "from a prior version of this file. It says nothing about what is designed, planned, or " +
      "matches a brief — that judgement, and its own tracking columns, belongs to the design " +
      "project's STATUS.md.",
    "",
  ].join("\n");

  const body = [
    header,
    buildSchemaSection(),
    buildRoutesSection(),
    buildScreensSection(),
    buildComponentsSection(),
    buildTokensSection(),
  ].join("\n");

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, body.trimEnd() + "\n");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
