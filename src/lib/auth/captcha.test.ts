import { describe, expect, it, vi } from "vitest";
import { guestCaptchaToken } from "./captcha";
import { friendlyError } from "../errors";

describe("guestCaptchaToken", () => {
  it.each([undefined, "", "  "])("skips the provider without a site key (%s)", async (key) => {
    const provider = vi.fn();
    expect(await guestCaptchaToken(key, provider)).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
  });

  it("requests a fresh token on each attempt", async () => {
    const provider = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");
    expect(await guestCaptchaToken("key", provider)).toBe("first");
    expect(await guestCaptchaToken("key", provider)).toBe("second");
  });

  it("fails closed without a provider or token", async () => {
    await expect(guestCaptchaToken("key")).rejects.toThrow("CAPTCHA_FAILED");
    await expect(guestCaptchaToken("key", async () => " ")).rejects.toThrow("CAPTCHA_FAILED");
  });

  it("gives verification failures actionable copy", async () => {
    const error = new Error("CAPTCHA_FAILED");
    await expect(guestCaptchaToken("key", async () => { throw error; })).rejects.toBe(error);
    expect(friendlyError(error)).toContain("Please try again");
  });
});
