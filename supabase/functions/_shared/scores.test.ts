import { describe, expect, it } from "vitest";
import { fakeScoresResponse, normalizeScores, type ApiScoreEvent } from "./scores.ts";

// Shape from The Odds API v4 docs: GET /v4/sports/{sport}/scores?daysFrom=1
const fixture: ApiScoreEvent[] = [
  {
    id: "g-final",
    sport_key: "basketball_nba",
    commence_time: "2026-11-03T00:00:00Z",
    completed: true,
    home_team: "Boston Celtics",
    away_team: "New York Knicks",
    scores: [
      { name: "New York Knicks", score: "104" },
      { name: "Boston Celtics", score: "111" },
    ],
    last_update: "2026-11-03T02:40:00Z",
  },
  {
    id: "g-live",
    sport_key: "basketball_nba",
    commence_time: "2026-11-03T01:00:00Z",
    completed: false,
    home_team: "Denver Nuggets",
    away_team: "Los Angeles Lakers",
    scores: [
      { name: "Denver Nuggets", score: "55" },
      { name: "Los Angeles Lakers", score: "61" },
    ],
    last_update: "2026-11-03T02:00:00Z",
  },
  {
    id: "g-upcoming",
    sport_key: "basketball_nba",
    commence_time: "2026-11-04T00:00:00Z",
    completed: false,
    home_team: "Miami Heat",
    away_team: "Chicago Bulls",
    scores: null,
    last_update: null,
  },
];

describe("normalizeScores", () => {
  it("maps team scores to home/away by name, whatever order they come in", () => {
    expect(normalizeScores(fixture)).toEqual([
      { event_id: "g-final", completed: true, home_score: 111, away_score: 104, provider_updated_at: "2026-11-03T02:40:00Z" },
      { event_id: "g-live", completed: false, home_score: 55, away_score: 61, provider_updated_at: "2026-11-03T02:00:00Z" },
    ]);
  });

  it("skips games without scores, and garbage scores", () => {
    const bad: ApiScoreEvent = {
      ...fixture[1]!,
      id: "g-bad",
      scores: [
        { name: "Denver Nuggets", score: "x" },
        { name: "Los Angeles Lakers", score: "61" },
      ],
    };
    const unknownTeam: ApiScoreEvent = { ...fixture[1]!, id: "g-team", scores: [{ name: "Someone", score: "1" }] };
    expect(normalizeScores([bad, unknownTeam, fixture[2]!])).toEqual([]);
  });

  it("can restrict to the games we track", () => {
    expect(normalizeScores(fixture, ["g-live"]).map((s) => s.event_id)).toEqual(["g-live"]);
  });
});

describe("fakeScoresResponse", () => {
  const event = {
    id: "seed-nba-1",
    sport_key: "basketball_nba",
    home_team: "Boston Celtics",
    away_team: "New York Knicks",
    commence_time: "2026-11-03T00:00:00Z",
  };
  const at = (minutes: number) => Date.parse(event.commence_time) + minutes * 60_000;

  it("has no score before tip-off", () => {
    expect(normalizeScores(fakeScoresResponse([event], { nowMs: at(-5) }))).toEqual([]);
  });

  it("is live mid-game with scores that only go up", () => {
    const half = normalizeScores(fakeScoresResponse([event], { nowMs: at(75) }))[0]!;
    const later = normalizeScores(fakeScoresResponse([event], { nowMs: at(120) }))[0]!;
    expect(half.completed).toBe(false);
    expect(later.home_score).toBeGreaterThanOrEqual(half.home_score);
    expect(later.away_score).toBeGreaterThanOrEqual(half.away_score);
  });

  it("finishes after the sport's game length with a decisive, realistic score", () => {
    const final = normalizeScores(fakeScoresResponse([event], { nowMs: at(151) }))[0]!;
    expect(final.completed).toBe(true);
    expect(final.home_score).not.toBe(final.away_score);
    expect(final.home_score + final.away_score).toBeGreaterThan(150);
  });

  it("is deterministic", () => {
    expect(fakeScoresResponse([event], { nowMs: at(90) })).toEqual(fakeScoresResponse([event], { nowMs: at(90) }));
  });
});
