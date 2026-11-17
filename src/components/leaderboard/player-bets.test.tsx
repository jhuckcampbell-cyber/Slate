import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerBets } from "./player-bets";

const event = { id: "g1", sport_key: "americanfootball_nfl", home_team: "Baltimore Ravens", away_team: "Los Angeles Chargers", commence_time: "2026-11-17T01:15:00Z" };
const leg = (o: Record<string, unknown>) => ({
  eventId: "g1", marketKey: "player_pass_yds", selection: "Over", participantName: "Justin Herbert", participantTeam: "Los Angeles Chargers",
  line: 201.5, oddsAmerican: -112, status: "pending", winProbability: 0.31, liveStat: 58, ...o,
});
const wager = (legs: Record<string, unknown>[]) => ({
  id: "w1", participantId: "p1", wagerType: legs.length > 1 ? "parlay" : "single", amountCents: 2500, oddsAmerican: -112,
  potentialPayoutCents: 4732, status: "pending", payoutCents: null, winProbability: 0.31, legs: legs.map(leg),
});
const render = (legs: Record<string, unknown>[]) => renderToStaticMarkup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <PlayerBets player={{ holdingCents: 0 } as any} wagers={[wager(legs)] as any} events={[event] as any} live={{}} />,
);

describe("PlayerBets live prop meter", () => {
  it("shows the live stat against the line with the chance on top", () => {
    const html = render([{}]);
    expect(html).toContain('aria-label="Live stat: 58 of 201.5 Pass Yds"');
    expect(html).toContain("/ 201.5 Pass Yds");
    expect(html).toContain('aria-label="Chance to win 31%"');
    expect(html).toContain("needs 144 more");
    expect(html).toContain("width:29%"); // 58 / 201.5
    expect(html.indexOf("Chance to win 31%")).toBeLessThan(html.indexOf("width:29%")); // % above the bar
  });
  it("waits for the box score, and keeps the plain chance bar for anytime TD", () => {
    expect(render([{ liveStat: null }])).toContain("Waiting for his first stat");
    expect(render([{ marketKey: "player_anytime_td", selection: "Yes", line: null, liveStat: 0 }])).toContain("No TD yet");
  });
});
