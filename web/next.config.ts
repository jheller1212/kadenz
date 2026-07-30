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

const baseConfig: NextConfig = {};

const nextConfig: NextConfig = isShellBuild ? shellConfig : baseConfig;

export default nextConfig;
