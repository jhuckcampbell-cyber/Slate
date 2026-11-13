import { describe, expect, it } from "vitest";
import { eventStatus } from "./event-status.ts";
import { normalizeScores, type ApiScoreEvent } from "./scores.ts";
import { normalizeOddsResponse } from "./normalize.ts";
import { liveGamesFromScoreboard } from "./live.ts";

describe("explicit event status evidence", () => {
  it.each(["Canceled", "Cancelled", "Postponed", "Suspended", "Delayed"])("parses %s without scores", (status) => {
    const expected = status.startsWith("Cancel") ? "canceled" : status.toLowerCase();
    const game = { id: "g", sport_key: "basketball_nba", home_team: "Home", away_team: "Away", commence_time: "2026-11-11T00:00:00Z", completed: false, scores: null, last_update: null, status } satisfies ApiScoreEvent;
    expect(normalizeScores([game])[0]).toMatchObject({ status: expected, status_reason: status, home_score: null });
    expect(normalizeOddsResponse([game], { markets: [], bookmakers: [] }).events[0]).toMatchObject({ status: expected });
  });
  it("missing feeds never imply a status", () => {
    expect(eventStatus(undefined)).toBeNull();
    expect(normalizeScores([])).toEqual([]);
    expect(eventStatus("STATUS_FINAL")).toBeNull();
  });
  it("preserves ESPN status and the actual overtime clock", () => {
    const games = liveGamesFromScoreboard({ events: [{ competitions: [{
      status: { period: 5, clock: 180, type: { state: "in", name: "STATUS_SUSPENDED" } },
      competitors: [{ homeAway: "home", team: { displayName: "Home" }, score: "100" }, { homeAway: "away", team: { displayName: "Away" }, score: "100" }],
    }] }] }, [{ event_id: "g", home_team: "Home", away_team: "Away" }]);
    expect(games[0]).toMatchObject({ status: "suspended", status_reason: "STATUS_SUSPENDED", clock_seconds: 180, period: 5 });
  });
});
