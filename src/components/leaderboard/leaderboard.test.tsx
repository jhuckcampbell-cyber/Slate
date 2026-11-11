import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Leaderboard, type LeaderRow } from "./leaderboard";

const row = (name: string, standing: LeaderRow["standing"]): LeaderRow => ({
  participantId: name, name, standing, isYou: false,
  cashCents: 10000, evCents: 10000, maxCents: 10000, rank: 1,
});

describe("final winner banner", () => {
  it("does not crown anyone when every player is disqualified, even with old rank-one data", () => {
    const html = renderToStaticMarkup(<Leaderboard settled rows={[row("Ann", "disqualified"), row("Ben", "disqualified")]} />);
    expect(html).not.toContain("lucide-trophy");
    expect(html).toContain("Final standings");
  });
  it("still crowns a qualified first-place player", () => {
    const html = renderToStaticMarkup(<Leaderboard settled rows={[row("Ann", "alive")]} />);
    expect(html).toContain("lucide-trophy");
  });
});
