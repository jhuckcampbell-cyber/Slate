import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamMark } from "../src/components/team-mark";
import { TEAMS, SPORT_LEAGUES } from "../src/lib/teams/registry";

import { expect, test, type Page } from "@playwright/test";
import { createTournament, expectRevealed, joinAs, newPage, openPlayerBets, placeSingle, showTab, waitForOdds } from "./helpers";

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

  await expectRevealed(gina, 20_000);
  await gina.waitForTimeout(300);
  await gina.screenshot({ path: `${OUT}/11-reveal-moment.png` });
  await gina.waitForTimeout(2600);
  await shot(gina, "12-reveal-leaderboard", true);
  await openPlayerBets(gina, "Gina");
  await shot(gina, "13-reveal-open", true);
  await gina.getByRole("button", { name: "What does this % mean?" }).first().click();
  await shot(gina, "13b-chance-info", true);
  await showTab(gina, "Games");
  await shot(gina, "13c-games-tab", true);
});


test("team mark gallery", async ({ page }) => {
  test.skip(!OUT, "set SCREENS=<dir> to capture the team mark gallery");
  await page.setViewportSize({ width: 375, height: 812 });
  const examples = [
    ...TEAMS.map(t => ({ team: t.name, sportKey: Object.keys(SPORT_LEAGUES).find(k => SPORT_LEAGUES[k] === t.league)! })),
    { team: "Unknown college team", sportKey: "basketball_ncaab" },
    { team: "Unknown team", sportKey: "unknown" },
  ];
  const rows = examples.map(({ team, sportKey }) => renderToStaticMarkup(createElement("div", { className: "team" },
    createElement(TeamMark, { team, sportKey }), createElement("span", null, team)))).join("");
  await page.setContent(`<html><head><style>
    body { margin: 0; padding: 16px; background: #fff; color: #181a21; font: 14px system-ui; }
    h1 { font-size: 24px; } .team { display: flex; gap: 12px; align-items: center; min-height: 44px; }
    svg { width: 32px; height: 32px; flex-shrink: 0; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 8px; font-size: 11px; }
  </style></head><body><h1>Team marks</h1><div class="grid">${rows}</div></body></html>`);
  await expect(page.locator("svg")).toHaveCount(examples.length);
  await page.screenshot({ path: `${OUT}/14-team-mark-gallery.png`, fullPage: true });
});

test("token slip design tour", async ({ page }) => {
  test.skip(!OUT, "set SCREENS=<dir> to capture the token slip");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/create");
  await page.waitForLoadState("networkidle");
  const cards = page.getByRole("button").filter({ hasText: "@" });
  await cards.nth(0).click();
  await cards.nth(1).click();
  await page.getByRole("button", { name: /Continue with 2 games/ }).click();
  await page.getByLabel("Your name").fill("Hank");
  await page.getByRole("radio", { name: /Tokens: \$25 \+ \$25 \+ \$50/ }).click();
  await page.getByRole("button", { name: /Create & get invite link/ }).click();
  await page.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  await waitForOdds(page);
  await page.locator("article").nth(0).getByRole("button", { pressed: false }).last().click();
  await page.locator("article").nth(1).getByRole("button", { pressed: false }).last().click();
  await page.getByRole("button", { name: /Your slip/ }).click();
  const slip = page.getByRole("dialog");
  await slip.getByRole("button", { name: "$25 token", exact: true }).first().click();
  await slip.getByRole("button", { name: /^Put \$25 on/ }).first().click();
  await page.screenshot({ path: OUT + "/14-slip-tokens-singles.png" });
  await slip.getByRole("tab", { name: "Parlay", exact: true }).click();
  await slip.getByRole("button", { name: "$50 token", exact: true }).click();
  await slip.getByRole("button", { name: "Put $50 on the parlay", exact: true }).click();
  await page.screenshot({ path: OUT + "/15-slip-tokens-parlay.png" });
});
