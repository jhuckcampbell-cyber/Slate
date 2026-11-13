import { afterEach, expect, it, vi } from "vitest";
import { oddsBatch, resilientChannel } from "./realtime";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
afterEach(() => vi.useRealTimers());
it("coalesces a burst into the union of affected events and cancels pending work", () => {
 vi.useFakeTimers();
 const flush = vi.fn(); const batch = oddsBatch(flush);
 batch.add(["a"]); vi.advanceTimersByTime(200); batch.add(["b", "a"]);
 vi.advanceTimersByTime(299); expect(flush).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1); expect(flush).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
 batch.add(["c"]); batch.cancel(); vi.runAllTimers(); expect(flush).toHaveBeenCalledTimes(1);
});
it("backs off failures, resyncs each join and cancels reconnect on cleanup", async () => {
 vi.useFakeTimers();
 let status: (s: string) => void = () => {};
 const channel = { subscribe: vi.fn((cb) => { status = cb; }) } as unknown as RealtimeChannel;
 const client = { realtime: { setAuth: vi.fn().mockResolvedValue(undefined) }, removeChannel: vi.fn().mockResolvedValue(undefined) } as unknown as SupabaseClient;
 const build = vi.fn(() => channel); const refresh = vi.fn();
 const stop = resilientChannel(client, build, refresh);
 await vi.advanceTimersByTimeAsync(0); status("CHANNEL_ERROR");
 await vi.advanceTimersByTimeAsync(999); expect(build).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1); expect(build).toHaveBeenCalledTimes(2);
 status("TIMED_OUT"); await vi.advanceTimersByTimeAsync(1999); expect(build).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(1); status("SUBSCRIBED"); expect(refresh).toHaveBeenCalledTimes(1);
 status("CLOSED"); await vi.advanceTimersByTimeAsync(1000); status("SUBSCRIBED"); expect(refresh).toHaveBeenCalledTimes(2);
 status("CHANNEL_ERROR"); stop(); await vi.runAllTimersAsync(); expect(build).toHaveBeenCalledTimes(4);
});
