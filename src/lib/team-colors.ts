/**
 * Team colors for the little helmet/jersey next to players and teams, so it's obvious who plays for whom.
 * Colors only (no logos: those are trademarks). Keys are the Odds API's full team names. Pure, unit-tested.
 * Team colors are data, not design tokens: the badge applies them inline (an intended exception to DESIGN.md).
 */

type Gear = "helmet" | "jersey";
export type TeamLook = { kind: Gear; primary: string; secondary: string };

const NFL: Record<string, [string, string]> = {
  "Arizona Cardinals": ["#97233F", "#FFB612"],
  "Atlanta Falcons": ["#A71930", "#000000"],
  "Baltimore Ravens": ["#241773", "#9E7C0C"],
  "Buffalo Bills": ["#00338D", "#C60C30"],
  "Carolina Panthers": ["#0085CA", "#101820"],
  "Chicago Bears": ["#0B162A", "#C83803"],
  "Cincinnati Bengals": ["#FB4F14", "#000000"],
  "Cleveland Browns": ["#311D00", "#FF3C00"],
  "Dallas Cowboys": ["#003594", "#869397"],
  "Denver Broncos": ["#FB4F14", "#002244"],
  "Detroit Lions": ["#0076B6", "#B0B7BC"],
  "Green Bay Packers": ["#203731", "#FFB612"],
  "Houston Texans": ["#03202F", "#A71930"],
  "Indianapolis Colts": ["#002C5F", "#A2AAAD"],
  "Jacksonville Jaguars": ["#006778", "#D7A22A"],
  "Kansas City Chiefs": ["#E31837", "#FFB81C"],
  "Las Vegas Raiders": ["#000000", "#A5ACAF"],
  "Los Angeles Chargers": ["#0080C6", "#FFC20E"],
  "Los Angeles Rams": ["#003594", "#FFA300"],
  "Miami Dolphins": ["#008E97", "#FC4C02"],
  "Minnesota Vikings": ["#4F2683", "#FFC62F"],
  "New England Patriots": ["#002244", "#C60C30"],
  "New Orleans Saints": ["#D3BC8D", "#101820"],
  "New York Giants": ["#0B2265", "#A71930"],
  "New York Jets": ["#125740", "#FFFFFF"],
  "Philadelphia Eagles": ["#004C54", "#A5ACAF"],
  "Pittsburgh Steelers": ["#FFB612", "#101820"],
  "San Francisco 49ers": ["#AA0000", "#B3995D"],
  "Seattle Seahawks": ["#002244", "#69BE28"],
  "Tampa Bay Buccaneers": ["#D50A0A", "#34302B"],
  "Tennessee Titans": ["#0C2340", "#4B92DB"],
  "Washington Commanders": ["#5A1414", "#FFB612"],
};

const NBA: Record<string, [string, string]> = {
  "Atlanta Hawks": ["#E03A3E", "#C1D32F"],
  "Boston Celtics": ["#007A33", "#BA9653"],
  "Brooklyn Nets": ["#000000", "#FFFFFF"],
  "Charlotte Hornets": ["#1D1160", "#00788C"],
  "Chicago Bulls": ["#CE1141", "#000000"],
  "Cleveland Cavaliers": ["#860038", "#FDBB30"],
  "Dallas Mavericks": ["#00538C", "#B8C4CA"],
  "Denver Nuggets": ["#0E2240", "#FEC524"],
  "Detroit Pistons": ["#C8102E", "#1D42BA"],
  "Golden State Warriors": ["#1D428A", "#FFC72C"],
  "Houston Rockets": ["#CE1141", "#000000"],
  "Indiana Pacers": ["#002D62", "#FDBB30"],
  "Los Angeles Clippers": ["#C8102E", "#1D428A"],
  "Los Angeles Lakers": ["#552583", "#FDB927"],
  "Memphis Grizzlies": ["#5D76A9", "#12173F"],
  "Miami Heat": ["#98002E", "#F9A01B"],
  "Milwaukee Bucks": ["#00471B", "#EEE1C6"],
  "Minnesota Timberwolves": ["#0C2340", "#78BE20"],
  "New Orleans Pelicans": ["#0C2340", "#C8102E"],
  "New York Knicks": ["#006BB6", "#F58426"],
  "Oklahoma City Thunder": ["#007AC1", "#EF3B24"],
  "Orlando Magic": ["#0077C0", "#C4CED4"],
  "Philadelphia 76ers": ["#006BB6", "#ED174C"],
  "Phoenix Suns": ["#1D1160", "#E56020"],
  "Portland Trail Blazers": ["#E03A3E", "#000000"],
  "Sacramento Kings": ["#5A2D81", "#63727A"],
  "San Antonio Spurs": ["#000000", "#C4CED4"],
  "Toronto Raptors": ["#CE1141", "#000000"],
  "Utah Jazz": ["#002B5C", "#F9A01B"],
  "Washington Wizards": ["#002B5C", "#E31837"],
};

export const TEAM_COLORS: Record<string, { gear: Gear; colors: [string, string] }> = Object.fromEntries([
  ...Object.entries(NFL).map(([k, v]) => [k, { gear: "helmet" as const, colors: v }]),
  ...Object.entries(NBA).map(([k, v]) => [k, { gear: "jersey" as const, colors: v }]),
]);

/** Steady made-up colors for teams we don't know (test data, other leagues): same name, same colors. */
function fallback(team: string): [string, string] {
  let h = 0;
  for (const ch of team) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hsl = (hue: number, l: number) => {
    // HSL → hex (s = 65%)
    const s = 0.65;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + hue / 30) % 12;
      const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, "0");
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  return [hsl(h % 360, 0.45), hsl((h + 150) % 360, 0.7)];
}

export function teamLook(team: string, sportKey?: string): TeamLook {
  const known = TEAM_COLORS[team];
  if (known) return { kind: known.gear, primary: known.colors[0], secondary: known.colors[1] };
  const [primary, secondary] = fallback(team);
  return { kind: sportKey?.startsWith("basketball") ? "jersey" : "helmet", primary, secondary };
}

/** Whose badge goes next to a pick: the player's team for props, the team picked for winner/spread; none for totals. */
export function pickTeam(p: { marketKey: string; outcomeName: string; participantTeam?: string | null }): string | null {
  if (p.marketKey.startsWith("player_")) return p.participantTeam ?? null;
  if (p.marketKey === "h2h" || p.marketKey === "spreads") return p.outcomeName;
  return null;
}

/** WCAG contrast ratio of a #rrggbb color against white. */
export function contrastOnWhite(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 1;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (l + 0.05);
}

const INK = "#181a21";

/**
 * A team's color for TEXT on white (team names in the picks dropdown): the primary color if it reads (4.5:1),
 * else the secondary, else ink. Bright yellows and oranges fall back.
 */
export function readableTeamColor(team: string, sportKey?: string): string {
  const { primary, secondary } = teamLook(team, sportKey);
  if (contrastOnWhite(primary) >= 4.5) return primary;
  if (contrastOnWhite(secondary) >= 4.5) return secondary;
  return INK;
}
