// The transport split is the one place a reminder can be sent down the wrong
// wire, and the symptom would be a notification that silently never arrives.
// These cover the routing decision and the permanent/transient classification
// that decides whether a subscription row gets deleted.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { isPermanentFcmFailure } from "../fcm";

vi.mock("../fcm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../fcm")>();
  return { ...actual, sendFcmPush: vi.fn() };
});

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: vi.fn() },
}));

const payload = { title: "t", body: "b", url: "/" };

describe("isPermanentFcmFailure", () => {
  it("treats a 404 as permanently gone", () => {
    expect(isPermanentFcmFailure(404, "")).toBe(true);
  });

  it("treats UNREGISTERED as permanently gone", () => {
    expect(isPermanentFcmFailure(403, '{"error":{"status":"UNREGISTERED"}}')).toBe(true);
  });

  // The important one. INVALID_ARGUMENT is returned both for a bad token and
  // for a bad message, so a bug in the payload we send would return it for
  // every device at once. Treating it as permanent would delete every native
  // subscription in a single cron run, and getting them back needs every
  // athlete to reinstall or re-enable notifications.
  it("keeps a row on INVALID_ARGUMENT, which may be our payload not their token", () => {
    expect(isPermanentFcmFailure(400, '{"error":{"status":"INVALID_ARGUMENT"}}')).toBe(false);
  });

  it("still deletes on UNREGISTERED reported with a 400", () => {
    expect(isPermanentFcmFailure(400, '{"error":{"status":"UNREGISTERED"}}')).toBe(true);
  });

  it("keeps a row on SENDER_ID_MISMATCH, which is a config error not a dead token", () => {
    expect(isPermanentFcmFailure(403, '{"error":{"status":"SENDER_ID_MISMATCH"}}')).toBe(false);
  });

  it("keeps a quota error, so the row survives to be retried", () => {
    expect(isPermanentFcmFailure(429, "QUOTA_EXCEEDED")).toBe(false);
  });

  it("keeps a server error, so a Firebase outage never deletes subscriptions", () => {
    expect(isPermanentFcmFailure(503, "UNAVAILABLE")).toBe(false);
  });

  it("does not delete on a 403 that is not about the token", () => {
    expect(isPermanentFcmFailure(403, '{"error":{"status":"PERMISSION_DENIED"}}')).toBe(false);
  });
});

describe("sendToSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.VAPID_CONTACT_EMAIL = "test@example.com";
  });

  it("sends a native subscription over FCM with the bare token", async () => {
    const { sendFcmPush } = await import("../fcm");
    vi.mocked(sendFcmPush).mockResolvedValue({ ok: true, expired: false });
    const { sendToSubscription } = await import("../push");

    const result = await sendToSubscription(
      { transport: "fcm", endpoint: "fcm-token-abc" },
      payload
    );

    expect(sendFcmPush).toHaveBeenCalledWith("fcm-token-abc", payload);
    expect(result.ok).toBe(true);
  });

  it("sends a web subscription over web-push, not FCM", async () => {
    const { sendFcmPush } = await import("../fcm");
    const webpush = (await import("web-push")).default;
    vi.mocked(webpush.sendNotification).mockResolvedValue(
      undefined as unknown as ReturnType<typeof webpush.sendNotification> extends Promise<
        infer T
      >
        ? T
        : never
    );
    const { sendToSubscription } = await import("../push");

    const result = await sendToSubscription(
      {
        transport: "web",
        endpoint: "https://push.example/abc",
        p256dh: "key",
        auth: "auth",
      },
      payload
    );

    expect(sendFcmPush).not.toHaveBeenCalled();
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example/abc", keys: { p256dh: "key", auth: "auth" } },
      JSON.stringify(payload)
    );
    expect(result.ok).toBe(true);
  });
});
