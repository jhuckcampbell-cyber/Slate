/**
 * Odds math. PURE + runtime-agnostic (no imports).
 *
 * Decimal odds are carried as integer "e4" units (1.9091 → 19091). Every rounding step mirrors
 * the Postgres numeric math in place_wagers / odds_cache.price_decimal, so the payout a player
 * sees in the slip is exactly what the server books (CLAUDE.md rule 3 keeps the server the
 * authority; this keeps the preview honest).
 */

export const DECIMAL_SCALE = 10_000;

/** Parlay payout cap, also enforced in SQL: 1000-to-1 (decimal 1001.0000). */
export const MAX_PARLAY_DECIMAL_E4 = 1001 * DECIMAL_SCALE;

export function isValidAmerican(american: number): boolean {
  return Number.isInteger(american) && Math.abs(american) >= 100;
}

/**
 * American → decimal (e4). Mirrors the generated column
 * `1 + price/100.0` or `1 + 100.0/abs(price)` cast to numeric(10,4) (round half up).
 */
export function americanToDecimalE4(american: number): number {
  if (!isValidAmerican(american)) throw new RangeError(`Invalid American odds: ${american}`);
  return american > 0
    ? DECIMAL_SCALE + american * 100
    : DECIMAL_SCALE + Math.round(1_000_000 / -american);
}

/** Decimal (e4) → American, rounded half away from zero like Postgres round(). */
export function decimalE4ToAmerican(decimalE4: number): number {
  if (!Number.isInteger(decimalE4) || decimalE4 <= DECIMAL_SCALE) {
    throw new RangeError(`Invalid decimal odds (e4): ${decimalE4}`);
  }
  const profitE4 = decimalE4 - DECIMAL_SCALE;
  return decimalE4 >= 2 * DECIMAL_SCALE
    ? roundHalfAwayFromZero(profitE4 / 100)
    : roundHalfAwayFromZero(-1_000_000 / profitE4);
}

/**
 * Parlay price: exact product of leg decimals, rounded half up to 4dp, capped.
 * BigInt keeps the product exact (10 legs of e4 ints overflow doubles).
 */
export function parlayDecimalE4(legsE4: readonly number[]): number {
  if (legsE4.length === 0) throw new RangeError("A parlay needs at least one leg");
  const scale = BigInt(DECIMAL_SCALE);
  let num = 1n;
  let den = 1n;
  for (const leg of legsE4) {
    if (!Number.isInteger(leg) || leg <= DECIMAL_SCALE) throw new RangeError(`Invalid leg: ${leg}`);
    num *= BigInt(leg);
    den *= scale;
  }
  const scaled = num * scale;
  let q = scaled / den;
  if ((scaled % den) * 2n >= den) q += 1n;
  return Math.min(Number(q), MAX_PARLAY_DECIMAL_E4);
}

/** Total return (stake included) = floor(stake × decimal). Mirrors SQL floor(amount * decimal). */
export function payoutCents(stakeCents: number, decimalE4: number): number {
  // stake ≤ 1e8 and decimal ≤ ~1e7 keep the product well inside 2^53; the division is exact
  // enough that floor() can't land on the wrong side (fractions are multiples of 1e-4).
  return Math.floor((stakeCents * decimalE4) / DECIMAL_SCALE);
}

/** Implied probability of an American price, vig included. */
export function impliedProbability(american: number): number {
  if (!isValidAmerican(american)) throw new RangeError(`Invalid American odds: ${american}`);
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

/** Remove the bookmaker's margin by normalizing a market's implied probabilities to sum to 1. */
export function devig(probabilities: readonly number[]): number[] {
  const total = probabilities.reduce((sum, p) => sum + p, 0);
  if (total <= 0) throw new RangeError("Probabilities must sum to a positive number");
  return probabilities.map((p) => p / total);
}

function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}
