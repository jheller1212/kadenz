import type { NextConfig } from "next";

// The native shell (see ../native/README.md) bundles a statically exported copy
// of this front end and talks to the hosted API over the network. That build
// sets KADENZ_SHELL_BUILD=1 and runs from a staged tree with no API routes and
// no proxy, because `output: "export"` refuses both.
//
// The Vercel deployment must never build this way: it is the thing that serves
// the API routes and the proxy that gates them. Hence an explicit opt-in env
// var rather than a second config file that could get picked up by accident.
const isShellBuild = process.env.KADENZ_SHELL_BUILD === "1";

const shellConfig: NextConfig = {
  output: "export",
  // No custom distDir on purpose. The shell build runs in a staged copy of the
  // tree (scripts/build-shell.mjs), so its .next and out/ are already isolated
  // from the normal build. Setting distDir here moved the exported HTML out of
  // out/ and broke the script that collects it.
  //
  // Static export has no image optimizer at runtime. Nothing imports next/image
  // today, so this only stops a future import from silently breaking the shell.
  images: { unoptimized: true },
};

const baseConfig: NextConfig = {
  // Kept for a dev server started by hand with KADENZ_E2E=1, which is the fast
  // way to iterate while authoring a spec (no rebuild per run). The e2e harness
  // itself no longer starts one — it builds and serves a production build, see
  // web/e2e/README.md — so this is not on the CI path.
  //
  // Next dev keeps 5 compiled pages for 60 seconds each and recompiles anything
  // else on demand, and an on-demand recompile pushes a Fast Refresh update to
  // whatever page is open. A page that takes one while hydrating can stop
  // hydrating, and the spec that fails is whichever was open. Holding every
  // route in memory removes that. `next build` ignores onDemandEntries.
  ...(process.env.KADENZ_E2E === "1"
    ? { onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 500 } }
    : {}),
};

const nextConfig: NextConfig = isShellBuild ? shellConfig : baseConfig;

export default nextConfig;
