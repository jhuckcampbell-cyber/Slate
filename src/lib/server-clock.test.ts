import { describe, expect, it } from "vitest";
import { createServerClock } from "./server-clock";

describe("createServerClock", () => {
  it("follows the DB clock even when the phone's clock is 2 minutes fast", () => {
    let device = Date.parse("2026-11-03T18:02:00Z"); // phone thinks it's 18:02
    const now = createServerClock("2026-11-03T18:00:00Z", () => device); // DB says 18:00
    device += 10_000;
    expect(new Date(now()).toISOString()).toBe("2026-11-03T18:00:10.000Z");
  });

  it("follows the DB clock when the phone is behind", () => {
    let device = Date.parse("2026-11-03T17:59:00Z");
    const now = createServerClock("2026-11-03T18:00:00Z", () => device);
    device += 1_500;
    expect(new Date(now()).toISOString()).toBe("2026-11-03T18:00:01.500Z");
  });
});
