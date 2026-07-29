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
  // Set only by the e2e harness on the dev server it starts (see
  // web/e2e/global-setup.ts). Next dev keeps 5 compiled pages for 60 seconds
  // each and recompiles anything else on demand, and an on-demand recompile
  // pushes a Fast Refresh update to whatever page is open at that moment. A
  // page that takes a hot update while it is still hydrating can stop
  // hydrating altogether: the app sits on the boot splash and the test times
  // out waiting for an element that will never appear. With around 110 routes
  // and a buffer of 5, that was happening somewhere in almost every run.
  // Holding every route in memory for the length of a run removes the whole
  // class of failure. `next build` ignores onDemandEntries, so production is
  // untouched.
  ...(process.env.KADENZ_E2E === "1"
    ? { onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 500 } }
    : {}),
};

const nextConfig: NextConfig = isShellBuild ? shellConfig : baseConfig;

export default nextConfig;
