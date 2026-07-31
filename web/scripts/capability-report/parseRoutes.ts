// Pure parser for a single App Router `route.ts` file's source: which HTTP
// methods it exports, and where. The directory walk that finds route.ts
// files lives in walk.ts (it needs the real filesystem); this half stays
// pure so it can be unit tested on a fixture string.

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface RouteMethod {
  method: HttpMethod;
  /** 1-based line number of the export. */
  line: number;
}

const EXPORT_CONST = /^export const (\w+)\s*=/;
const EXPORT_FUNCTION = /^export (?:async )?function (\w+)\s*\(/;

/** Extracts the exported HTTP method handlers from a route.ts source string. */
export function parseRouteFile(source: string): RouteMethod[] {
  const lines = source.split("\n");
  const found: RouteMethod[] = [];

  for (let i = 0; i < lines.length; i++) {
    const constMatch = EXPORT_CONST.exec(lines[i]);
    const fnMatch = EXPORT_FUNCTION.exec(lines[i]);
    const name = constMatch?.[1] ?? fnMatch?.[1];
    if (name && (HTTP_METHODS as readonly string[]).includes(name)) {
      found.push({ method: name as HttpMethod, line: i + 1 });
    }
  }

  return found;
}
