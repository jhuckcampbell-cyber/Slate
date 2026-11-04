import { expect, test, type Page } from "@playwright/test";
import { formatCents } from "../src/lib/format";
import { admin, createTournament, joinAs, newPage, placeSingle, tournamentId, waitForOdds } from "./helpers";

// Phase 5: lock → live scores → leaderboard and chances → final → graded bets, credited
// bankrolls, winner. Scores are pushed with the service role (what the scores sync does).
const eventId = `e2e-sweat-${Date.now()}`;
const HOME = "Testville Comets";
const SHOTS = process.env.SCREENS; // also part of the design tour when set
const AWAY = "Mocktown Rockets";

async function scores(home: number, away: number, completed: boolean) {
  const { error } = await admin.rpc("scores_ingest", {
    p_sport_key: "basketball_nba",
    p_fetched_at: new Date().toISOString(),
    p_scores: [{ event_id: eventId, completed, home_score: home, away_score: away }],
  });
  expect(error).toBeNull();
}

test.afterAll(async () => {
  // Never leave a future game behind for other specs' "first card".
  await admin.from("events").update({ commence_time: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", eventId);
});

test("live scores move the leaderboard, a final grades bets and crowns a winner", async ({ browser }) => {
  test.setTimeout(180_000);

  // The earliest upcoming game, so it's the create wizard's first card.
  const { error } = await admin.from("events").insert({
    id: eventId,
    sport_key: "basketball_nba",
    sport_title: "NBA",
    home_team: HOME,
    away_team: AWAY,
    commence_time: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  });
  expect(error).toBeNull();

  const host = await newPage(browser);
  const code = await createTournament(host, 1);
  await waitForOdds(host);
  const gina = await newPage(browser);
  await joinAs(gina, code, "Gina");

  // Columns: spread, total, moneyline; rows: away then home.
  const odds = (page: Page, i: number) => page.locator("article").first().locator("button[data-odds-id]").nth(i);
  await placeSingle(host, odds(host, 2), 10); // Rockets ML
  await placeSingle(gina, odds(gina, 5), 20); // Comets ML
  const { data: ginaBet } = await admin
    .from("wagers")
    .select("potential_payout_cents")
    .eq("tournament_id", await tournamentId(code))
    .eq("amount_cents", 2000)
    .single();
  const ginaReturn = Number(ginaBet!.potential_payout_cents);

  await host.getByRole("button", { name: "Lock picks now" }).click();
  await host.getByRole("button", { name: "Lock & reveal" }).click();
  await expect(gina.getByRole("heading", { name: "Picks are in" })).toBeVisible({ timeout: 20_000 });

  // Tip-off, then a live score (ingest first: it also defers the cron's own scores sync).
  await scores(50, 40, false);
  await admin.from("events").update({ commence_time: new Date(Date.now() - 75 * 60_000).toISOString() }).eq("id", eventId);

  await expect(gina.getByRole("heading", { name: "Leaderboard" })).toBeVisible({ timeout: 30_000 });
  await expect(gina.getByText("Rockets 40 · Comets 50")).toBeVisible({ timeout: 30_000 });
  await gina.getByRole("tab", { name: "By player" }).click();
  await expect(gina.getByText(/\d+% to cash|>99% to cash/).first()).toBeVisible();
  // Live order depends on the (fake) prices, so only check both are ranked; the final is exact.
  await expect(gina.getByRole("listitem", { name: /^\d\. Gina/ })).toBeVisible();
  await expect(gina.getByRole("listitem", { name: /^\d\. Hank/ })).toBeVisible();
  if (SHOTS) {
    await gina.waitForTimeout(2600); // let the one-time reveal overlay and toasts clear
    await gina.screenshot({ path: `${SHOTS}/14-sweat-live.png`, fullPage: true });
  }

  // Final: Comets win. Gina is credited her bet's return on top of the $80 she didn't bet.
  await scores(101, 99, true);
  await expect(gina.getByRole("heading", { name: "Final standings" })).toBeVisible({ timeout: 30_000 });
  await expect(gina.getByText("You win")).toBeVisible();
  await expect(gina.getByText(`Won ${formatCents(ginaReturn)}`)).toBeVisible();
  await expect(gina.getByRole("listitem", { name: /^1\. Gina/ })).toContainText(formatCents(8000 + ginaReturn));
  if (SHOTS) {
    await gina.waitForTimeout(600);
    await gina.screenshot({ path: `${SHOTS}/15-final-standings.png`, fullPage: true });
  }

  await expect(gina.getByRole("link", { name: "Run it back" })).toHaveAttribute("href", "/create");

  await host.reload();
  await expect(host.getByText("Gina wins")).toBeVisible();
  await expect(host.getByRole("listitem", { name: /^2\. Hank/ })).toContainText("$90");
});
