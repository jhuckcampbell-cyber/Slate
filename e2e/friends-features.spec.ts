import { expect, test } from "@playwright/test";
import { joinAs, newPage, waitForOdds } from "./helpers";

// 2026-11-05 batch: house rules (bet it all, minimum bets) with a live checklist, the plain-English explainer,
// odds as percentages (Settings), the tournament switcher, leaving, and deleting.
test("house rules, explainer, % odds, switcher, leave and delete", async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await newPage(browser);
  await host.goto("/create");
  await host.waitForLoadState("networkidle");
  await host.getByRole("button").filter({ hasText: "@" }).first().click();
  await host.getByRole("button", { name: /Continue with 1 game/ }).click();
  await host.getByRole("switch", { name: "Bet the whole bankroll" }).click();
  await host.getByRole("button", { name: "More minimum bets" }).click();
  await host.getByRole("button", { name: "More minimum bets" }).click();
  await expect(host.getByRole("status", { name: "Minimum bets" })).toHaveText("2");
  await host.getByLabel("Your name").fill("Hank");
  await host.getByRole("button", { name: /Create & get invite link/ }).click();
  await host.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  const code = new URL(host.url()).pathname.split("/").pop()!;
  await waitForOdds(host);

  // The checklist says what's left, and keeps up as you bet.
  const checklist = host.getByRole("list", { name: "House rules" });
  await expect(checklist).toContainText("$100 left to bet");
  await expect(checklist).toContainText("0 of 2");
  // The slip can't be placed until it meets every house rule (2026-11-08: friends were ranked last for a slip
  // the app had accepted).
  await host.locator('article button[aria-pressed="false"]').first().click();
  await host.getByRole("button", { name: /Bet slip/ }).click();
  const slip = host.getByRole("dialog");
  await slip.getByLabel(/^Stake on/).fill("40");
  await expect(slip.getByRole("button", { name: "Add 1 more pick to place" })).toBeDisabled();
  await expect(slip.getByRole("list", { name: "House rules for this slip" })).toContainText("1 of 2");
  await host.keyboard.press("Escape");
  await host.locator('article button[aria-pressed="false"]').first().click();
  await host.getByRole("button", { name: /Bet slip/ }).click();
  await expect(slip.getByRole("button", { name: "Enter a stake" })).toBeDisabled();
  await slip.getByLabel(/^Stake on/).nth(1).fill("20");
  await expect(slip.getByRole("button", { name: "Bet $40 more to place" })).toBeDisabled();
  await slip.getByRole("button", { name: "Bet it all" }).click(); // $50 + $50, exactly the bankroll
  await slip.getByRole("button", { name: "Place 2 bets · $100" }).click();
  await expect(slip.getByRole("button", { name: /Place 2 bets/ })).toBeHidden({ timeout: 15_000 });
  await expect(checklist).toContainText("All in");
  await expect(checklist).toContainText("2 of 2");

  // Plain-English explainer behind the title.
  await host.getByRole("button", { name: /How it works/ }).click();
  const sheet = host.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "What is this?" })).toBeVisible();
  await expect(sheet).toContainText("You're hosting a betting game");
  await expect(sheet).toContainText("Bet your whole $100 before picks lock.");
  await sheet.getByRole("button", { name: "Got it" }).click();

  // Settings: odds default to a chance to win; "Classic odds" is opt-in.
  const price = host.locator('article button[aria-pressed="false"]').first();
  await expect(price).toContainText("%");
  await host.getByRole("button", { name: "Settings" }).click();
  await host.getByRole("radio", { name: "Classic odds" }).click();
  await host.keyboard.press("Escape");
  await expect(price).not.toContainText("%");
  await host.reload(); // sticks on this phone
  await expect(host.locator('article button[aria-pressed="false"]').first()).not.toContainText("%");

  // A friend joins by accident and leaves; they're out of the squad and it's gone from their home screen.
  const gina = await joinAs(await newPage(browser), code, "Gina");
  await gina.getByRole("button", { name: "Switch tournament" }).click();
  await expect(gina.getByRole("dialog").getByRole("link").filter({ hasText: code })).toBeVisible();
  await gina.keyboard.press("Escape");
  await gina.getByRole("button", { name: "Leave tournament" }).click();
  await gina.getByRole("dialog").getByRole("button", { name: "Leave", exact: true }).click();
  await gina.waitForURL((u) => u.pathname === "/");
  await expect(gina.getByRole("link").filter({ hasText: code })).toHaveCount(0);
  await host.reload();
  await host.waitForLoadState("networkidle"); // hydrated, so the next tap works
  await expect(host.getByRole("region", { name: /Squad/ }).getByText("Gina")).toHaveCount(0);

  // The host deletes it: gone from home, the invite stops working.
  await host.getByRole("button", { name: "Delete tournament" }).click();
  await host.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await host.waitForURL((u) => u.pathname === "/");
  await expect(host.getByRole("link").filter({ hasText: code })).toHaveCount(0);
  await gina.goto(`/join/${code}`);
  await expect(gina.getByText(/No tournament|not found|doesn't exist/i).first()).toBeVisible();
});
