#!/usr/bin/env node
// Builds the statically exported front end that the native shell ships.
//
// Why this script exists at all: `output: "export"` refuses to build a tree
// that contains route handlers or a proxy. Verified against Next 16.2.4, the
// two errors are:
//
//   export const dynamic = "force-static"/export const revalidate not
//   configured on route "/api/activities" with "output: export"
//
//   Page "/activity/[id]" is missing "generateStaticParams()" so it cannot be
//   used with "output: export" config
//
// The dynamic pages were fixed at the source by moving to query parameters.
// The 77 API routes cannot be: they are the server, and the shell talks to
// them over the network on the hosted deployment. So they have to be absent
// from the tree the shell build compiles.
//
// It stages a copy rather than moving files out of `src/` and putting them
// back. A moved-file approach mutates the working tree for the duration of the
// build, and any crash, Ctrl-C or OOM leaves the repo missing its entire API
// layer. Copying is a few MB and cannot corrupt anything.

import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stageDir = join(webDir, ".shell-build");

// Copied verbatim into the staging tree. Anything Next reads at build time
// belongs here.
const COPY_ENTRIES = [
  "src",
  "public",
  "package.json",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
];

// Excluded from the staged copy because `output: "export"` cannot compile them.
const EXCLUDE_FROM_STAGE = [
  join("src", "app", "api"),
  join("src", "proxy.ts"),
];

function stage() {
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  for (const entry of COPY_ENTRIES) {
    const from = join(webDir, entry);
    if (!existsSync(from)) {
      throw new Error(`Expected ${entry} in web/, but it is not there.`);
    }
    cpSync(from, join(stageDir, entry), { recursive: true });
  }

  for (const entry of EXCLUDE_FROM_STAGE) {
    rmSync(join(stageDir, entry), { recursive: true, force: true });
  }

  // Symlinked, not copied: node_modules is gigabytes and this machine has run
  // out of disk during a build before.
  symlinkSync(join(webDir, "node_modules"), join(stageDir, "node_modules"), "dir");
}

function build() {
  const result = spawnSync(
    join(webDir, "node_modules", ".bin", "next"),
    ["build", "--webpack"],
    {
      cwd: stageDir,
      stdio: "inherit",
      env: {
        ...process.env,
        KADENZ_SHELL_BUILD: "1",
        // Without this Next walks up to the monorepo root looking for a
        // workspace and warns about the three lockfiles it finds.
        NEXT_PRIVATE_OUTPUT_FILE_TRACING_ROOT: stageDir,
      },
    }
  );
  if (result.status !== 0) {
    throw new Error(`next build exited with code ${result.status}`);
  }
}

function collect() {
  const exported = join(stageDir, "out");
  if (!existsSync(exported)) {
    throw new Error("next build finished but produced no out/ directory.");
  }
  const dest = join(webDir, "out");
  rmSync(dest, { recursive: true, force: true });
  cpSync(exported, dest, { recursive: true });
  console.log(`\nStatic export ready at ${dest}`);
  console.log("Copy it into the shell with: cd ../native && npm run sync");
}

try {
  stage();
  build();
  collect();
} finally {
  rmSync(stageDir, { recursive: true, force: true });
}
