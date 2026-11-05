import { expect, test, type Page } from "@playwright/test";
import { createTournament, joinAs, newPage, openPicksByGame, openPlayerBets, placeSingle, waitForOdds } from "./helpers";

// Design review tour, not a regression test. Skipped unless SCREENS=<output dir> is set:
//   SCREENS=./screens npx playwright test e2e/screens.spec.ts
const OUT = process.env.SCREENS;

test("design tour", async ({ browser }) => {
  test.skip(!OUT, "set SCREENS=<dir> to capture the design tour");
  test.setTimeout(300_000);
  const shot = async (page: Page, name: string, fullPage = false) => {
    await page.waitForTimeout(500); // let entrance animations settle
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
  };

  const host = await newPage(browser);
  await host.goto("/");
  await host.waitForLoadState("networkidle");
  await shot(host, "01-home", true);

  await host.goto("/create");
  await host.waitForLoadState("networkidle");
  const cards = host.getByRole("button").filter({ hasText: "@" });
  await cards.nth(0).click();
  await cards.nth(1).click();
  await shot(host, "02-create-games");
  await host.getByRole("button", { name: /Continue with/ }).click();
  await shot(host, "03-create-rules");
  await host.goto("/");

  const code = await createTournament(host, 2);
  await waitForOdds(host);
  await shot(host, "04-lobby-host", true);

  const anon = await newPage(browser);
  await anon.goto(`/join/${code}`);
  await anon.waitForLoadState("networkidle");
  await shot(anon, "05-join");

  const gina = await newPage(browser);
  await joinAs(gina, code, "Gina");
  const kyle = await newPage(browser);
  await joinAs(kyle, code, "Kyle");

  const odds = (page: Page, game: number, i: number) =>
    page.locator("article").nth(game).locator("button[data-odds-id]").nth(i);
  await odds(gina, 0, 3).click();
  await odds(gina, 1, 2).click();
  await gina.getByRole("button", { name: /Bet slip/ }).click();
  await shot(gina, "06-slip-singles");
  await gina.getByRole("tab", { name: /Parlay/ }).click();
  await gina.getByLabel("Parlay stake").fill("10");
  await shot(gina, "07-slip-parlay");
  // Fake odds drift every 10 minutes: accept a moved price if the tour straddles one.
  const accept = gina.getByRole("button", { name: "Accept new odds" });
  if (await accept.isVisible()) await accept.click();
  await gina.getByRole("button", { name: "Place bet · $10" }).click();
  if (await accept.waitFor({ timeout: 2_000 }).then(() => true, () => false)) {
    await accept.click();
    await gina.getByRole("button", { name: "Place bet · $10" }).click();
  }
  await expect(gina.getByText("Bet placed")).toBeVisible();

  await placeSingle(host, odds(host, 0, 0), 10);
  await placeSingle(kyle, odds(kyle, 0, 0), 20);
  await gina.getByRole("tab", { name: /My picks/ }).click();
  await shot(gina, "08-my-picks", true);

  await host.reload();
  await host.waitForLoadState("networkidle");
  await host.getByRole("button", { name: "Edit rules" }).click();
  await shot(host, "09-edit-rules");
  await host.getByRole("button", { name: "Cancel" }).click();
  await host.getByRole("button", { name: "Lock picks now" }).click();
  await shot(host, "10-lock-confirm");
  await host.getByRole("button", { name: "Lock & reveal" }).click();

  await expect(gina.getByRole("heading", { name: "Picks are in" })).toBeVisible({ timeout: 20_000 });
  await gina.waitForTimeout(300);
  await gina.screenshot({ path: `${OUT}/11-reveal-moment.png` });
  await gina.waitForTimeout(2600);
  await shot(gina, "12-reveal-leaderboard", true);
  await openPlayerBets(gina, "Gina");
  await openPicksByGame(gina);
  await shot(gina, "13-reveal-open", true);
});
