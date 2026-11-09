import { expect, test } from "@playwright/test";
import { waitForOdds } from "./helpers";

// Token mode: $25 + $25 + $50 tokens, one per bet, all used. "Parlay + singles" puts a parlay on one token and
// singles on the rest in a single submit (a lone parlay would leave tokens unused).
test("token mode: parlay on the $50 token + two $25 singles in one go", async ({ page }) => {
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

  await page.getByRole("button", { name: /Bet slip/ }).click();
  const slip = page.getByRole("dialog");
  await slip.getByRole("tab", { name: "Parlay + singles" }).click();
  // Every pick starts in the parlay: take the two spreads out.
  await slip.getByRole("button", { name: "In parlay" }).nth(2).click();
  await slip.getByRole("button", { name: "In parlay" }).nth(2).click();
  await expect(slip.getByText("2-leg parlay")).toBeVisible();

  await slip.getByRole("radiogroup", { name: "Parlay stake" }).getByRole("radio", { name: "$50 token" }).click();
  // A parlay alone leaves the $25s unused: the slip says so instead of letting it through.
  await expect(slip.getByRole("button", { name: /Pick a token for every bet/ })).toBeDisabled();
  for (const n of [0, 1]) {
    await slip.getByRole("radiogroup", { name: /^Stake on/ }).nth(n).getByRole("radio", { name: "$25 token" }).first().click();
  }

  if (process.env.SCREENS) await page.screenshot({ path: `${process.env.SCREENS}/14-slip-tokens-mixed.png` });

  const place = slip.getByRole("button", { name: "Place 3 bets · $100" });
  const accept = slip.getByRole("button", { name: "Accept new odds" });
  await expect(async () => {
    if (await accept.isVisible()) await accept.click();
    await expect(place).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await place.click();
  await expect(page.getByText("3 bets placed")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("tab", { name: /My picks/ }).click();
  await expect(page.getByText("2-leg parlay")).toBeVisible();
});
