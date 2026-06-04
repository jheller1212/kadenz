import { type NextRequest } from "next/server";

// ── POST /api/diagnose-deploy ─────────────────────────────────────────────────
// Fetches recent Vercel deployments, finds the most recent failure (or a
// specific deployment by URL), pulls its build logs, and cross-references the
// triggering git commit via the GitHub API to produce a diagnosis report.

interface VercelDeployment {
  uid: string;
  url: string;
  state: string;
  createdAt: number;
  meta?: {
    githubCommitRef?: string;
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubCommitAuthorName?: string;
    branchAlias?: string;
  };
}

interface VercelLogLine {
  text?: string;
  payload?: { text?: string };
}

interface GitHubFile {
  filename: string;
}

interface DiagnosisReport {
  status: "failed" | "healthy";
  deployment?: {
    id: string;
    url: string;
    state: string;
    createdAt: string;
    branch: string;
    commitSha: string;
    commitMessage: string;
    commitAuthor: string;
  };
  diagnosis?: {
    errorSnippet: string;
    rootCause: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    changedFiles: string[];
  };
  recentDeployments: Array<{
    id: string;
    state: string;
    createdAt: string;
    branch: string;
  }>;
}

const ERROR_PATTERNS: Array<{ pattern: RegExp; cause: string; confidence: "HIGH" | "MEDIUM" | "LOW" }> = [
  { pattern: /Cannot find module|Module not found/i, cause: "Missing dependency or incorrect import path", confidence: "HIGH" },
  { pattern: /Type error|TypeScript error|TS\d{4}/i, cause: "TypeScript type mismatch or compilation error", confidence: "HIGH" },
  { pattern: /SyntaxError|Unexpected token/i, cause: "JavaScript/TypeScript syntax error", confidence: "HIGH" },
  { pattern: /ENOENT|no such file or directory/i, cause: "Missing file referenced during build", confidence: "HIGH" },
  { pattern: /Build failed|build error/i, cause: "Generic build failure — check full logs for root cause", confidence: "MEDIUM" },
  { pattern: /out of memory|heap out of memory/i, cause: "Node.js ran out of memory during build", confidence: "HIGH" },
  { pattern: /Cannot read propert|undefined is not/i, cause: "Null/undefined reference at build time", confidence: "MEDIUM" },
  { pattern: /eslint|lint error/i, cause: "ESLint rule violation blocking build", confidence: "HIGH" },
  { pattern: /failed|error/i, cause: "Build failure — check error snippet for details", confidence: "LOW" },
];

function classifyError(snippet: string): { rootCause: string; confidence: "HIGH" | "MEDIUM" | "LOW" } {
  for (const { pattern, cause, confidence } of ERROR_PATTERNS) {
    if (pattern.test(snippet)) {
      return { rootCause: cause, confidence };
    }
  }
  return { rootCause: "Unknown build failure", confidence: "LOW" };
}

function extractBranch(deployment: VercelDeployment): string {
  return (
    deployment.meta?.githubCommitRef ??
    deployment.meta?.branchAlias ??
    "unknown"
  );
}

function summariseDeployment(d: VercelDeployment) {
  return {
    id: d.uid,
    state: d.state,
    createdAt: new Date(d.createdAt).toISOString(),
    branch: extractBranch(d),
  };
}

export async function POST(request: NextRequest) {
  const apiSecret = process.env.API_SECRET;
  if (apiSecret && request.headers.get("x-api-secret") !== apiSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  const githubToken = process.env.GITHUB_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const githubRepo = process.env.GITHUB_REPO ?? "jheller1212/kadenz";

  if (!vercelToken) {
    return Response.json({ error: "VERCEL_TOKEN not configured" }, { status: 500 });
  }

  let deploymentUrl: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    deploymentUrl = (body as { deploymentUrl?: string }).deploymentUrl;
  } catch {
    // body is optional — proceed without it
  }

  // ── 1. Fetch recent deployments ─────────────────────────────────────────────
  const listUrl = new URL("https://api.vercel.com/v6/deployments");
  listUrl.searchParams.set("limit", "20");
  if (projectId) listUrl.searchParams.set("projectId", projectId);

  let allDeployments: VercelDeployment[] = [];
  try {
    const res = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${vercelToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `Vercel API error ${res.status}: ${text}` },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { deployments?: VercelDeployment[] };
    allDeployments = data.deployments ?? [];
  } catch (err) {
    return Response.json(
      { error: `Failed to reach Vercel API: ${String(err)}` },
      { status: 502 }
    );
  }

  const recentDeployments = allDeployments.slice(0, 5).map(summariseDeployment);

  // ── 2. Identify the target deployment ───────────────────────────────────────
  let target: VercelDeployment | undefined;

  if (deploymentUrl) {
    const needle = deploymentUrl.replace(/^https?:\/\//, "");
    target = allDeployments.find((d) => d.url === needle || `https://${d.url}` === deploymentUrl);
  } else {
    target = allDeployments.find(
      (d) => d.state === "ERROR" || d.state === "CANCELED"
    );
  }

  if (!target) {
    const report: DiagnosisReport = {
      status: "healthy",
      recentDeployments,
    };
    return Response.json(report);
  }

  // ── 3. Fetch build logs ──────────────────────────────────────────────────────
  let errorSnippet = "";
  try {
    const logsRes = await fetch(
      `https://api.vercel.com/v2/deployments/${target.uid}/events`,
      { headers: { Authorization: `Bearer ${vercelToken}` } }
    );
    if (logsRes.ok) {
      const logsText = await logsRes.text();
      // Events are newline-delimited JSON
      const lines = logsText
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l) as VercelLogLine;
          } catch {
            return null;
          }
        })
        .filter((l): l is VercelLogLine => l !== null);

      const errorLine = lines.find((l) => {
        const text = l.text ?? l.payload?.text ?? "";
        return /error|failed|FAIL/i.test(text);
      });

      if (errorLine) {
        const raw = errorLine.text ?? errorLine.payload?.text ?? "";
        errorSnippet = raw.slice(0, 500);
      }
    }
  } catch {
    // Logs are best-effort — continue without them
  }

  // ── 4. Fetch changed files from GitHub ──────────────────────────────────────
  const commitSha = target.meta?.githubCommitSha ?? "";
  let changedFiles: string[] = [];

  if (commitSha && githubToken) {
    try {
      const ghRes = await fetch(
        `https://api.github.com/repos/${githubRepo}/commits/${commitSha}`,
        {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );
      if (ghRes.ok) {
        const ghData = (await ghRes.json()) as { files?: GitHubFile[] };
        changedFiles = (ghData.files ?? []).map((f) => f.filename);
      }
    } catch {
      // GitHub lookup is best-effort
    }
  }

  // ── 5. Build diagnosis ───────────────────────────────────────────────────────
  const { rootCause, confidence } = classifyError(errorSnippet);

  const report: DiagnosisReport = {
    status: "failed",
    deployment: {
      id: target.uid,
      url: `https://${target.url}`,
      state: target.state,
      createdAt: new Date(target.createdAt).toISOString(),
      branch: extractBranch(target),
      commitSha,
      commitMessage: target.meta?.githubCommitMessage ?? "",
      commitAuthor: target.meta?.githubCommitAuthorName ?? "",
    },
    diagnosis: {
      errorSnippet,
      rootCause,
      confidence,
      changedFiles,
    },
    recentDeployments,
  };

  return Response.json(report);
}
