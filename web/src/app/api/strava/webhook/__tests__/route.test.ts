// The subscription-id check is the webhook's only defense: Strava doesn't
// sign these events, so anyone who finds the URL can POST to it. This
// confirms a foreign subscription id is still rejected, and that a genuine
// event is routed to the right handler per aspect_type without ever routing
// to "create" for an "update"/"delete" (which would silently reintroduce the
// original bug: only create ever ran).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const processActivity = vi.fn().mockResolvedValue("stored");
const updateActivity = vi.fn().mockResolvedValue("updated");
const deleteStravaActivity = vi.fn().mockResolvedValue("trashed");
const loadSubscription = vi.fn();
const findUserByProviderAccount = vi.fn();

vi.mock("@/lib/sync/strava-client", () => ({
  processActivity,
  updateActivity,
  deleteStravaActivity,
  loadSubscription,
}));
vi.mock("@/lib/sync/credentials", () => ({ findUserByProviderAccount }));

const { POST } = await import("../route");

const OWNER_ID = 1;
const OWNER_USER = "11111111-1111-4111-8111-111111111111";

function fakeRequest(body: unknown): NextRequest {
  return { text: async () => JSON.stringify(body) } as unknown as NextRequest;
}

// Handlers run fire-and-forget (not awaited by POST) so the response can
// return within Strava's 2s window — give the microtask queue a tick to let
// them fire before asserting on the spies.
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  processActivity.mockClear();
  updateActivity.mockClear();
  deleteStravaActivity.mockClear();
  loadSubscription.mockReset();
  loadSubscription.mockResolvedValue({ subscription_id: 42, callback_url: "https://kadenz.example/api/strava/webhook" });
  findUserByProviderAccount.mockReset();
  findUserByProviderAccount.mockResolvedValue(OWNER_USER);
});

describe("POST /api/strava/webhook", () => {
  it("rejects an event with a foreign subscription id", async () => {
    const res = await POST(
      fakeRequest({
        object_type: "activity",
        object_id: 1,
        aspect_type: "create",
        owner_id: OWNER_ID,
        subscription_id: 999, // not the registered one
        event_time: 0,
      })
    );
    expect(res.status).toBe(403);
    await flush();
    expect(processActivity).not.toHaveBeenCalled();
  });

  it("routes aspect_type=create to processActivity only", async () => {
    await POST(
      fakeRequest({
        object_type: "activity",
        object_id: 555,
        aspect_type: "create",
        owner_id: OWNER_ID,
        subscription_id: 42,
        event_time: 0,
      })
    );
    await flush();
    expect(processActivity).toHaveBeenCalledWith(OWNER_USER, 555);
    expect(updateActivity).not.toHaveBeenCalled();
    expect(deleteStravaActivity).not.toHaveBeenCalled();
  });

  it("routes aspect_type=update to updateActivity, not processActivity", async () => {
    await POST(
      fakeRequest({
        object_type: "activity",
        object_id: 555,
        aspect_type: "update",
        owner_id: OWNER_ID,
        subscription_id: 42,
        event_time: 0,
      })
    );
    await flush();
    expect(updateActivity).toHaveBeenCalledWith(OWNER_USER, 555);
    expect(processActivity).not.toHaveBeenCalled();
  });

  it("routes aspect_type=delete to deleteStravaActivity, not processActivity", async () => {
    await POST(
      fakeRequest({
        object_type: "activity",
        object_id: 555,
        aspect_type: "delete",
        owner_id: OWNER_ID,
        subscription_id: 42,
        event_time: 0,
      })
    );
    await flush();
    expect(deleteStravaActivity).toHaveBeenCalledWith(OWNER_USER, 555);
    expect(processActivity).not.toHaveBeenCalled();
  });

  it("ignores an event for an athlete nobody has connected, touching nothing", async () => {
    findUserByProviderAccount.mockResolvedValue(null);
    const res = await POST(
      fakeRequest({
        object_type: "activity",
        object_id: 555,
        aspect_type: "create",
        owner_id: 999999,
        subscription_id: 42,
        event_time: 0,
      })
    );
    await flush();
    expect(res.status).toBe(200);
    expect(processActivity).not.toHaveBeenCalled();
    expect(updateActivity).not.toHaveBeenCalled();
    expect(deleteStravaActivity).not.toHaveBeenCalled();
  });

  it("always replies 200 to Strava, even for a known event type", async () => {
    const res = await POST(
      fakeRequest({
        object_type: "activity",
        object_id: 555,
        aspect_type: "update",
        owner_id: OWNER_ID,
        subscription_id: 42,
        event_time: 0,
      })
    );
    expect(res.status).toBe(200);
  });
});
