import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/** Recreate failed channels: a successful join always resyncs through the RLS read path. */
export function resilientChannel(
  client: SupabaseClient,
  build: () => RealtimeChannel,
  resync: () => void,
) {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let channel: RealtimeChannel | undefined;
  let generation = 0;
  let authTimer: ReturnType<typeof setTimeout> | undefined;
  const connect = async () => {
    const current = ++generation;
    try {
      try {
        await Promise.race([
          client.realtime.setAuth(),
          new Promise((_, reject) => {
            authTimer = setTimeout(() => reject(new Error("Realtime auth timeout")), 3000);
          }),
        ]);
      } finally { clearTimeout(authTimer); }
      if (stopped || current !== generation) return;
      channel = build();
      channel.subscribe((status) => {
        if (stopped || current !== generation) return;
        if (status === "SUBSCRIBED") {
          attempt = 0;
          resync();
        } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) retry();
      });
    } catch { retry(); }
  };
  const retry = () => {
    if (stopped || timer) return;
    ++generation;
    timer = setTimeout(async () => {
      timer = undefined;
      if (channel) await client.removeChannel(channel);
      if (!stopped) void connect();
    }, Math.min(1000 * 2 ** attempt++, 30_000));
  };
  void connect();
  return () => {
    stopped = true;
    ++generation;
    clearTimeout(timer);
    if (channel) void client.removeChannel(channel);
  };
}

/** Merge a burst into one read; take the union so different games cannot erase each other. */
export function oddsBatch(flush: (ids: string[]) => void, delay = 300) {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    add(ids: readonly string[]) {
      ids.forEach((id) => pending.add(id));
      clearTimeout(timer);
      timer = setTimeout(() => {
        const ids = [...pending];
        pending.clear();
        flush(ids);
      }, delay);
    },
    cancel() { clearTimeout(timer); pending.clear(); },
  };
}
