/** A completed claim (including an empty or held lease) is healthy; failures are not. */
export function healthy(lastSuccess, now, maxAge = 45000) {
  return lastSuccess !== null && now - lastSuccess < maxAge;
}
export async function cycle(handler, beat, secret) {
  const response = await handler(new Request("http://worker/odds-sync", {
    method: "POST", headers: { "x-sync-secret": secret }, body: "{}",
  }));
  if (!response.ok) throw new Error("SYNC_FAILED");
  await beat();
}
