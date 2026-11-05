import { describe, expect, it } from "vitest";
import { formatOdds, impliedChance, oddsMeaning, requirements, explainTournament } from "./plain-english";

describe("odds as a chance (Settings: percent)", () => {
  it("American odds → the chance they imply, rounded", () => {
    expect(impliedChance(-110)).toBeCloseTo(0.5238, 4);
    expect(impliedChance(250)).toBeCloseTo(0.2857, 4);
    expect(formatOdds(-110, "percent")).toBe("52%");
    expect(formatOdds(250, "percent")).toBe("29%");
    expect(formatOdds(-10000, "percent")).toBe("99%");
    expect(formatOdds(5000, "percent")).toBe("2%");
    expect(formatOdds(100000, "percent")).toBe("<1%");
  });
  it("American stays as it was", () => {
    expect(formatOdds(-110, "american")).toBe("-110");
    expect(formatOdds(250, "american")).toBe("+250");
  });
});

describe("oddsMeaning: what a price means in dollars, for first-timers", () => {
  it("favorite and underdog", () => {
    expect(oddsMeaning(-110)).toBe("Bet $10 to win $9.09 (about a 52% chance)");
    expect(oddsMeaning(250)).toBe("Bet $10 to win $25 (about a 29% chance)");
  });
});

describe("requirements: the house rules checklist", () => {
  const rules = { allIn: true, minBets: 3, bankrollCents: 10000 };
  it("what's left to do", () => {
    expect(requirements(rules, { bets: 1, wageredCents: 4000 })).toEqual([
      { label: "Bet your whole $100", done: false, detail: "$60 left to bet" },
      { label: "Make at least 3 bets", done: false, detail: "1 of 3" },
    ]);
  });
  it("done", () => {
    expect(requirements(rules, { bets: 3, wageredCents: 10000 })).toEqual([
      { label: "Bet your whole $100", done: true, detail: "All in" },
      { label: "Make at least 3 bets", done: true, detail: "3 of 3" },
    ]);
  });
  it("no house rules: nothing to show", () => {
    expect(requirements({ allIn: false, minBets: 0, bankrollCents: 10000 }, { bets: 0, wageredCents: 0 })).toEqual([]);
    expect(requirements({ allIn: false, minBets: 1, bankrollCents: 10000 }, { bets: 0, wageredCents: 0 })).toEqual([
      { label: "Make at least 1 bet", done: false, detail: "0 of 1" },
    ]);
  });
});

describe("explainTournament: the 'what am I getting into' sheet", () => {
  const base = {
    bankrollCents: 10000,
    games: ["Knicks @ Celtics"],
    markets: ["h2h", "spreads", "totals"],
    parlays: true,
    playerProps: false,
    maxBetCents: null,
    allIn: false,
    minBets: 0,
    hostName: "Huck",
  };
  it("starts with the one-line pitch and how you win", () => {
    const s = explainTournament(base);
    expect(s[0]).toEqual({
      title: "What is this?",
      body: ["Huck invited you to a betting game on Knicks @ Celtics with fake money. Nobody pays anything."],
    });
    expect(s.map((x) => x.title)).toEqual(["What is this?", "How it works", "How you win", "The bets you can make", "Reading the odds"]);
    expect(s[2]!.body.join(" ")).toContain("Money you don't bet still counts");
  });
  it("the host reads it as their own game", () => {
    expect(explainTournament({ ...base, hostName: null })[0]!.body[0]).toBe(
      "You're hosting a betting game on Knicks @ Celtics with fake money. Nobody pays anything.",
    );
  });
  it("only explains the bets this tournament allows", () => {
    const s = explainTournament({ ...base, markets: ["h2h"], parlays: false });
    const bets = s.find((x) => x.title === "The bets you can make")!.body.join(" ");
    expect(bets).toContain("Winner");
    expect(bets).not.toContain("Spread");
    expect(bets).not.toContain("Parlay");
  });
  it("house rules get their own section, and change how you win", () => {
    const s = explainTournament({ ...base, allIn: true, minBets: 3, maxBetCents: 2500 });
    expect(s.find((x) => x.title === "House rules")!.body).toEqual([
      "Bet your whole $100 before picks lock.",
      "Make at least 3 bets.",
      "No single bet over $25.",
      "Miss a house rule and you finish below everyone who followed them.",
    ]);
    expect(s[2]!.body.join(" ")).not.toContain("Money you don't bet still counts");
  });
});
