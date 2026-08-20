#!/usr/bin/env node
// ── Reclaim the disk a worktree-per-task workflow leaks ─────────────────────
//
// Every agent worktree gets its own `npm ci` (~1 GB), its own `.next` (~1 GB
// once built) and, if it runs the e2e suite, its own Playwright browsers.
// Nothing ever reaps them. This repo reached 48 abandoned worktrees totalling
// 54 GB, which filled the disk mid-session and failed a build with ENOSPC —
// the kind of failure that reads as a code problem for the first twenty
// minutes.
//
// This only ever deletes REGENERABLE build output: node_modules, .next,
// test-results, playwright-report. It never touches source, never touches a
// git directory, and never removes a worktree. A worktree can hold
// uncommitted work — six of them did when this was written — so deciding
// which are disposable is a judgement call for a person, not a sweep.
//
//   node scripts/clean-worktrees.mjs           # report only
//   node scripts/clean-worktrees.mjs --apply   # delete

import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// Resolve the MAIN repo, not whichever worktree this happens to run from —
// .claude/worktrees only exists in the main checkout, and running this from
// inside a worktree is the normal case. `--git-common-dir` points at the main
// repository's .git even from a linked worktree, which is exactly the
// distinction needed here.
function findRepoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const commonGitDir = execSync("git rev-parse --path-format=absolute --git-common-dir", {
      cwd: here,
      encoding: "utf8",
    }).trim();
    return dirname(commonGitDir);
  } catch {
    // Not a git checkout (or git missing): fall back to the layout on disk.
    return join(here, "..", "..");
  }
}

const repoRoot = findRepoRoot();
const worktreesDir = join(repoRoot, ".claude", "worktrees");

const DISPOSABLE = ["node_modules", ".next", "test-results", "playwright-report"];
const apply = process.argv.includes("--apply");

function dirSizeBytes(path) {
  try {
    // du rather than walking the tree in node: this is meant to be run
    // casually, not to be elegant.
    const out = execSync(`du -sk ${JSON.stringify(path)} 2>/dev/null`, { encoding: "utf8" });
    return Number.parseInt(out.split("\t")[0], 10) * 1024;
  } catch {
    return 0;
  }
}

function human(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}G`;
  if (bytes > 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`;
  return `${Math.round(bytes / 1024)}K`;
}

function candidates(worktree) {
  const out = [];
  for (const base of [worktree, join(worktree, "web")]) {
    for (const name of DISPOSABLE) {
      const p = join(base, name);
      if (existsSync(p)) out.push(p);
    }
  }
  return out;
}

if (!existsSync(worktreesDir)) {
  console.log("No .claude/worktrees directory — nothing to do.");
  process.exit(0);
}

const worktrees = readdirSync(worktreesDir)
  .map((n) => join(worktreesDir, n))
  .filter((p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  });

let total = 0;
let count = 0;

for (const wt of worktrees) {
  const paths = candidates(wt);
  if (paths.length === 0) continue;
  const size = paths.reduce((sum, p) => sum + dirSizeBytes(p), 0);
  if (size === 0) continue;
  total += size;
  count += paths.length;
  console.log(
    `${apply ? "removing" : "would remove"}  ${human(size).padStart(6)}  ${wt.replace(`${repoRoot}/`, "")}`
  );
  if (apply) for (const p of paths) rmSync(p, { recursive: true, force: true });
}

console.log(
  total === 0
    ? "\nNothing to reclaim — worktrees carry no build output."
    : `\n${apply ? "Reclaimed" : "Would reclaim"} ${human(total)} across ${count} director${count === 1 ? "y" : "ies"} in ${worktrees.length} worktrees.` +
        (apply ? "" : "\nRe-run with --apply to delete.")
);
