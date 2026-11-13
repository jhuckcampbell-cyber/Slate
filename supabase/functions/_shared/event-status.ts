/** Only explicit provider states are evidence; missing games never imply cancellation. */
export function eventStatus(value: unknown): { status: string; status_reason: string } | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  const state = reason.toLowerCase().replace(/^status_/, "");
  const status = /cancel/.test(state) ? "canceled"
    : /postpon/.test(state) ? "postponed"
    : /suspend/.test(state) ? "suspended"
    : /delay/.test(state) ? "delayed" : null;
  return status ? { status, status_reason: reason } : null;
}
