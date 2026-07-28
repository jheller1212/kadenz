// Module-level handles shared between global-setup.ts and global-teardown.ts.
// Playwright loads both files once in the same test-runner process, so a
// plain module singleton is enough — no need for a pidfile or IPC.
import type { ChildProcess } from "node:child_process";
import type EmbeddedPostgres from "embedded-postgres";

export const state: {
  pg: EmbeddedPostgres | null;
  devServer: ChildProcess | null;
} = {
  pg: null,
  devServer: null,
};
