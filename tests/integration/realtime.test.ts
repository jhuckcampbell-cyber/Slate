/**
 * Phase 3 exit criterion: nothing leaks over Realtime. Real WebSocket clients against the local
 * Realtime server: only participants may join a tournament's private channel, and the public
 * channel of the same name carries none of its signals.
 * Requires: `npx supabase start` + `.env.local`. Run: `npm run test:integration`.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

const run = `${Date.now()}`;
const eventId = `it-rt-${run}`;
let admin: SupabaseClient<Database>;
type Name = "host" | "player" | "outsider" | "lurker";
const users: Partial<Record<Name, { id: string; client: SupabaseClient<Database> }>> = {};
const user = (name: Name) => users[name]!;
let tournamentId: string;
const channels: RealtimeChannel[] = [];

async function signUp(name: Name) {
  const email = `rt-${name}-${run}@test.dev`;
  const password = `pw-${run}-Aa1!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  const client = createClient<Database>(url, publishableKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  users[name] = { id: data.user.id, client };
}

/** Subscribe and resolve with the join outcome; collects every broadcast received. */
async function listen(client: SupabaseClient<Database>, isPrivate: boolean) {
  const received: { event: string; payload: Record<string, unknown> }[] = [];
  await client.realtime.setAuth();
  const channel = client
    .channel(`tournament:${tournamentId}`, { config: { private: isPrivate } })
    .on("broadcast", { event: "*" }, (msg) => received.push({ event: msg.event, payload: msg.payload }));
  channels.push(channel);
  const status = await new Promise<string>((resolve) => {
    channel.subscribe((s) => {
      if (s !== "CLOSED") resolve(s);
    });
  });
  return { status, received };
}

const until = async (check: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !check()) await new Promise((r) => setTimeout(r, 100));
  return check();
};

beforeAll(async () => {
  if (!url || !publishableKey || !secretKey) throw new Error("Missing Supabase env (.env.local)");
  admin = createClient<Database>(url, secretKey, { auth: { persistSession: false } });
  await Promise.all([signUp("host"), signUp("player"), signUp("outsider")]);

  const { error: evErr } = await admin.from("events").insert({
    id: eventId,
    sport_key: "americanfootball_nfl",
    home_team: "Home Signals",
    away_team: "Away Signals",
    commence_time: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  });
  if (evErr) throw evErr;

  const { data: t, error: tErr } = await user("host").client
    .rpc("create_tournament", { p_title: "Realtime", p_event_ids: [eventId], p_code_prefix: "RT" })
    .single();
  if (tErr) throw tErr;
  tournamentId = t.id;
  const { error: joinErr } = await user("player").client.rpc("join_tournament", { p_code: t.code });
  if (joinErr) throw joinErr;
});

afterAll(async () => {
  for (const channel of channels) await channel.unsubscribe();
  for (const u of Object.values(users)) {
    if (!u) continue;
    u.client.realtime.disconnect();
    await admin.auth.admin.deleteUser(u.id);
  }
  await admin.from("events").delete().eq("id", eventId);
});

describe("tournament channel", () => {
  it("lets participants in, keeps outsiders out, and leaks nothing on the public topic", async () => {
    // realtime-js reuses a client's channel by topic, so the public listener needs its own client.
    const lurker = createClient<Database>(url, publishableKey, { auth: { persistSession: false } });
    const { data: anon, error: anonErr } = await lurker.auth.signInAnonymously();
    if (anonErr) throw anonErr;
    users.lurker = { id: anon.user!.id, client: lurker };

    const player = await listen(user("player").client, true);
    const outsiderPrivate = await listen(user("outsider").client, true);
    const outsiderPublic = await listen(lurker, false);

    expect(player.status).toBe("SUBSCRIBED");
    expect(outsiderPrivate.status).toBe("CHANNEL_ERROR");
    expect(outsiderPublic.status).toBe("SUBSCRIBED"); // public topics are open to anyone…

    const { error } = await user("host").client.rpc("lock_tournament_now", { p_tournament_id: tournamentId });
    expect(error).toBeNull();

    // …the participant hears the lock…
    expect(await until(() => player.received.some((m) => m.event === "tournament"), 10_000)).toBe(true);
    expect(player.received.find((m) => m.event === "tournament")!.payload).toMatchObject({ status: "locked" });

    // …and the same-named public channel hears nothing at all.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(outsiderPublic.received).toEqual([]);
    expect(outsiderPrivate.received).toEqual([]);
  });
});
