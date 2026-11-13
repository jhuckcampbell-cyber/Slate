import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect";

describe("auth redirects", () => {
  it.each([null, "", "https://evil.test", "//evil.test", "/\\evil.test", "/%5cevil.test", "/%2fevil.test", "/%252fevil.test", "/\nevil.test", "/%0aevil.test", "/%", "/a/..//evil.test"])("rejects %s", (path) => {
    expect(safeNext(path)).toBe("/account");
  });
  it.each(["/account", "/t/ABC-2345", "/account?tab=name#profile"])("keeps %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });
});
