/**
 * Words for people who have never bet: odds as a chance, what a price pays, the house-rules checklist, and the
 * "what am I getting into" sheet behind every tournament title. Pure (no React), unit-tested.
 */
import { formatCents } from "./format";

export type OddsFormat = "american" | "percent";

/** The chance a price implies (vig included): -110 → 0.524, +250 → 0.286. */
export function impliedChance(american: number): number {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

export function formatOdds(american: number, format: OddsFormat): string {
  if (format === "american") return american > 0 ? `+${american}` : String(american);
  const pct = Math.round(impliedChance(american) * 100);
  if (pct < 1) return "<1%";
  return `${Math.min(99, pct)}%`;
}

/** "Bet $10 to win $9.09 (about a 52% chance)". */
export function oddsMeaning(american: number): string {
  const profitCents = Math.round(american > 0 ? 10 * american : (1000 * 100) / -american);
  return `Bet $10 to win ${formatCents(profitCents)} (about a ${formatOdds(american, "percent")} chance)`;
}

export type HouseRules = { allIn: boolean; minBets: number; bankrollCents: number };
export type Requirement = { label: string; done: boolean; detail: string };

/** What a player still has to do to count (mirrors leaderboard.qualified). */
export function requirements(rules: HouseRules, mine: { bets: number; wageredCents: number }): Requirement[] {
  const out: Requirement[] = [];
  if (rules.allIn) {
    const left = Math.max(0, rules.bankrollCents - mine.wageredCents);
    out.push({
      label: `Bet your whole ${formatCents(rules.bankrollCents)}`,
      done: left === 0,
      detail: left === 0 ? "All in" : `${formatCents(left)} left to bet`,
    });
  }
  if (rules.minBets > 0) {
    out.push({
      label: `Make at least ${rules.minBets} ${rules.minBets === 1 ? "bet" : "bets"}`,
      done: mine.bets >= rules.minBets,
      detail: `${Math.min(mine.bets, rules.minBets)} of ${rules.minBets}`,
    });
  }
  return out;
}

export type ExplainInput = {
  bankrollCents: number;
  games: string[];
  markets: string[];
  parlays: boolean;
  playerProps: boolean;
  maxBetCents: number | null;
  allIn: boolean;
  minBets: number;
  /** null when the viewer IS the host. */
  hostName: string | null;
};

export type ExplainSection = { title: string; body: string[] };

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function explainTournament(t: ExplainInput): ExplainSection[] {
  const bankroll = formatCents(t.bankrollCents);
  const sections: ExplainSection[] = [
    {
      title: "What is this?",
      body: [
        `${t.hostName === null ? "You're hosting" : `${t.hostName} invited you to`} a betting game on ${list(t.games)} with fake money. Nobody pays anything.`,
      ],
    },
    {
      title: "How it works",
      body: [
        `Everyone starts with ${bankroll} of play money.`,
        "Before the game starts, make your picks: who wins, by how much, and more. Bet as much or as little as you like on each.",
        "Your picks are secret. When the game starts they lock and everyone's picks are revealed at once.",
        "Then watch the game together: the leaderboard updates live as plays happen.",
      ],
    },
    {
      title: "How you win",
      body: [
        "A winning bet pays you back your bet plus winnings. A losing bet is gone.",
        "When the games end, whoever has the most money wins.",
        ...(t.allIn ? [] : ["Money you don't bet still counts, so playing it safe is a strategy too."]),
      ],
    },
  ];

  const rules = [
    ...(t.allIn ? [`Bet your whole ${bankroll} before picks lock.`] : []),
    ...(t.minBets > 0 ? [`Make at least ${t.minBets} ${t.minBets === 1 ? "bet" : "bets"}.`] : []),
    ...(t.maxBetCents ? [`No single bet over ${formatCents(t.maxBetCents)}.`] : []),
  ];
  if (rules.length > 0) {
    sections.push({
      title: "House rules",
      body: [
        ...rules,
        ...(t.allIn || t.minBets > 0 ? ["Miss a house rule and you finish below everyone who followed them."] : []),
      ],
    });
  }

  const bets: string[] = [];
  if (t.markets.includes("h2h")) bets.push("Winner: pick who wins the game.");
  if (t.markets.includes("spreads"))
    bets.push("Spread: a head start to make it fair. \"Celtics -7\" wins only if the Celtics win by more than 7; \"Knicks +7\" wins if the Knicks win or lose by less than 7.");
  if (t.markets.includes("totals"))
    bets.push("Total: will both teams combined score Over or Under the number?");
  if (t.playerProps) bets.push("Player props: will a player go Over or Under a stat, like 25.5 points?");
  if (t.parlays)
    bets.push("Parlay: put several picks on one ticket. Every pick has to win, but it pays a lot more.");
  sections.push({ title: "The bets you can make", body: bets });

  sections.push({
    title: "Reading the odds",
    body: [
      "Each pick shows its price. A minus number is the favorite: -150 means bet $15 to win $10.",
      "A plus number is the underdog: +200 means bet $10 to win $20. Riskier picks pay more.",
      "Prefer chances? Turn on \"Odds as %\" in Settings to see each pick's chance of winning instead.",
    ],
  });
  return sections;
}

/** What the % next to a live pick means (the (i) in the leaderboard dropdown). */
export function chanceExplainer(pct: string, parlay: boolean): { title: string; body: string } {
  const n = Number.parseInt(pct.replace(/[^0-9]/g, ""), 10);
  const outOf10 = Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n / 10))) : null;
  const odds = outOf10 === null ? "" : ` ${pct} means picks like this win about ${outOf10} out of 10 times.`;
  return parlay
    ? {
        title: `Chance to win: ${pct}`,
        body: `How likely this whole parlay is to cash from here. Every leg has to hit, so it's each leg's chance multiplied together.${odds}`,
      }
    : {
        title: `Chance to win: ${pct}`,
        body: `How likely this pick is to win from here, based on the score and the time left.${odds}`,
      };
}
