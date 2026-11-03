import { expect, test } from "@playwright/test";
import { admin, createTournament, joinAs, newPage, waitForOdds } from "./helpers";

test("blind slip: parlay, live odds change, cancel refund", async ({ browser }) => {
  test.setTimeout(180_000);

  const host = await newPage(browser);
  const code = await createTournament(host, 2);
  await waitForOdds(host);

  // Guest joins before anyone bets.
  const guest = await newPage(browser);
  await joinAs(guest, code, "Gina");

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
