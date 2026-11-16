import { lookupTeam, TEAMS, type League } from "./teams/registry";
export type Gear = "helmet" | "jersey" | "sweater" | "cap" | "pennant" | "shield";
export type TeamLook = { kind: Gear; primary: string; secondary: string };
const GEAR: Record<League, Gear> = { NFL: "helmet", NBA: "jersey", NHL: "sweater", MLB: "cap", NCAAF: "pennant", NCAAB: "pennant" };
export const NEUTRAL_LOOK: TeamLook = { kind: "shield", primary: "#6B6E76", secondary: "#181a21" };
/** Compatibility view; all identity data lives in the registry. */
export const TEAM_COLORS = Object.fromEntries(TEAMS.map(t => [t.name, { gear: GEAR[t.league], colors: [t.primary, t.secondary] }]));
export function teamLook(team: string, sportKey?: string): TeamLook {
  const known = lookupTeam(team, sportKey);
  return known ? { kind: GEAR[known.league], primary: known.primary, secondary: known.secondary } : { ...NEUTRAL_LOOK };
}
/** Gear fill/trim only; text contrast is handled separately. Similar RGB colors use ink trim. */
export function markColors({ primary, secondary }: Pick<TeamLook, "primary" | "secondary">) {
  const [fill, trim] = contrastOnWhite(primary) < 1.5 ? [secondary, primary] : [primary, secondary];
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const a = rgb(fill), b = rgb(trim);
  const similar = a.every((v, i) => Math.abs(v - b[i]!) <= 24);
  return { fill, trim: similar ? "#181a21" : trim };
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
