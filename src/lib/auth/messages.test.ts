import { describe, expect, it } from "vitest";
import { friendlyAuthError, normalizeEmail } from "./messages";

describe("sign-in messages", () => {
  it("cleans up emails typed on phones", () => {
    expect(normalizeEmail("  Jane.Doe@Example.com ")).toBe("jane.doe@example.com");
  });
  it("explains Supabase errors in plain words", () => {
    expect(friendlyAuthError("Invalid login credentials")).toMatch(/don't match/);
    expect(friendlyAuthError("email rate limit exceeded")).toMatch(/Too many emails/);
    expect(friendlyAuthError("For security purposes, you can only request this after 42 seconds.")).toMatch(/Too many/);
    expect(friendlyAuthError("Token has expired or is invalid")).toMatch(/expired/);
    expect(friendlyAuthError("Signups not allowed for otp")).toMatch(/no account/);
    expect(friendlyAuthError("Something new")).toBe("Something new");
  });
});
