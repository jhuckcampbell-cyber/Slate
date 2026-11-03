import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Requires: local Supabase (+ seed) and `npx supabase functions serve` (odds-sync, fake provider).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });

async function createTournament(page: Page, games: number) {
  await page.goto("/create");
  await page.waitForLoadState("networkidle");
  const cards = page.getByRole("button").filter({ hasText: "@" });
  for (let i = 0; i < games; i++) {
    await cards.nth(i).click();
    await expect(page.getByRole("button", { name: new RegExp(`Continue with ${i + 1} game`) })).toBeVisible();
  }
  await page.getByRole("button", { name: /Continue with/ }).click();
  await page.getByLabel("Your name").fill("Hank");
  await page.getByRole("button", { name: /Create & get invite link/ }).click();
  await page.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

async function waitForOdds(page: Page) {
  // Nudge the sync instead of waiting for the next cron minute (a held lease is fine: cron covers it).
  await page.request
    .post(`${SUPABASE_URL}/functions/v1/odds-sync`, {
      headers: { "x-sync-secret": process.env.ODDS_SYNC_SECRET ?? "local-dev-sync-secret" },
    })
    .catch(() => undefined);
  await expect(page.locator('article button[aria-pressed="false"]').first()).toBeEnabled({ timeout: 90_000 });
}

test("blind slip: parlay, live odds change, cancel refund", async ({ browser }) => {
  test.setTimeout(180_000);

  const host = await (await browser.newContext()).newPage();
  const code = await createTournament(host, 2);
  await waitForOdds(host);

  // Guest joins before anyone bets.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/join/${code}`);
  await guest.waitForLoadState("networkidle");
  await guest.getByLabel("Your name").fill("Gina");
  await guest.getByRole("button", { name: "I'm in" }).click();
  await guest.waitForURL(`**/t/${code}`);

  // Host: 2-leg parlay for $10.
  const firstGame = host.locator("article").nth(0);
  const secondGame = host.locator("article").nth(1);
  await firstGame.getByRole("button", { pressed: false }).first().click(); // away spread
  await secondGame.getByRole("button", { pressed: false }).last().click(); // home moneyline
  await host.getByRole("button", { name: /Bet slip/ }).click();
  await host.getByRole("tab", { name: /Parlay \(2\)/ }).click();
  await host.getByLabel("Parlay stake").fill("10");
  await host.getByRole("button", { name: "Place bet · $10" }).click();
  await expect(host.getByText("Bet placed")).toBeVisible();
  await expect(host.getByText("$90").first()).toBeVisible(); // bankroll strip

  await host.getByRole("tab", { name: /My picks/ }).click();
  await expect(host.getByRole("tab", { name: /My picks/ })).toHaveAttribute("aria-selected", "true");
  await expect(host.getByText("2-leg parlay")).toBeVisible();

  // Guest: sees that Hank submitted, but not what.
  await guest.reload();
  await expect(guest.getByText(/1\/2 locked in/)).toBeVisible();
  await guest.getByRole("tab", { name: /My picks/ }).click();
  await expect(guest.getByText("No picks yet")).toBeVisible();

  // Host: a line moves while a pick sits in the slip → Realtime → accept → place.
  await host.getByRole("tab", { name: /Board/ }).click();
  const pick = firstGame.getByRole("button", { pressed: false }).last(); // home moneyline
  const oddsId = Number(await pick.getAttribute("data-odds-id"));
  // Move relative to the price the player ACCEPTS (aria-label "Celtics ML -260"), not the DB value:
  // a concurrent fake-provider sync may have already changed the DB row.
  const accepted = Number((await pick.getAttribute("aria-label"))!.split(" ").pop());
  await pick.click();
  await host.getByRole("button", { name: /Bet slip/ }).click();
  await host.getByLabel(/^Stake on/).fill("5");

  const moved = accepted < 0 ? accepted - 25 : accepted + 25;
  const { error } = await admin
    .from("odds_cache")
    .update({ price_american: moved, updated_at: new Date().toISOString() })
    .eq("id", oddsId);
  expect(error).toBeNull();

  await host.getByRole("button", { name: "Accept new odds" }).click({ timeout: 15_000 });
  await host.getByRole("button", { name: "Place bet · $5" }).click();
  await expect(host.getByText("$85").first()).toBeVisible();

  // Host: cancel the $5 single → refunded.
  await host.getByRole("tab", { name: /My picks \(2\)/ }).click();
  await host.locator("li").filter({ hasText: "Single" }).getByRole("button", { name: "Cancel" }).click();
  await expect(host.getByText("Bet cancelled")).toBeVisible();
  await expect(host.getByText("$90").first()).toBeVisible();
});
