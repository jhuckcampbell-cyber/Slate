import { expect, test } from "@playwright/test";
import { waitForOdds } from "./helpers";

// Token mode allows separate submissions from one shared pool, preserving unchipped picks.
test("token mode: partial singles followed by a parlay", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/create");
  await page.waitForLoadState("networkidle");
  const cards = page.getByRole("button").filter({ hasText: "@" });
  await cards.nth(0).click();
  await cards.nth(1).click();
  await page.getByRole("button", { name: /Continue with 2 games/ }).click();
  await page.getByLabel("Your name").fill("Hank");
  await page.getByRole("radio", { name: /Tokens: \$25 \+ \$25 \+ \$50/ }).click();
  await expect(page.getByLabel("Max bet ($)")).toBeHidden(); // the tokens are the bet sizes
  await page.getByRole("button", { name: /Create & get invite link/ }).click();
  await page.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  await waitForOdds(page);

  // Parlay legs first (each game's home winner), then a spread from each game as singles.
  const first = page.locator("article").nth(0);
  const second = page.locator("article").nth(1);
  await first.getByRole("button", { pressed: false }).last().click();
  await second.getByRole("button", { pressed: false }).last().click();
  await first.getByRole("button", { pressed: false }).first().click();
  await second.getByRole("button", { pressed: false }).first().click();

  await page.getByRole("button", { name: /Your slip/ }).click();
  const slip = page.getByRole("dialog");
  await expect(slip.getByText("3 of 3 tokens left")).toBeVisible();

  const acceptAndPlace = async (name: RegExp) => {
    const accept = slip.getByRole("button", { name: "Accept new odds" });
    await expect(async () => {
      if (await accept.isVisible()) await accept.click();
      await expect(slip.getByRole("button", { name })).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await slip.getByRole("button", { name }).click();
    await expect(page.getByText("Bet placed", { exact: false })).toBeVisible({ timeout: 15_000 });
  };

  await slip.getByRole("button", { name: "$25 token", exact: true }).first().click();
  await expect(slip.getByText("Now tap a pick")).toBeVisible();
  await slip.getByRole("button", { name: /^Put \$25 on/ }).first().click();
  await expect(slip.getByRole("button", { name: /\$25 token, on/ })).toHaveCount(1);
  if (process.env.SCREENS) await page.screenshot({ path: process.env.SCREENS + "/14-slip-tokens-singles.png" });

  await acceptAndPlace(/^Place 1 bet \u00b7 \$25 \u00b7 3 stay on slip$/);
  await expect(slip.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  await expect(slip.getByText("2 of 3 tokens left")).toBeVisible();

  // A chip on a single stays occupied in parlay mode. A parlay chip also stays occupied in singles.
  await slip.getByRole("button", { name: "$25 token", exact: true }).click();
  await slip.getByRole("button", { name: /^Put \$25 on/ }).first().click();
  await slip.getByRole("tab", { name: "Parlay", exact: true }).click();
  await expect(slip.getByRole("button", { name: /\$25 token, on/ })).toBeDisabled();
  await slip.getByRole("button", { name: "$50 token", exact: true }).click();
  await slip.getByRole("button", { name: "Put $50 on the parlay", exact: true }).click();
  await slip.getByRole("tab", { name: "Singles", exact: true }).click();
  await expect(slip.getByRole("button", { name: "$50 token, on parlay", exact: true })).toBeDisabled();
  await slip.getByRole("tab", { name: "Parlay", exact: true }).click();
  await slip.getByRole("button", { name: "Take $50 off the parlay", exact: true }).click();
  await slip.getByRole("tab", { name: "Singles", exact: true }).click();

  await acceptAndPlace(/^Place 1 bet \u00b7 \$25 \u00b7 2 stay on slip$/);
  await expect(slip.getByRole("button", { name: /^Remove / })).toHaveCount(2);
  await expect(slip.getByText("1 of 3 tokens left")).toBeVisible();

  await slip.getByRole("tab", { name: "Parlay", exact: true }).click();
  await slip.getByRole("button", { name: "$50 token", exact: true }).click();
  await slip.getByRole("button", { name: "Put $50 on the parlay", exact: true }).click();
  if (process.env.SCREENS) await page.screenshot({ path: process.env.SCREENS + "/15-slip-tokens-parlay.png" });
  await acceptAndPlace(/^Place parlay \u00b7 \$50$/);
  await expect(slip).toBeHidden();

  await page.getByRole("tab", { name: /My picks/ }).click();
  await expect(page.getByText("2-leg parlay")).toBeVisible();
});
