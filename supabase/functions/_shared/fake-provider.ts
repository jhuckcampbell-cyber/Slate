/**
 * Fake odds provider for local dev/CI (ODDS_PROVIDER=fake): emits responses in The Odds API v4
 * shape for events already in our DB, so the real normalization + ingest path runs without
 * spending credits. PURE and deterministic: same events + same time bucket → same prices.
 * Lines drift a little between buckets so Realtime/"odds changed" flows get exercised.
 */
import type { ApiEvent, ApiMarket } from "./odds-api.ts";

export type FakeEventInput = {
  id: string;
  sport_key: string;
  sport_title?: string | null;
  home_team: string;
  away_team: string;
  commence_time: string;
};

type Profile = { sigma: number; spreadRange: number; totalBase: number; totalRange: number };

const PROFILES: Record<string, Profile> = {
  americanfootball_nfl: { sigma: 13.5, spreadRange: 10, totalBase: 44.5, totalRange: 6 },
  americanfootball_ncaaf: { sigma: 16, spreadRange: 21, totalBase: 52.5, totalRange: 10 },
  basketball_nba: { sigma: 12, spreadRange: 12, totalBase: 226.5, totalRange: 12 },
  basketball_ncaab: { sigma: 11, spreadRange: 15, totalBase: 144.5, totalRange: 10 },
  icehockey_nhl: { sigma: 2.4, spreadRange: 1, totalBase: 6, totalRange: 0.5 },
  baseball_mlb: { sigma: 4.2, spreadRange: 1, totalBase: 8.5, totalRange: 1.5 },
};
const DEFAULT_PROFILE: Profile = { sigma: 12, spreadRange: 8, totalBase: 40.5, totalRange: 6 };

export const DEFAULT_BUCKET_MS = 10 * 60 * 1000;

export function fakeOddsResponse(
  events: readonly FakeEventInput[],
  markets: readonly string[],
  opts: { nowMs: number; bucketMs?: number; bookmaker?: string },
): ApiEvent[] {
  const bucketMs = opts.bucketMs ?? DEFAULT_BUCKET_MS;
  const bucket = Math.floor(opts.nowMs / bucketMs);
  const book = opts.bookmaker ?? "fakebook";
  const lastUpdate = new Date(bucket * bucketMs).toISOString(); // prices last moved at bucket start

  return events.map((ev) => {
    const p = PROFILES[ev.sport_key] ?? DEFAULT_PROFILE;
    const base = hash(ev.id);
    const drift = hash(`${ev.id}:${bucket}`);

    // Home spread on a half-point grid in [-range, +range/2] (home teams are usually favored).
    const steps = Math.round((p.spreadRange * 1.5) / 0.5);
    const baseSpread = -p.spreadRange + 0.5 * (base % (steps + 1));
    const spreadMove = drift % 10 < 3 ? (drift % 2 ? 0.5 : -0.5) : 0; // ~30% of buckets move
    const homeSpread = baseSpread + spreadMove;

    const totalSteps = Math.round((p.totalRange * 2) / 0.5);
    const baseTotal = p.totalBase - p.totalRange + 0.5 * ((base >>> 8) % (totalSteps + 1));
    const totalMove = (drift >>> 4) % 10 < 2 ? ((drift >>> 4) % 2 ? 0.5 : -0.5) : 0;
    const total = baseTotal + totalMove;

    const juice = (drift >>> 8) % 4 === 0 ? [-105, -115] : [-110, -110];
    const pHome = normalCdf(-homeSpread / p.sigma);

    const all: Record<string, ApiMarket> = {
      h2h: {
        key: "h2h",
        last_update: lastUpdate,
        outcomes: [
          { name: ev.away_team, price: probToAmerican((1 - pHome) * 1.0225) },
          { name: ev.home_team, price: probToAmerican(pHome * 1.0225) },
        ],
      },
      spreads: {
        key: "spreads",
        last_update: lastUpdate,
        outcomes: [
          { name: ev.away_team, price: juice[1]!, point: -homeSpread || 0 },
          { name: ev.home_team, price: juice[0]!, point: homeSpread || 0 },
        ],
      },
      totals: {
        key: "totals",
        last_update: lastUpdate,
        outcomes: [
          { name: "Over", price: -110, point: total },
          { name: "Under", price: -110, point: total },
        ],
      },
    };

    return {
      id: ev.id,
      sport_key: ev.sport_key,
      sport_title: ev.sport_title ?? undefined,
      commence_time: ev.commence_time,
      home_team: ev.home_team,
      away_team: ev.away_team,
      bookmakers: [
        {
          key: book,
          title: "Fake Book",
          last_update: lastUpdate,
          markets: markets.flatMap((k) => (all[k] ? [all[k]] : [])),
        },
      ],
    };
  });
}

/** Probability (vig included) → American, rounded to the nearest 5 like a real book. */
export function probToAmerican(p: number): number {
  const clamped = Math.min(Math.max(p, 0.02), 0.98);
  const raw = clamped >= 0.5 ? (-100 * clamped) / (1 - clamped) : (100 * (1 - clamped)) / clamped;
  const rounded = Math.round(raw / 5) * 5;
  if (rounded > -100 && rounded < 100) return rounded < 0 ? -100 : 100;
  return rounded;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** FNV-1a 32-bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
