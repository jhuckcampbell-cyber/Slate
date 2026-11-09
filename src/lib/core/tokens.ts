/**
 * Token mode: everyone gets the same bet "tokens" (e.g. $25, $25, $50) instead of typing amounts. One token per bet,
 * every token has to be used. MIRRORS public.place_wagers (migration 0024), which is what enforces it. Pure.
 */

export type TokenPreset = { key: string; label: string; tokens: number[] };

/** The host's choices for a bankroll (cents): only sets that split it into whole dollars. */
export function tokenPresets(bankrollCents: number): TokenPreset[] {
  const q = bankrollCents / 4;
  const h = bankrollCents / 2;
  if (!Number.isInteger(q / 100) || bankrollCents <= 0) return [];
  return [
    { key: "mix", label: "Mix", tokens: [q, q, h] },
    { key: "quarters", label: "Four of a kind", tokens: [q, q, q, q] },
    { key: "halves", label: "Two big ones", tokens: [h, h] },
  ];
}

/** Remove one of each amount from a token list (a multiset). Amounts that aren't tokens are ignored. */
export function takeTokens(tokens: readonly number[], amounts: readonly number[]): number[] {
  const left = [...tokens];
  for (const a of amounts) {
    const i = left.indexOf(a);
    if (i !== -1) left.splice(i, 1);
  }
  return left;
}

/** Do these stakes each spend a distinct token from `available`? */
export function stakesFitTokens(available: readonly number[], stakes: readonly number[]): boolean {
  const left = [...available];
  for (const s of stakes) {
    const i = left.indexOf(s);
    if (i === -1) return false;
    left.splice(i, 1);
  }
  return true;
}
