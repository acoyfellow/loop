import { describe, expect, it } from "vitest";
import { allowedInvites, inviteRequired, verifyInvite } from "../src/lib/invite";

describe("invite gate", () => {
  it("treats sign-up as open when no env vars set", () => {
    expect(inviteRequired(undefined)).toBe(false);
    expect(inviteRequired({})).toBe(false);
    expect(verifyInvite({}, "")).toBe(true);
    expect(verifyInvite({}, null)).toBe(true);
  });

  it("accepts the single configured password", () => {
    const env = { LOOP_INVITE_PASSWORD: "pool" };
    expect(inviteRequired(env)).toBe(true);
    expect(verifyInvite(env, "pool")).toBe(true);
    expect(verifyInvite(env, "POOL")).toBe(false);
    expect(verifyInvite(env, "")).toBe(false);
    expect(verifyInvite(env, "nope")).toBe(false);
  });

  it("supports a comma-separated allowlist", () => {
    const env = { LOOP_INVITE_PASSWORDS: " one , two ,three " };
    expect(allowedInvites(env)).toEqual(["one", "two", "three"]);
    expect(verifyInvite(env, "two")).toBe(true);
    expect(verifyInvite(env, "four")).toBe(false);
  });

  it("combines single + plural without duplicating", () => {
    const env = { LOOP_INVITE_PASSWORD: "primary", LOOP_INVITE_PASSWORDS: "alt-1,alt-2" };
    expect(allowedInvites(env)).toEqual(["primary", "alt-1", "alt-2"]);
    expect(verifyInvite(env, "primary")).toBe(true);
    expect(verifyInvite(env, "alt-2")).toBe(true);
    expect(verifyInvite(env, "nope")).toBe(false);
  });
});
