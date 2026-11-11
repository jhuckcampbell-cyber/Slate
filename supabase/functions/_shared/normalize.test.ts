import { describe, expect, it } from "vitest";
import { normalizeOddsResponse } from "./normalize.ts";
import { fakeOddsResponse, normalCdf, probToAmerican } from "./fake-provider.ts";
import type { ApiEvent } from "./odds-api.ts";

// Shape copied from The Odds API v4 docs (GET /v4/sports/{sport}/odds?oddsFormat=american).
const fixture: ApiEvent[] = [
  {
    id: "e912304de2b2ce35b473ce2ecd3d1502",
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    commence_time: "2026-11-06T01:15:00Z",
    home_team: "Kansas City Chiefs",
    away_team: "Buffalo Bills",
    bookmakers: [
      {
        key: "fanduel",
        title: "FanDuel",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Buffalo Bills", price: 124 },
              { name: "Kansas City Chiefs", price: -146 },
            ],
          },
          {
            key: "spreads",
            outcomes: [
              { name: "Buffalo Bills", price: -108, point: 2.5 },
              { name: "Kansas City Chiefs", price: -112, point: -2.5 },
            ],
          },
        ],
      },
      {
        key: "draftkings",
        title: "DraftKings",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: "Buffalo Bills", price: 125 },
              { name: "Kansas City Chiefs", price: -148 },
            ],
          },
          {
            // Broken market (no points) → must fall back to the next book.
            key: "spreads",
            outcomes: [
              { name: "Buffalo Bills", price: -110 },
              { name: "Kansas City Chiefs", price: -110 },
            ],
          },
          {
            key: "totals",
            outcomes: [
              { name: "Over", price: -110, point: 47.5 },
              { name: "Under", price: -110, point: 47.5 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "no-odds-yet",
    sport_key: "americanfootball_nfl",
    commence_time: "2026-11-09T18:00:00Z",
    home_team: "Detroit Lions",
    away_team: "Green Bay Packers",
    bookmakers: [],
  },
];

describe("normalizeOddsResponse", () => {
  const n = normalizeOddsResponse(fixture, {
    markets: ["h2h", "spreads", "totals"],
    bookmakers: ["draftkings", "fanduel"],
  });

  it("emits every event, even ones without odds yet (catalog)", () => {
    expect(n.events.map((e) => e.id)).toEqual(["e912304de2b2ce35b473ce2ecd3d1502", "no-odds-yet"]);
    expect(n.events[1]!.sport_title).toBeNull();
  });

  it("prefers the priority book", () => {
    const ml = n.outcomes.filter((o) => o.market_key === "h2h");
    expect(ml).toEqual([
      expect.objectContaining({ outcome_name: "Buffalo Bills", price_american: 125, bookmaker: "draftkings" }),
      expect.objectContaining({ outcome_name: "Kansas City Chiefs", price_american: -148, bookmaker: "draftkings" }),
    ]);
  });

  it("falls back to the next book when the preferred market is malformed", () => {
    const spreads = n.outcomes.filter((o) => o.market_key === "spreads");
    expect(spreads.every((o) => o.bookmaker === "fanduel")).toBe(true);
    expect(spreads.map((o) => o.point)).toEqual([2.5, -2.5]);
  });

  it("records one market row per (event, market) with its source book", () => {
    expect(n.markets).toEqual([
      { event_id: "e912304de2b2ce35b473ce2ecd3d1502", market_key: "h2h", bookmaker: "draftkings", provider_updated_at: null },
      { event_id: "e912304de2b2ce35b473ce2ecd3d1502", market_key: "spreads", bookmaker: "fanduel", provider_updated_at: null },
      { event_id: "e912304de2b2ce35b473ce2ecd3d1502", market_key: "totals", bookmaker: "draftkings", provider_updated_at: null },
    ]);
  });

  it("ignores markets that were not requested", () => {
    const only = normalizeOddsResponse(fixture, { markets: ["h2h"], bookmakers: [] });
    expect(new Set(only.outcomes.map((o) => o.market_key))).toEqual(new Set(["h2h"]));
    expect(only.outcomes[0]!.bookmaker).toBe("fanduel"); // no priority → first book
  });

  it("drops markets with invalid prices instead of storing half a market", () => {
    const bad: ApiEvent[] = [
      {
        ...fixture[0]!,
        bookmakers: [
          {
            key: "draftkings",
            title: "DK",
            markets: [{ key: "h2h", outcomes: [{ name: "A", price: 50 }, { name: "B", price: -110 }] }],
          },
        ],
      },
    ];
    const r = normalizeOddsResponse(bad, { markets: ["h2h"], bookmakers: [] });
    expect(r.outcomes).toEqual([]);
    expect(r.skippedMarkets).toBe(1);
  });

  it("maps prop descriptions to participant_name", () => {
    const props: ApiEvent[] = [
      {
        ...fixture[0]!,
        bookmakers: [
          {
            key: "draftkings",
            title: "DK",
            markets: [
              {
                key: "player_pass_yds",
                outcomes: [
                  { name: "Over", description: "Patrick Mahomes", price: -115, point: 262.5 },
                  { name: "Under", description: "Patrick Mahomes", price: -105, point: 262.5 },
                ],
              },
            ],
          },
        ],
      },
    ];
    const r = normalizeOddsResponse(props, { markets: ["player_pass_yds"], bookmakers: [] });
    expect(r.outcomes.map((o) => o.participant_name)).toEqual(["Patrick Mahomes", "Patrick Mahomes"]);
  });
});

describe("fake provider", () => {
  const events = [
    {
      id: "seed-nfl-tnf",
      sport_key: "americanfootball_nfl",
      home_team: "Kansas City Chiefs",
      away_team: "Buffalo Bills",
      commence_time: "2026-11-06T01:00:00Z",
    },
  ];
  const now = Date.parse("2026-11-03T12:00:00Z");

  it("produces responses the real normalizer accepts in full", () => {
    const api = fakeOddsResponse(events, ["h2h", "spreads", "totals"], { nowMs: now });
    const n = normalizeOddsResponse(api, { markets: ["h2h", "spreads", "totals"], bookmakers: [] });
    expect(n.outcomes).toHaveLength(6);
    expect(n.skippedMarkets).toBe(0);
  });

  it("is deterministic within a time bucket and drifts across buckets", () => {
    const a = fakeOddsResponse(events, ["spreads"], { nowMs: now });
    const b = fakeOddsResponse(events, ["spreads"], { nowMs: now + 60_000 });
    expect(a).toEqual(b);
    const later = Array.from({ length: 40 }, (_, i) =>
      JSON.stringify(fakeOddsResponse(events, ["spreads", "totals"], { nowMs: now + i * 600_000 })[0]!.bookmakers),
    );
    expect(new Set(later).size).toBeGreaterThan(1);
  });

  it("keeps moneyline consistent with the spread (favorite is favored)", () => {
    const [ev] = fakeOddsResponse(events, ["h2h", "spreads"], { nowMs: now });
    const [ml, spread] = ev!.bookmakers![0]!.markets;
    const homeSpread = spread!.outcomes[1]!.point!;
    const homeMl = ml!.outcomes[1]!.price;
    if (homeSpread < 0) expect(homeMl).toBeLessThan(0);
    if (homeSpread > 0) expect(homeMl).toBeGreaterThan(0);
  });

  it("math helpers behave", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(probToAmerican(0.6)).toBe(-150);
    expect(probToAmerican(0.4)).toBe(150);
    expect(Math.abs(probToAmerican(0.5))).toBe(100);
  });
});

