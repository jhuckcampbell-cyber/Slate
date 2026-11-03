/**
 * Invite codes like `TNF-8X29`: a 2–5 char prefix derived from the title + 4 chars from an
 * unambiguous alphabet (Crockford-ish: no I, L, O, U, 0, 1). Pure, runtime-agnostic.
 * Must stay in sync with the CHECK constraint on public.tournaments.code.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_PATTERN = /^[A-Z0-9]{2,5}-[2-9A-HJ-KMNP-TV-Z]{4}$/;

const STOP_WORDS = new Set(["THE", "A", "AN", "OF", "AND", "VS", "AT"]);

/** "Thursday Night Football" → "TNF"; "Lakers" → "LAKER"; fallback "SB". */
export function codePrefix(title: string): string {
  const words = title
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));

  let prefix = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] ?? "");
  prefix = prefix.slice(0, 5);
  return prefix.length >= 2 ? prefix : "SB";
}

/** Random suffix. `rand` is injectable for deterministic tests; defaults to crypto RNG. */
export function codeSuffix(rand: (n: number) => number = cryptoRandInt): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return out;
}

export function generateCode(title: string, rand?: (n: number) => number): string {
  return `${codePrefix(title)}-${codeSuffix(rand)}`;
}

/** Normalizes user-typed codes: "tnf 8x29" / "tnf8x29" → "TNF-8X29". */
export function normalizeCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (compact.includes("-")) return compact;
  if (compact.length < 6) return compact;
  return `${compact.slice(0, -4)}-${compact.slice(-4)}`;
}

export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

function cryptoRandInt(n: number): number {
  // Rejection sampling to avoid modulo bias.
  const buf = new Uint8Array(1);
  const limit = 256 - (256 % n);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}
