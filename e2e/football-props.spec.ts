import { expect, test } from "@playwright/test";
import { fakePlayer } from "../supabase/functions/_shared/fake-provider";
import { admin, joinAs, newPage, placeBet, placeSingle, waitForOdds } from "./helpers";

// Football props: players grouped under their team, an alternate-yards milestone and an anytime TD are
// bet (plus a same-game parlay), then ONE yards entry grades the ladder and a touchdowns entry grades the TD.
const eventId = `e2e-fbprops-${Date.now()}`;
const HOME = "Gridiron Hawks";
const AWAY = "Endzone Foxes";
const SHOTS = process.env.SCREENS;

test.afterAll(async () => {
  await admin.from("events").update({ commence_time: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", eventId);
});

test("football: team-grouped props, alternate yards and anytime TD, graded by the host", async ({ browser }) => {
  test.setTimeout(180_000);

  const { error } = await admin.from("events").insert({
    id: eventId,
    sport_key: "americanfootball_nfl",
    sport_title: "NFL",
    home_team: HOME,
    away_team: AWAY,
    commence_time: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  });
  expect(error).toBeNull();
  // Rosters for the fake provider's made-up players (in production these come from Sleeper).
  const roster = [AWAY, HOME].flatMap((team) => [0, 1, 2].map((slot) => ({ name: fakePlayer(team, slot), team })));
  expect((await admin.rpc("rosters_ingest", { p_sport_key: "americanfootball_nfl", p_players: roster })).error).toBeNull();

  const host = await newPage(browser);
  await host.goto("/create");
  await host.waitForLoadState("networkidle");
  await host.getByRole("button", { name: /NFL/ }).first().click();
  await host.getByRole("button").filter({ hasText: AWAY }).first().click();
  await host.getByRole("button", { name: /Continue with 1 game/ }).click();
  await host.getByRole("switch", { name: "Player props" }).click();
  await host.getByLabel("Your name").fill("Hank");
  await host.getByRole("button", { name: /Create & get invite link/ }).click();
  await host.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  const code = new URL(host.url()).pathname.split("/").pop()!;
  await waitForOdds(host);

  // Who plays for whom: the board groups players under their team.
  await host.getByRole("button", { name: /^Player props/ }).click();
  // Receptions (catches) are a prop tab too: over/under on a pass catcher, never the quarterback.
  await host.getByRole("button", { name: "Receptions", exact: true }).click();
  await expect(host.getByRole("button", { name: / Over [\d.]+ Rec / }).first()).toBeEnabled({ timeout: 60_000 });
  await expect(host.getByRole("button", { name: new RegExp(`^${fakePlayer(AWAY, 0)}.* Over `) })).toHaveCount(0);
  await host.getByRole("button", { name: "Alt rushing yards" }).click();
  const rb = fakePlayer(AWAY, 1); // slot 0 is the QB (passing only); 1-2 run the ball
  // Labels name the team too ("Malik Reed (Foxes) 57+ Rush Yds"), here and in the slip, My picks, reveal.
  const milestone = host.getByRole("button", { name: new RegExp(`^${rb} \\(Foxes\\) \\d+\\+ Rush Yds`) }).first();
  await expect(milestone).toBeEnabled({ timeout: 60_000 });
  const props = host.getByRole("list").filter({ has: milestone });
  await expect(props.getByRole("listitem").filter({ hasText: /^Foxes$/ })).toBeVisible();
  await expect(props.getByRole("listitem").filter({ hasText: /^Hawks$/ })).toBeVisible();
  if (SHOTS) await host.screenshot({ path: `${SHOTS}/18-football-props.png`, fullPage: true });
  await placeSingle(host, milestone, 10); // the lowest milestone

  const gina = await newPage(browser);
  await joinAs(gina, code, "Gina");
  await gina.getByRole("button", { name: /^Player props/ }).click();
  await gina.getByRole("button", { name: "Anytime TD" }).click();
  const scorer = fakePlayer(HOME, 1);
  const td = new RegExp(`^${scorer} \\(Hawks\\) Anytime TD`);
  await placeSingle(gina, gina.getByRole("button", { name: td }), 20);

  // Same-game parlay (on by default): Foxes moneyline + the same scorer, both from this one game.
  await gina.getByRole("button", { name: /^Foxes to win / }).click();
  await gina.getByRole("button", { name: td }).click();
  await gina.getByRole("button", { name: /Bet slip/ }).click();
  await gina.getByRole("tab", { name: /Parlay \(2\)/ }).click();
  await gina.getByLabel("Parlay stake").fill("5");
  await placeBet(gina, 5);
  await gina.getByRole("tab", { name: /My picks/ }).click();
  await expect(gina.getByText("2-leg parlay")).toBeVisible();
  await expect(gina.getByText(td).first()).toBeVisible(); // My picks names the team too

  await host.getByRole("button", { name: "Lock picks now" }).click();
  await host.getByRole("button", { name: "Lock & reveal" }).click();
  await expect(host.getByRole("heading", { name: "Picks are in" })).toBeVisible({ timeout: 20_000 });
  await admin.rpc("scores_ingest", {
    p_sport_key: "americanfootball_nfl",
    p_fetched_at: new Date().toISOString(),
    p_scores: [{ event_id: eventId, completed: true, home_score: 24, away_score: 17 }],
  });
  await admin.from("events").update({ commence_time: new Date(Date.now() - 4 * 3_600_000).toISOString() }).eq("id", eventId);

  // The ladder is graded by the plain rushing-yards stat; the TD pick by touchdowns scored.
  await host.reload();
  const yards = host.getByLabel(`${rb} Rushing yards stat`);
  await expect(yards).toBeVisible({ timeout: 30_000 });
  await yards.fill("250");
  await yards.locator("xpath=ancestor::form").getByRole("button", { name: "Enter" }).click();
  await expect(host.getByText(`${rb} Rushing yards: 250. Picks graded.`)).toBeVisible();
  const tds = host.getByLabel(`${scorer} Touchdowns scored stat`);
  await tds.fill("0");
  await tds.locator("xpath=ancestor::form").getByRole("button", { name: "Enter" }).click();

  await expect(gina.getByRole("heading", { name: "Final standings" })).toBeVisible({ timeout: 30_000 });
  await expect(gina.getByText("Hank wins")).toBeVisible();
});
