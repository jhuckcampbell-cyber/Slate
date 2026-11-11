import { describe, expect, it } from "vitest";
import { createSubmissionTracker } from "./submission";

describe("submission receipts", () => {
  it("reuses the UUID on retry, but changes it for accepted odds or stakes", () => {
    let sequence = 0;
    const tracker = createSubmissionTracker(() => String(++sequence));
    expect(tracker.forPayload({ odds: -110, stake: 100 })).toBe("1");
    expect(tracker.forPayload({ odds: -110, stake: 100 })).toBe("1");
    expect(tracker.forPayload({ odds: -120, stake: 100 })).toBe("2");
    expect(tracker.forPayload({ odds: -120, stake: 200 })).toBe("3");
    tracker.clear();
    expect(tracker.forPayload({ odds: -120, stake: 200 })).toBe("4");
  });
});