describe("player props", () => {
  const ev = (outcomes: ApiEvent["bookmakers"] extends (infer B)[] | undefined ? B extends { markets: (infer M)[] } ? M extends { outcomes: infer O } ? O : never : never : never): ApiEvent => ({
    id: "p1",
    sport_key: "basketball_nba",
    commence_time: "2026-11-06T00:00:00Z",
    home_team: "Boston Celtics",
    away_team: "New York Knicks",
    bookmakers: [{ key: "draftkings", title: "DK", markets: [{ key: "player_points", outcomes }] }],
  });

  it("keeps players with a complete Over/Under pair at one line", () => {
    const n = normalizeOddsResponse(
      [
        ev([
          { name: "Over", description: "Jayson Tatum", price: -115, point: 27.5 },
          { name: "Under", description: "Jayson Tatum", price: -105, point: 27.5 },
          { name: "Over", description: "Jaylen Brown", price: -110, point: 22.5 }, // no Under: dropped
          { name: "Over", description: "Jalen Brunson", price: -110, point: 25.5 },
          { name: "Under", description: "Jalen Brunson", price: -110, point: 26.5 }, // lines differ: dropped
        ]),
      ],
      { markets: ["player_points"], bookmakers: ["draftkings"] },
    );
    expect(n.outcomes.map((o) => `${o.participant_name} ${o.outcome_name}`)).toEqual([
      "Jayson Tatum Over",
      "Jayson Tatum Under",
    ]);
    expect(n.markets).toHaveLength(1);
  });

  // Shapes below are copied from a real Odds API response (TNF, 2026-11-04): alternates are an
  // Over-only ladder per player; anytime TD is one "Yes" price per player with no line.
  const nfl = (key: string, outcomes: ApiEvent["bookmakers"] extends (infer B)[] | undefined ? B extends { markets: (infer M)[] } ? M extends { outcomes: infer O } ? O : never : never : never): ApiEvent => ({
    id: "tnf",
    sport_key: "americanfootball_nfl",
    commence_time: "2026-11-06T01:15:00Z",
    home_team: "Baltimore Ravens",
    away_team: "Jacksonville Jaguars",
    bookmakers: [{ key: "draftkings", title: "DK", markets: [{ key, outcomes }] }],
  });

  it("keeps an alternate ladder: several Over lines per player, no Under needed", () => {
    const n = normalizeOddsResponse(
      [
        nfl("player_rush_yds_alternate", [
          { name: "Over", description: "Derrick Henry", price: -1840, point: 29.5 },
          { name: "Over", description: "Derrick Henry", price: -321, point: 49.5 },
          { name: "Over", description: "Derrick Henry", price: 250, point: 99.5 },
          { name: "Over", description: "Travis Etienne", price: 114, point: 64.5 },
          { name: "Over", description: "Travis Etienne", price: 400, point: 64.5 }, // same line twice: dropped
          { name: "Over", description: "Travis Etienne", price: 300 }, // no line: dropped
        ]),
      ],
      { markets: ["player_rush_yds_alternate"], bookmakers: ["draftkings"] },
    );
    expect(n.outcomes.map((o) => `${o.participant_name} ${o.outcome_name} ${o.point} ${o.price_american}`)).toEqual([
      "Derrick Henry Over 29.5 -1840",
      "Derrick Henry Over 49.5 -321",
      "Derrick Henry Over 99.5 250",
      "Travis Etienne Over 64.5 114",
    ]);
    expect(n.markets).toHaveLength(1);
  });

  it("keeps anytime-TD Yes prices without a line", () => {
    const n = normalizeOddsResponse(
      [
        nfl("player_anytime_td", [
          { name: "Yes", description: "Derrick Henry", price: 120 },
          { name: "Yes", description: "Baltimore Ravens D/ST", price: 600 },
          { name: "No", description: "Derrick Henry", price: -160 }, // only Yes is offered
        ]),
      ],
      { markets: ["player_anytime_td"], bookmakers: ["draftkings"] },
    );
    expect(n.outcomes.map((o) => `${o.participant_name} ${o.outcome_name} ${o.point}`)).toEqual([
      "Derrick Henry Yes null",
      "Baltimore Ravens D/ST Yes null",
    ]);
  });

  // Bug 2026-11 (prod): DraftKings had posted rush yards for one QB only, so the whole market showed one player.
  it("fills each player from the first book that prices them, never mixing books for one player", () => {
    const rush = (book: string, outcomes: { name: string; description: string; price: number; point: number }[]) => ({
      key: book,
      title: book,
      markets: [{ key: "player_rush_yds", outcomes }],
    });
    const n = normalizeOddsResponse(
      [
        {
          ...nfl("player_rush_yds", []),
          bookmakers: [
            rush("fanduel", [
              { name: "Over", description: "Trevor Lawrence", price: -120, point: 15.5 },
              { name: "Under", description: "Trevor Lawrence", price: -110, point: 15.5 },
              { name: "Over", description: "Derrick Henry", price: -115, point: 89.5 },
              { name: "Under", description: "Derrick Henry", price: -115, point: 89.5 },
              { name: "Over", description: "Travis Etienne", price: -110, point: 55.5 },
              { name: "Under", description: "Travis Etienne", price: -110, point: 55.5 },
            ]),
            rush("draftkings", [
              { name: "Over", description: "Trevor Lawrence", price: -105, point: 14.5 },
              { name: "Under", description: "Trevor Lawrence", price: -125, point: 14.5 },
            ]),
          ],
        },
      ],
      { markets: ["player_rush_yds"], bookmakers: ["draftkings", "fanduel"] },
    );
    expect(n.outcomes.map((o) => `${o.participant_name} ${o.outcome_name} ${o.point} ${o.bookmaker}`).sort()).toEqual([
      "Derrick Henry Over 89.5 fanduel",
      "Derrick Henry Under 89.5 fanduel",
      "Travis Etienne Over 55.5 fanduel",
      "Travis Etienne Under 55.5 fanduel",
      "Trevor Lawrence Over 14.5 draftkings", // priority book wins for a player both books price
      "Trevor Lawrence Under 14.5 draftkings",
    ]);
    expect(n.markets).toEqual([{ event_id: "tnf", market_key: "player_rush_yds", bookmaker: "fanduel", provider_updated_at: null }]);
    expect(n.skippedMarkets).toBe(0);
  });

  it("a prop without a line is unusable", () => {
    const n = normalizeOddsResponse(
      [
        ev([
          { name: "Over", description: "Jayson Tatum", price: -115 },
          { name: "Under", description: "Jayson Tatum", price: -105 },
        ]),
      ],
      { markets: ["player_points"], bookmakers: ["draftkings"] },
    );
    expect(n.outcomes).toEqual([]);
  });
});

