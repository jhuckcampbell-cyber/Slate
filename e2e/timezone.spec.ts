import { expect, test } from "@playwright/test";
import { formatKickoff } from "../src/lib/format";
import { admin, createTournament, newPage, tournamentId } from "./helpers";

// Times are shown in the VIEWER's time zone, even on server-rendered pages. In production the server
// runs in UTC, so a friend opening an 8:15 PM ET invite once saw "Fri 1:15 AM".
// The friend here is in Los Angeles; the test server runs in this machine's zone (not LA).
const VIEWER_TZ = "America/Los_Angeles";

test("invite and lobby show kickoff and lock in the viewer's time zone", async ({ browser }) => {
  const host = await newPage(browser);
  const code = await createTournament(host, 1);
  const { data, error } = await admin
    .from("tournaments")
    .select("lock_time, tournament_events(events(commence_time))")
    .eq("id", await tournamentId(code))
    .single();
  expect(error).toBeNull();
  const kickoff = (data!.tournament_events as unknown as { events: { commence_time: string } }[])[0].events
    .commence_time;
  const local = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: VIEWER_TZ });
  expect(local(kickoff)).not.toBe(formatKickoff(kickoff)); // sanity: the zones really differ

  const friend = await newPage(browser, { timezoneId: VIEWER_TZ });
  const errors: string[] = [];
  friend.on("pageerror", (e) => errors.push(e.message));
  friend.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await friend.goto(`/join/${code}`);
  // Local time appears once the page hydrates (the server pass shows Eastern time); allow a slow phone.
  await expect(friend.getByText(local(kickoff), { exact: true })).toBeVisible({ timeout: 15_000 });

  await host.reload();
  const hostLA = await newPage(browser, { timezoneId: VIEWER_TZ, storageState: await host.context().storageState() });
  await hostLA.goto(`/t/${code}`);
  await expect(hostLA.getByText(`Picks stay hidden from everyone until ${local(data!.lock_time)}`)).toBeVisible({
    timeout: 15_000,
  });

  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});
