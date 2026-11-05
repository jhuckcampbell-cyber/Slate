import { expect, test } from "@playwright/test";
import { createTournament, joinAs, newPage } from "./helpers";

// Getting around: every tournament screen has a Home button, and home lists the tournaments you're in.
test("Home button and 'Your tournaments' get you back into a tournament", async ({ browser }) => {
  const host = await newPage(browser);
  const code = await createTournament(host, 1);

  // A brand-new visitor has no list.
  const stranger = await newPage(browser);
  await stranger.goto("/");
  await expect(stranger.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(stranger.getByRole("region", { name: "Your tournaments" })).toHaveCount(0);

  const gina = await joinAs(await newPage(browser), code, "Gina");
  await gina.getByRole("link", { name: "Home", exact: true }).click();
  await gina.waitForURL((u) => u.pathname === "/");

  const mine = gina.getByRole("region", { name: "Your tournaments" });
  await expect(mine).toBeVisible();
  const card = mine.getByRole("link").filter({ hasText: code });
  await expect(card).toContainText("Open");
  if (process.env.SCREENS) await gina.screenshot({ path: `${process.env.SCREENS}/19-your-tournaments.png` });
  await card.click();
  await gina.waitForURL(`**/t/${code}`);
  await expect(gina.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  if (process.env.SCREENS) await gina.screenshot({ path: `${process.env.SCREENS}/20-lobby-home-button.png` });

  // The host sees it too, marked as theirs.
  await host.getByRole("link", { name: "Home", exact: true }).click();
  await expect(host.getByRole("region", { name: "Your tournaments" }).getByRole("link").filter({ hasText: code })).toContainText(
    "Host",
  );
});
