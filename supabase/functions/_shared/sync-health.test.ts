import { describe, expect, it } from "vitest";
import { normalizeOddsResponse, oldestTimestamp } from "./normalize";
import { normalizeScores } from "./scores";
import type { ApiEvent } from "./odds-api";

const event: ApiEvent = { id: "sync", sport_key: "basketball_nba", home_team: "Home", away_team: "Away",
  commence_time: "2030-01-01T00:00:00Z", bookmakers: [] };

describe("sync snapshot metadata", () => {
  it("carries empty snapshots for every requested prop shape", () => {
    const markets = ["player_points", "player_points_alternate", "player_anytime_td"];
    const n = normalizeOddsResponse([event], { markets, bookmakers: [] });
    expect(n.outcomes).toEqual([]);
    expect(n.markets.map((m) => m.market_key)).toEqual(markets);
  });
  it("uses the oldest contributing book timestamp and ignores invalid timestamps", () => {
    expect(oldestTimestamp([undefined, "bad", "2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z"]))
      .toBe("2026-01-01T00:00:00Z");
    const n = normalizeOddsResponse([{ ...event, bookmakers: [{ key: "book", title: "Book",
      last_update: "2026-01-01T00:00:00Z", markets: [{ key: "player_points", outcomes: [
        { name: "Over", description: "Player", point: 20.5, price: -110 },
        { name: "Under", description: "Player", point: 20.5, price: -110 },
      ] }] }] }], { markets: ["player_points"], bookmakers: [] });
    expect(n.markets[0].provider_updated_at).toBe("2026-01-01T00:00:00Z");
    expect(n.outcomes.every((o) => o.provider_updated_at === "2026-01-01T00:00:00Z")).toBe(true);
  });
  it("preserves provider score timestamps", () => {
    expect(normalizeScores([{ ...event, completed: false, last_update: "2026-01-01T00:00:00Z",
      scores: [{ name: "Home", score: "10" }, { name: "Away", score: "9" }] }])[0].provider_updated_at)
      .toBe("2026-01-01T00:00:00Z");
  });
});
