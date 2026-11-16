import { describe, expect, it } from "vitest";
import {
  chanceExplainer,
  explainTournament,
  formatNet,
  formatOdds,
  impliedChance,
  oddsMeaning,
  requirements,
  resultText,
  tenDollarWins,
  whosIn,
} from "./plain-english";

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
    expect(bets).toContain("Moneyline");
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

describe("chanceExplainer: the (i) next to a live pick's %", () => {
  it("says what the number means in plain words", () => {
    const e = chanceExplainer("81%", false);
    expect(e.title).toBe("Chance to win: 81%");
    expect(e.body).toContain("about 8 out of 10 times");
  });
  it("parlays say every leg has to hit", () => {
    expect(chanceExplainer("27%", true).body).toContain("Every leg has to hit");
  });
});

describe("quick wins: invite, payout line, final result", () => {
  it("names only the host on the invite preview", () => {
    expect(whosIn("Huck", 1)).toBe("Huck is in");
    expect(whosIn("Huck", 2)).toBe("Huck + 1 other is in");
    expect(whosIn("Huck", 5)).toBe("Huck + 4 others are in");
    expect(whosIn("Huck", 0)).toBe("Huck is in");
  });

  it("says what a $10 bet wins with the slip's floor rounding", () => {
    expect(tenDollarWins(130)).toBe("wins $13");
    expect(tenDollarWins(-150)).toBe("wins $6.66"); // floor(1000 × 1.6667) = 1666
    expect(tenDollarWins(-110)).toBe("wins $9.09");
    expect(tenDollarWins(1200)).toBe("wins $120");
  });

  it("formats net up, down and even", () => {
    expect(formatNet(8400)).toBe("+$84");
    expect(formatNet(-8050)).toBe("−$80.50");
    expect(formatNet(0)).toBe("even");
  });

  it("builds a spoiler-free result: place, net, one square per bet, link", () => {
    expect(
      resultText({
        title: "Tuesday Night Hoops",
        rank: 2,
        players: 5,
        netCents: 8400,
        bets: ["won", "won", "lost", "void"],
        url: "https://slate.app/t/K7QX",
      }),
    ).toBe("slate / Tuesday Night Hoops\n2nd of 5 · +$84\n🟩🟩🟥⬜\nhttps://slate.app/t/K7QX");
    // No bets: no empty squares line.
    expect(resultText({ title: "T", rank: 1, players: 2, netCents: 0, bets: [], url: "u" })).toBe("slate / T\n1st of 2 · even\nu");
  });
});