describe("fake props", () => {
  const event = {
    id: "seed-nba-1",
    sport_key: "basketball_nba",
    home_team: "Boston Celtics",
    away_team: "New York Knicks",
    commence_time: "2026-11-06T00:00:00Z",
  };
  const props = () =>
    normalizeOddsResponse(fakeOddsResponse([event], ["player_points", "player_assists"], { nowMs: 0 }), {
      markets: ["player_points", "player_assists"],
      bookmakers: [],
    });

  it("prices complete Over/Under pairs for players on both teams", () => {
    const n = props();
    const players = new Set(n.outcomes.filter((o) => o.market_key === "player_points").map((o) => o.participant_name));
    expect(players.size).toBeGreaterThanOrEqual(4);
    expect(n.outcomes.filter((o) => o.market_key === "player_assists").length % 2).toBe(0);
    for (const o of n.outcomes) expect(o.point! % 1).toBe(0.5);
  });

  it("is deterministic", () => {
    expect(props()).toEqual(props());
  });

  it("prices football alternates, pass TDs and anytime TD the way the real API does", () => {
    const markets = ["player_pass_yds_alternate", "player_rush_yds_alternate", "player_reception_yds_alternate", "player_pass_tds", "player_anytime_td"];
    const nfl = { ...event, id: "seed-nfl-1", sport_key: "americanfootball_nfl", home_team: "Kansas City Chiefs", away_team: "Buffalo Bills" };
    const n = normalizeOddsResponse(fakeOddsResponse([nfl], markets, { nowMs: 0 }), { markets, bookmakers: [] });
    expect(new Set(n.markets.map((m) => m.market_key))).toEqual(new Set(markets));
    const ladder = n.outcomes.filter((o) => o.market_key === "player_rush_yds_alternate");
    expect(ladder.every((o) => o.outcome_name === "Over")).toBe(true);
    expect(ladder.length).toBeGreaterThan(new Set(ladder.map((o) => o.participant_name)).size); // several lines each
    const td = n.outcomes.filter((o) => o.market_key === "player_anytime_td");
    expect(td.length).toBeGreaterThanOrEqual(4);
    expect(td.every((o) => o.outcome_name === "Yes" && o.point === null)).toBe(true);
    expect(n.outcomes.filter((o) => o.market_key === "player_pass_tds").length % 2).toBe(0);
  });
});
