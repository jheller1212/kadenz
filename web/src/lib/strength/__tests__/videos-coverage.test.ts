import { describe, expect, it } from "vitest";
import { EXERCISES } from "../program";
import { EXERCISE_VIDEOS } from "../videos";

// Slugs explicitly allowed to ship without a form-demo video. Keep this empty
// unless there's a real reason (e.g. a movement with no safe/available short
// demo) — anything added here is silently invisible in the session UI's
// video button (see GuidedSession.tsx, gated on getVideoId), so an empty
// catalogue entry is easy to miss. Adding a slug here must be a deliberate,
// reviewed choice, not the default when nobody got around to finding a link.
const NO_VIDEO_ALLOWED = new Set<string>([]);

// Jonas found "clamshell" (and others) with no video mid-session — a seeded
// exercise that never got a demo link. This test makes that drift loud at
// build/test time instead of silent in the app: every exercise in the
// catalogue must have a video, or be on the explicit allowlist above.
describe("exercise video coverage", () => {
  it("has a video (or an explicit allowlist entry) for every catalogue exercise", () => {
    const missing = EXERCISES.map((e) => e.slug).filter(
      (slug) => !EXERCISE_VIDEOS[slug] && !NO_VIDEO_ALLOWED.has(slug)
    );
    expect(missing).toEqual([]);
  });

  it("does not allowlist a slug that isn't in the catalogue (stale entry)", () => {
    const slugs = new Set(EXERCISES.map((e) => e.slug));
    const stale = [...NO_VIDEO_ALLOWED].filter((slug) => !slugs.has(slug));
    expect(stale).toEqual([]);
  });

  it("does not have a video entry for a slug that no longer exists in the catalogue", () => {
    const slugs = new Set(EXERCISES.map((e) => e.slug));
    const orphaned = Object.keys(EXERCISE_VIDEOS).filter((slug) => !slugs.has(slug));
    expect(orphaned).toEqual([]);
  });
});
