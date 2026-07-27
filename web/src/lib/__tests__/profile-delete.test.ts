import { describe, expect, it } from "vitest";
import { evaluateProfileDelete } from "../profile-delete";

const alice = { id: "profile-1", name: "Alice", active: true };

describe("evaluateProfileDelete", () => {
  it("refuses a delete without a confirmation token (empty confirmName)", () => {
    const result = evaluateProfileDelete(alice, "", null);
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "Confirmation name does not match",
    });
  });

  it("refuses a delete with the wrong confirmation token", () => {
    const result = evaluateProfileDelete(alice, "Bob", null);
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: "Confirmation name does not match",
    });
  });

  it("succeeds with the correct confirmation token", () => {
    const result = evaluateProfileDelete(alice, "Alice", null);
    expect(result).toEqual({ ok: true });
  });

  it("refuses a delete for a profile that no longer exists", () => {
    const result = evaluateProfileDelete(undefined, "Alice", null);
    expect(result).toEqual({ ok: false, status: 404, error: "Profile not found" });
  });

  it("refuses a delete for a profile already soft-deleted", () => {
    const result = evaluateProfileDelete({ ...alice, active: false }, "Alice", null);
    expect(result).toEqual({ ok: false, status: 404, error: "Profile not found" });
  });

  it("refuses removing the caller's own currently-selected profile", () => {
    const result = evaluateProfileDelete(alice, "Alice", "profile-1");
    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Switch away from this profile before removing it",
    });
  });

  // No "last remaining profile" guard exists by design: the owner has no row
  // in `profiles`, so removing the only guest profile still leaves a working
  // app (just Owner) — this documents that this case is allowed on purpose.
  it("allows removing the sole guest profile (owner remains as fallback)", () => {
    const result = evaluateProfileDelete(alice, "Alice", null);
    expect(result).toEqual({ ok: true });
  });
});
