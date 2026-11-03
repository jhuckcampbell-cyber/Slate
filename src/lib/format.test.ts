import { describe, expect, it } from "vitest";
import { formatCheckedAgo } from "./format";

describe("formatCheckedAgo", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("says just now under a minute", () => {
    expect(formatCheckedAgo(ago(30_000), now)).toBe("just now");
    expect(formatCheckedAgo(ago(-5_000), now)).toBe("just now"); // small clock skew
  });

  it("counts whole minutes under an hour", () => {
    expect(formatCheckedAgo(ago(60_000), now)).toBe("1 min ago");
    expect(formatCheckedAgo(ago(59 * 60_000 + 59_000), now)).toBe("59 min ago");
  });

  it("counts whole hours after that", () => {
    expect(formatCheckedAgo(ago(60 * 60_000), now)).toBe("1 hr ago");
    expect(formatCheckedAgo(ago(11 * 60 * 60_000 + 59 * 60_000), now)).toBe("11 hr ago");
  });
});
