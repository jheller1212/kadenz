import { describe, expect, it } from "vitest";
import { parseRouteFile } from "../parseRoutes";

const FIXTURE = `import { withSession } from "@/lib/auth";

export const GET = withSession(async () => {
  return Response.json({ ok: true });
});

export const POST = withSession(async (request) => {
  return Response.json({ ok: true });
});
`;

describe("parseRouteFile", () => {
  it("finds every exported HTTP method with a line number", () => {
    const methods = parseRouteFile(FIXTURE);
    expect(methods).toEqual([
      { method: "GET", line: 3 },
      { method: "POST", line: 7 },
    ]);
  });

  it("does not report a method the file never exports", () => {
    const methods = parseRouteFile(FIXTURE);
    expect(methods.find((m) => m.method === "DELETE")).toBeUndefined();
  });

  it("also matches the plain function export shape", () => {
    const methods = parseRouteFile(`export async function DELETE(req) {}\n`);
    expect(methods).toEqual([{ method: "DELETE", line: 1 }]);
  });

  it("ignores non-HTTP exports", () => {
    const methods = parseRouteFile(`export const runtime = "nodejs";\n`);
    expect(methods).toEqual([]);
  });
});
