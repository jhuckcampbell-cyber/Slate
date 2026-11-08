import { expect, test } from "@playwright/test";
import { admin, closeFinal, joinAs, newPage, nudgeSync, openPlayerBets, placeSingle, waitForOdds } from "./helpers";

// Player props: host opts in at create → per-game prop odds (fake provider) → over/under picks →
// final → the host enters the stat → every pick on that line is graded → the tournament finishes.
const eventId = `e2e-props-${Date.now()}`;
const SHOTS = process.env.SCREENS;

test.afterAll(async () => {
  await admin.from("events").update({ commence_time: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", eventId);
});

test("host-enabled player props are bet, then graded by the host's stat entry", async ({ browser }) => {
  test.setTimeout(180_000);

  const { error } = await admin.from("events").insert({
    id: eventId,
    sport_key: "basketball_nba",
    sport_title: "NBA",
    home_team: "Propsville Pilots",
    away_team: "Linetown Lynx",
    commence_time: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  });
  expect(error).toBeNull();

  // Create with props on (the earliest game is the first card).
  const host = await newPage(browser);
  await host.goto("/create");
  await host.waitForLoadState("networkidle");
  await host.getByRole("button").filter({ hasText: "@" }).first().click();
  await host.getByRole("button", { name: /Continue with 1 game/ }).click();
  await host.getByRole("switch", { name: "Player props" }).click();
  await host.getByLabel("Your name").fill("Hank");
  await host.getByRole("button", { name: /Create & get invite link/ }).click();
  await host.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  const code = new URL(host.url()).pathname.split("/").pop()!;
  await expect(host.getByText("Winner, Spread, Total + player props")).toBeVisible();
  await waitForOdds(host);

  // Host: first player's Over on points.
  // Tap the game for its page: every prop, by stat.
  await host.getByRole("button", { name: /^More bets/ }).click();
  await host.getByRole("button", { name: "Points", exact: true }).click();
  const over = host.getByRole("button", { name: / Over [\d.]+ Pts / }).first();
  await expect(over).toBeEnabled({ timeout: 60_000 });
  // The label may or may not carry the team yet ("Name (Pilots) Over ..."): the roster can land mid-test.
  const player = (await over.getAttribute("aria-label"))!.split(" Over ")[0]!.replace(/ \([^)]*\)$/, "");
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/16-props-board.png`, fullPage: true });
  await placeSingle(host, over, 10);

  // Gina: same player's Under.
  const gina = await newPage(browser);
  await joinAs(gina, code, "Gina");
  await gina.getByRole("button", { name: /^More bets/ }).click();
  await gina.getByRole("button", { name: "Points", exact: true }).click();
  await placeSingle(gina, gina.getByRole("button", { name: new RegExp(`^${player}( \\([^)]*\\))? Under [\\d.]+ Pts`) }), 20);

  // Lock, play, final.
  await host.getByRole("button", { name: "Lock picks now" }).click();
  await host.getByRole("button", { name: "Lock & reveal" }).click();
  await expect(host.getByRole("heading", { name: "Picks are in" })).toBeVisible({ timeout: 20_000 });

  // In play: the box score (fake feed locally) shows each prop pick's number so far, in the player's dropdown.
  await admin.from("events").update({ commence_time: new Date(Date.now() - 60 * 60_000).toISOString() }).eq("id", eventId);
  await expect(async () => {
    await nudgeSync(host);
    await host.reload();
    const hank = await openPlayerBets(host, "Hank");
    await expect(hank.getByLabel(/^Live stat: \d+ Pts · (needs \d+ more|cleared)$/)).toBeVisible({ timeout: 2_000 });
    // ...and the bet's chance follows it, with a tension tag.
    await expect(hank.getByText(/^(Safe|Sweating|Danger)$/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 90_000 });
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/16b-props-live-stat.png`, fullPage: true });

  await admin.rpc("scores_ingest", {
    p_sport_key: "basketball_nba",
    p_fetched_at: new Date().toISOString(),
    p_scores: [{ event_id: eventId, completed: true, home_score: 108, away_score: 102 }],
  });
  await admin.from("events").update({ commence_time: new Date(Date.now() - 3 * 3_600_000).toISOString() }).eq("id", eventId);

  // The host is asked for the stat; Gina sees who it's waiting on.
  await host.reload();
  const stat = host.getByLabel(`${player} Points stat`);
  await expect(stat).toBeVisible({ timeout: 30_000 });
  await gina.reload();
  await expect(gina.getByText("Waiting on Hank to enter the stats.")).toBeVisible();
  if (SHOTS) {
    await host.waitForTimeout(2600);
    await host.screenshot({ path: `${SHOTS}/17-props-grading.png`, fullPage: true });
  }

  await stat.fill("99");
  await host.getByRole("button", { name: "Enter" }).click();
  await expect(host.getByText(`${player} Points: 99. Picks graded.`)).toBeVisible();

  // Over wins, Under loses, the stat is public, the tournament finishes.
  await expect(gina.getByRole("heading", { name: "Final standings" })).toBeVisible({ timeout: 30_000 });
  await expect(gina.getByText("Hank wins")).toBeVisible();
  await closeFinal(gina);
  await openPlayerBets(gina, "Gina");
  await openPlayerBets(gina, "Hank");
  await expect(gina.getByText("Lost")).toBeVisible();
  await expect(gina.getByText(/^Won \$/)).toBeVisible();
  await expect(gina.getByText("Entered by Hank.")).toBeVisible();
});
