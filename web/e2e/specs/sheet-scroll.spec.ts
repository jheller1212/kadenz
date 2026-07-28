import { test, expect } from "@playwright/test";
import { openExercisePicker } from "../helpers";

// Sheet.tsx gives the whole sheet `drag="y"` for drag-to-dismiss, and the
// exercise picker's result list is a second, nested overflow-y-auto scroller
// inside it. The worry: a fast upward swipe on the list gets captured by the
// sheet's drag recognizer and closes the sheet instead of scrolling the
// list.
//
// hasTouch is scoped to just this file (not the shared config) — turning it
// on globally made ordinary .click() retries on OTHER specs register as tiny
// drags, which triggered this app's own pull-to-refresh mid-test. A real
// swipe also needs Chromium's actual touch-input pipeline (CDP
// Input.dispatchTouchEvent), not DOM-level TouchEvent dispatch — the latter
// doesn't drive native scrolling, so it can't tell a real conflict here from
// a fake pass.
test.use({ hasTouch: true });

test("swiping the exercise list scrolls it instead of dismissing the sheet", async ({ page }) => {
  await openExercisePicker(page);

  const list = page.getByTestId("exercise-picker-results");
  await expect(list).toBeVisible();
  // The sheet slides up on a spring — let it settle before measuring, or the
  // bounding box below is stale by the time the touch sequence uses it.
  await page.waitForTimeout(500);

  const box = await list.boundingBox();
  if (!box) throw new Error("exercise picker results list has no bounding box");

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height * 0.75;
  const endY = box.y + box.height * 0.15;
  const steps = 12;

  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: startX, y: startY }],
  });
  for (let i = 1; i <= steps; i++) {
    const y = startY + ((endY - startY) * i) / steps;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: startX, y }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  // The exercise picker sheet must still be open — a real dismiss would
  // remove the results list from the DOM entirely (there are two stacked
  // dialogs at this point — the custom workout builder underneath, and the
  // exercise picker on top — so this checks the specific one, not "a dialog
  // exists somewhere").
  await expect(list).toBeVisible();

  // And the list itself must have actually scrolled, not just silently eaten
  // the gesture.
  await expect(async () => {
    const scrollTop = await list.evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
  }).toPass({ timeout: 5_000 });
});
