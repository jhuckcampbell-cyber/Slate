import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
import { GET } from "./route";

describe("auth callback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    auth.verifyOtp.mockResolvedValue({ error: null });
  });
  it.each(["//evil.test", "/\\evil.test", "/%2fevil.test"])("keeps redirects local for %s", async (next) => {
    const url = new URL("https://slate.test/auth/callback");
    url.searchParams.set("code", "test-code");
    url.searchParams.set("next", next);
    expect((await GET(new NextRequest(url))).headers.get("location")).toBe("https://slate.test/account");
  });
  it("exchanges a code and follows a local path", async () => {
    const result = await GET(new NextRequest("https://slate.test/auth/callback?code=test-code&next=/t/TEST-2345"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("test-code");
    expect(result.headers.get("location")).toBe("https://slate.test/t/TEST-2345");
  });
  it("verifies an email-change token", async () => {
    await GET(new NextRequest("https://slate.test/auth/callback?token_hash=hash&type=email_change"));
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "email_change" });
  });
  it.each(["", "?error=access_denied&next=/t/TEST-2345", "?token_hash=hash&type=invalid"])("shows account error for %s", async (query) => {
    const result = await GET(new NextRequest(`https://slate.test/auth/callback${query}`));
    expect(result.headers.get("location")).toBe("https://slate.test/account?auth_error=1");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });
  it("handles expired codes and connection failures", async () => {
    auth.exchangeCodeForSession.mockResolvedValueOnce({ error: new Error("expired") });
    auth.exchangeCodeForSession.mockRejectedValueOnce(new Error("offline"));
    for (let i = 0; i < 2; i++) {
      const result = await GET(new NextRequest("https://slate.test/auth/callback?code=bad&next=/t/TEST-2345"));
      expect(result.headers.get("location")).toBe("https://slate.test/account?auth_error=1");
    }
  });
});
