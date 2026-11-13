/** Auth destinations must remain on this site after browser URL normalization. */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || /[\\\x00-\x20\x7f]/.test(value)) return "/account";
  try {
    const url = new URL(value, "https://slate.invalid");
    if (url.origin !== "https://slate.invalid" || url.pathname.startsWith("//")) return "/account";
    // Reject encoded separators/control characters too, including nested encoding.
    let decoded = value;
    for (let i = 0; i < 5; i++) {
      if (/[\\\x00-\x20\x7f]/.test(decoded) || decoded.startsWith("//")) return "/account";
      const next = decodeURIComponent(decoded);
      if (next === decoded) return value;
      decoded = next;
    }
  } catch { /* Malformed URL or percent encoding. */ }
  return "/account";
}
