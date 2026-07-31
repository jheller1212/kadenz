// Filesystem side of the capability report: walks the real src/ tree and
// hands file contents to the pure parsers in parseRoutes.ts / parseTokens.ts
// / parseSchema.ts. Kept separate from those so the parsers can be unit
// tested on fixture strings without touching disk.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseRouteFile, type RouteMethod } from "./parseRoutes";

// Matches `wc -l`: count newlines, not array length after split (a
// trailing-newline file would otherwise report one line too many).
function countLines(source: string): number {
  return source.length === 0 ? 0 : (source.match(/\n/g)?.length ?? 0) + (source.endsWith("\n") ? 0 : 1);
}

export interface RouteEntry {
  /** e.g. "/api/strength/sessions/[id]/garmin" */
  routePath: string;
  /** repo-relative file path */
  filePath: string;
  methods: RouteMethod[];
}

export interface FileEntry {
  /** repo-relative file path */
  filePath: string;
  /** route path for pages, derived the same way as RouteEntry */
  routePath: string;
  lines: number;
}

function walkDir(dir: string, fileName: (name: string) => boolean, results: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkDir(full, fileName, results);
    } else if (fileName(entry)) {
      results.push(full);
    }
  }
  return results;
}

/** Next.js route-group segments like "(app)" don't appear in the URL; drop them. */
function toRoutePath(relFromRoot: string): string {
  const segments = relFromRoot.split(sep).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + segments.join("/");
}

export function walkApiRoutes(apiDir: string, repoRoot: string): RouteEntry[] {
  const files = walkDir(apiDir, (name) => name === "route.ts" || name === "route.tsx");
  return files
    .map((full) => {
      const source = readFileSync(full, "utf8");
      const methods = parseRouteFile(source);
      const relFromApi = relative(apiDir, full).replace(/[\\/]route\.tsx?$/, "");
      return {
        routePath: "/api" + (relFromApi ? "/" + relFromApi.split(sep).join("/") : ""),
        filePath: relative(repoRoot, full),
        methods,
      };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));
}

export function walkPages(appDir: string, repoRoot: string): FileEntry[] {
  const files = walkDir(appDir, (name) => name === "page.tsx");
  return files
    .filter((full) => !relative(appDir, full).startsWith("api" + sep))
    .map((full) => {
      const source = readFileSync(full, "utf8");
      const relFromApp = relative(appDir, full).replace(/[\\/]page\.tsx$/, "");
      return {
        filePath: relative(repoRoot, full),
        routePath: toRoutePath(relFromApp || "."),
        lines: countLines(source),
      };
    })
    .sort((a, b) => a.routePath.localeCompare(b.routePath));
}

export function walkComponents(componentsDir: string, repoRoot: string): FileEntry[] {
  const files = walkDir(componentsDir, (name) => name.endsWith(".tsx") || name.endsWith(".ts"));
  return files
    .map((full) => {
      const source = readFileSync(full, "utf8");
      return {
        filePath: relative(repoRoot, full),
        routePath: relative(componentsDir, full).split(sep).join("/"),
        lines: countLines(source),
      };
    })
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}
