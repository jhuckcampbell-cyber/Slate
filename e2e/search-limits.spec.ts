import { expect, test } from "@playwright/test";
import { admin, newPage, waitForOdds } from "./helpers";

// 2026-11-05: rules sit at the top of the tournament, a bet can't swallow the bankroll when the host wants several
// bets, and the player-props list is searchable and ordered by the line (not alphabetical).
const eventId = `e2e-search-${Date.now()}`;

test.afterAll(async () => {
  await admin.from("events").update({ commence_time: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", eventId);
});

test("rules lead the page, a slip must meet the minimum, and props are searchable and ordered", async ({ browser }) => {
  test.setTimeout(150_000);
  const { error } = await admin.from("events").insert({
    id: eventId,
    sport_key: "basketball_nba",
    sport_title: "NBA",
    home_team: "Searchville Owls",
    away_team: "Orderton Otters",
    commence_time: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  });
  expect(error).toBeNull();

  const host = await newPage(browser);
  await host.goto("/create");
  await host.waitForLoadState("networkidle");
  await host.getByRole("button").filter({ hasText: "@" }).first().click();
  await host.getByRole("button", { name: /Continue with 1 game/ }).click();
  await host.getByRole("switch", { name: "Player props" }).click();
  for (let i = 0; i < 3; i++) await host.getByRole("button", { name: "More minimum bets" }).click();
  await host.getByLabel("Your name").fill("Hank");
  await host.getByRole("button", { name: /Create & get invite link/ }).click();
  await host.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  await waitForOdds(host);

  // Rules come first: above the bankroll and the games.
  const rulesTop = (await host.getByRole("heading", { name: "Rules" }).boundingBox())!.y;
  const gamesTop = (await host.getByRole("tab", { name: "Games" }).boundingBox())!.y;
  expect(rulesTop).toBeLessThan(gamesTop);
  await expect(host.getByText("3+ bets")).toBeVisible();

  // Three bets are required: a slip with one can't be placed, and the slip says what's missing.
  await host.locator('article button[aria-pressed="false"]').first().click();
  await host.getByRole("button", { name: /Bet slip/ }).click();
  await host.getByLabel(/^Stake on/).fill("100");
  const slip = host.getByRole("dialog");
  await expect(slip.getByRole("button", { name: "Add 2 more picks to place" })).toBeDisabled();
  await expect(slip.getByRole("list", { name: "House rules for this slip" })).toContainText("1 of 3");
  await host.keyboard.press("Escape");

  // Props: search narrows the list.
  await host.getByRole("button", { name: /^Player props/ }).click();
  const overs = host.getByRole("button", { name: / Over [\d.]+ Pts / });
  await expect(overs.first()).toBeEnabled({ timeout: 60_000 });
  const labels = await overs.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  // (The order itself is unit-tested in prop-order.test.ts; here: every player is listed once.)
  const names = labels.map((l) => l.split(" Over ")[0]!);
  expect(new Set(names).size).toBe(names.length);

  const search = host.getByRole("searchbox", { name: /^Search players/ });
  const target = names[0]!.replace(/ \([^)]*\)$/, "");
  await search.fill(target.split(" ").pop()!.slice(0, 4).toUpperCase());
  await expect(host.getByRole("button", { name: new RegExp(`^${target}( \\([^)]*\\))? Over `) })).toBeVisible();
  await search.fill("zzzzqq");
  await expect(host.getByText(/No players match/)).toBeVisible();
  await host.getByRole("button", { name: "Clear search" }).click();
  await expect(overs.first()).toBeVisible();
});
