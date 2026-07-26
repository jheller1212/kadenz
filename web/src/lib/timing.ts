/**
 * Phase timing for the slow write paths (plan creation, strength scheduling).
 *
 * Emits ONE structured line per operation so it can be grepped out of the
 * Vercel runtime logs and aggregated:
 *
 *   {"timing":"plans.create","totalMs":8421.3,"phases":{"generate":0.2,...}}
 *
 * Deliberately console-only. Persisting timings would mean another table and
 * another write on the very request we are trying to make faster; the logs
 * already retain enough to spot a regression.
 */
export function timer(label: string) {
  const t0 = performance.now();
  const phases: Record<string, number> = {};
  let last = t0;

  return {
    /** Close off the phase that just ran. */
    mark(name: string) {
      const now = performance.now();
      phases[name] = Math.round((now - last) * 10) / 10;
      last = now;
    },
    /** Emit the line. `extra` should be scale, not personal data (row counts). */
    done(extra?: Record<string, unknown>) {
      const totalMs = Math.round((performance.now() - t0) * 10) / 10;
      console.log(JSON.stringify({ timing: label, totalMs, phases, ...extra }));
      return totalMs;
    },
  };
}
