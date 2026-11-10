import { expect, test } from "@playwright/test";
import { admin, createTournament, expectRevealed, joinAs, newPage, openPlayerBets, placeSingle, showTab, tournamentId, waitForOdds } from "./helpers";

// Phase 3: blind until lock, then the reveal reaches every open lobby without a reload.

test("picks stay blind until the host locks, then everyone sees them live", async ({ browser }) => {
  test.setTimeout(180_000);

  const host = await newPage(browser);
  const code = await createTournament(host, 2);
  await waitForOdds(host);

  // Record everything the guest's browser receives before lock: HTTP bodies and Realtime frames.
  const guest = await newPage(browser);
  const received: string[] = [];
  guest.on("response", (res) => void res.text().then((t) => received.push(t), () => undefined));
  guest.on("websocket", (ws) => ws.on("framereceived", (f) => received.push(String(f.payload))));
  await joinAs(guest, code, "Gina");

  // The host's squad list updates live when Gina joins.
  await expect(host.getByRole("listitem").filter({ hasText: "Gina" })).toBeVisible();

  // Opposite sides of the first game's spread (away row first, home row second).
  await placeSingle(host, host.locator("article").first().locator("button[data-odds-id]").nth(0), 10);
  await placeSingle(guest, guest.locator("article").first().locator("button[data-odds-id]").nth(3), 10);
  await expect(host.getByText(/Squad · 2\/2 slips in/)).toBeVisible();

  // Nothing identifying Hank's pick reached Gina's browser before lock.
  const { data: wagers, error } = await admin
    .from("wagers")
    .select("id, participant_id, tournament_participants(profiles(display_name))")
    .eq("tournament_id", await tournamentId(code));
  expect(error).toBeNull();
  const hanks = (wagers ?? []).filter(
    (w) => (w.tournament_participants as unknown as { profiles: { display_name: string } }).profiles.display_name === "Hank",
  );
  expect(hanks).toHaveLength(1);
  const seen = received.join("\n");
  expect(seen).not.toContain(hanks[0]!.id);
  expect(seen).not.toContain(hanks[0]!.participant_id);

  // Host locks early → both lobbies flip to the reveal on their own.
  await host.getByRole("button", { name: "Lock picks now" }).click();
  await host.getByRole("button", { name: "Lock & reveal" }).click();
  for (const page of [host, guest]) {
    await expectRevealed(page, 15_000);
  }

  // Each leaderboard player drops down their bets: a box per game with the live chance and its (i).
  const hank = await openPlayerBets(guest, "Hank");
  await expect(hank).toContainText("$10");
  await expect(hank.getByLabel(/^Chance to win (\d+%|>99%|<1%)$/).first()).toBeVisible();
  await hank.getByRole("button", { name: "What does this % mean?" }).first().click();
  await expect(hank.getByRole("note")).toContainText("Chance to win");
  // The Games tab lists every game in the tournament.
  await showTab(guest, "Games");
  await expect(guest.getByRole("tabpanel", { name: "Games" }).getByRole("article")).toHaveCount(2);

  // Betting and host controls are gone.
  await expect(guest.locator("button[data-odds-id]")).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Lock picks now" })).toHaveCount(0);
});

test("host rule edits and removals reach players live", async ({ browser }) => {
  test.setTimeout(120_000);

  const host = await newPage(browser);
  const code = await createTournament(host, 1);
  const gina = await newPage(browser);
  await joinAs(gina, code, "Gina");
  const kyle = await newPage(browser);
  await joinAs(kyle, code, "Kyle");
  await expect(host.getByRole("listitem").filter({ hasText: "Kyle" })).toBeVisible();

  await host.getByRole("button", { name: "Edit rules" }).click();
  // Scoped: Next keeps the visited /create page mounted (hidden), and it has a "Max bet ($)" too.
  await host.getByRole("dialog").getByRole("textbox", { name: "Max bet ($)" }).fill("20");
  await host.getByRole("button", { name: "Save changes" }).click();
  await expect(host.getByText("Rules updated")).toBeVisible();
  await expect(gina.getByRole("region", { name: "Rules" })).toContainText("Max bet$20");

  await host.getByRole("button", { name: "Remove Kyle" }).click();
  await host.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(kyle.getByText("The host removed you from this tournament.")).toBeVisible({ timeout: 15_000 });
  await expect(gina.getByRole("listitem").filter({ hasText: "Kyle" })).toHaveCount(0);

  // Same account can't rejoin: opening the invite again just says why (no join form).
  await kyle.goto(`/join/${code}`);
  await expect(kyle.getByText("The host removed you from this tournament.")).toBeVisible();
  await expect(kyle.getByLabel("Your name")).toHaveCount(0);
});

test("the countdown hitting zero reveals picks on its own", async ({ browser }) => {
  test.setTimeout(120_000);

  const host = await newPage(browser);
  const code = await createTournament(host, 1);
  const gina = await newPage(browser);
  await joinAs(gina, code, "Gina");

  // Pull the lock to a few seconds out behind everyone's back (service role).
  const { error } = await admin
    .from("tournaments")
    .update({ lock_time: new Date(Date.now() + 6_000).toISOString() })
    .eq("code", code);
  expect(error).toBeNull();

  await expectRevealed(gina, 30_000);
  await expectRevealed(host, 30_000);
});
