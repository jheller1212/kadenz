import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Set only by the e2e harness on the dev server it starts (see
  // web/e2e/global-setup.ts). Next dev keeps 5 compiled pages for 60 seconds
  // each and recompiles anything else on demand — and an on-demand recompile
  // pushes a Fast Refresh update to whatever page is open at that moment. A
  // page that takes a hot update while it is still hydrating can stop
  // hydrating altogether: the app sits on the boot splash and the test times
  // out waiting for an element that will never appear. With ~110 routes and a
  // buffer of 5, that was happening somewhere in almost every run. Holding
  // every route in memory for the length of a run removes the whole class of
  // failure. `next build` ignores onDemandEntries, so production is untouched.
  ...(process.env.KADENZ_E2E === "1"
    ? { onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 500 } }
    : {}),
};

export default nextConfig;
