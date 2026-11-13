import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
it("allows anonymous-auth odds reception and rejects guest and tournament outsider", async () => {
 const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
 const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
 const admin = createClient(url, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
 const guest = createClient(url, key, { auth: { persistSession: false } });
 const user = createClient(url, key, { auth: { persistSession: false } });
 let id: string | undefined;
 const listen = async (client: typeof guest, topic: string) => {
  await client.realtime.setAuth();
  const channel = client.channel(topic, { config: { private: true } }).on("broadcast", { event: "odds" }, () => {});
  return new Promise<string>((resolve, reject) => {
   const timeout = setTimeout(() => reject(new Error(`Join timeout: ${topic}`)), 15000);
   channel.subscribe((status) => {
    if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT"].includes(status)) { clearTimeout(timeout); resolve(status); }
   });
  });
 };
 try {
  const { data, error } = await user.auth.signInAnonymously(); if (error) throw error;
  id = data.user!.id;
  expect(await listen(user, "odds:basketball_nba")).toBe("SUBSCRIBED");
  expect(await listen(guest, "odds:basketball_nba")).toBe("CHANNEL_ERROR");
  expect(await listen(user, "tournament:10000000-0000-0000-0000-000000000000")).toBe("CHANNEL_ERROR");
 } finally {
  await guest.removeAllChannels(); await user.removeAllChannels();
  guest.realtime.disconnect(); user.realtime.disconnect();
  if (id) await admin.auth.admin.deleteUser(id);
 }
}, 60000);
