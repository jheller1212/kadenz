// Pure classification rules for outbox failures — no DB, no network. These
// are the rules drainGCalOutboxForUser (sync-manager.ts) uses to decide
// "retry this" vs "this can never succeed, stop and disconnect".

import { describe, it, expect } from "vitest";
import { isMootFailure, isPermanentGCalFailure, isRevokedGCalGrant } from "../outbox-claims";

describe("isRevokedGCalGrant", () => {
  it("is true for Google's invalid_grant response", () => {
    expect(isRevokedGCalGrant("invalid_grant")).toBe(true);
    expect(isRevokedGCalGrant("Error: invalid_grant: Token has been expired or revoked.")).toBe(
      true
    );
    // Case-insensitive: the exact casing of an upstream error message isn't
    // something this code controls.
    expect(isRevokedGCalGrant("INVALID_GRANT")).toBe(true);
  });

  it("is false for a timeout or a 5xx — those ARE worth retrying", () => {
    expect(isRevokedGCalGrant("The operation was aborted due to timeout")).toBe(false);
    expect(isRevokedGCalGrant("Internal Server Error")).toBe(false);
    expect(isRevokedGCalGrant("503 Service Unavailable")).toBe(false);
  });

  it("is false for a missing OAuth client config — that's a different, non-user fix", () => {
    expect(
      isRevokedGCalGrant("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set")
    ).toBe(false);
  });
});

describe("isPermanentGCalFailure", () => {
  it("is true for a revoked grant", () => {
    expect(isPermanentGCalFailure("invalid_grant")).toBe(true);
  });

  it("is true for a missing OAuth client configuration", () => {
    expect(
      isPermanentGCalFailure("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set")
    ).toBe(true);
  });

  it("is false for transient failures — a timeout or a 5xx still retries", () => {
    expect(isPermanentGCalFailure("The operation was aborted due to timeout")).toBe(false);
    expect(isPermanentGCalFailure("502 Bad Gateway")).toBe(false);
    expect(isPermanentGCalFailure("ECONNRESET")).toBe(false);
  });

  it("does not overlap with isMootFailure's vanished-entity cases", () => {
    // "Not Found" / deleted-event failures are settled outcomes, not auth
    // failures — they take the isMootFailure path (drop, don't disconnect).
    expect(isPermanentGCalFailure("Not Found")).toBe(false);
    expect(isMootFailure("Not Found")).toBe(true);
  });
});
