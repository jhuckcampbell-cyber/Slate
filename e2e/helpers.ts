import { expect, test, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Requires: local Supabase (+ seed) and `npx supabase functions serve` (odds-sync, fake provider).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

/** Host flow: pick the first `games` games, create, land in the lobby. Returns the invite code. */
export async function createTournament(page: Page, games: number, hostName = "Hank", onlyTeam?: string) {
  await page.goto("/create");
  await page.waitForLoadState("networkidle");
  // onlyTeam: pick that team's game instead of trusting it to be the earliest card (seed games move).
  const cards = page.getByRole("button").filter({ hasText: onlyTeam ?? "@" });
  for (let i = 0; i < games; i++) {
    await cards.nth(i).click();
    await expect(page.getByRole("button", { name: new RegExp(`Continue with ${i + 1} game`) })).toBeVisible();
  }
  await page.getByRole("button", { name: /Continue with/ }).click();
  await page.getByLabel("Your name").fill(hostName);
  await page.getByRole("button", { name: /Create & get invite link/ }).click();
  await page.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** A page in its own browser context (= a different person, no shared session). */
export async function newPage(browser: Browser, options?: BrowserContextOptions) {
  const context = await browser.newContext(options);
  opened.push(context);
  return context.newPage();
}

// Every spec shares one browser per worker; contexts left open pile up (dozens of live pages polling and
// holding Realtime sockets) and slow later specs to a crawl. Close each test's people when it ends.
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close().catch(() => {})));
});

/** Join by invite link as a brand-new guest. */
export async function joinAs(page: Page, code: string, name: string) {
  await page.goto(`/join/${code}`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "I'm in" }).click();
  await page.waitForURL(`**/t/${code}`);
  return page;
}

export async function waitForOdds(page: Page) {
  // Nudge the sync instead of waiting for the next cron minute (a held lease is fine: cron covers it).
  await page.request
    .post(`${SUPABASE_URL}/functions/v1/odds-sync`, {
      headers: { "x-sync-secret": process.env.ODDS_SYNC_SECRET ?? "local-dev-sync-secret" },
    })
    .catch(() => undefined);
  await expect(page.locator('article button[aria-pressed="false"]').first()).toBeEnabled({ timeout: 90_000 });
}

/**
 * Press "Place bet" and wait for the confirmation. The fake provider moves prices every 10 minutes,
 * so a bet can straddle a move: the slip then asks to accept the new odds (by design), and we do.
 */
export async function placeBet(page: Page, dollars: number) {
  const place = page.getByRole("button", { name: `Place bet · $${dollars}` });
  const accept = page.getByRole("button", { name: "Accept new odds" });
  const placed = page.getByText("Bet placed");
  await place.click();
  // Done = the slip empties (its button goes away). An earlier "Bet placed" toast may still be on screen,
  // so the toast alone doesn't prove THIS bet went through.
  await expect(async () => {
    if (await accept.isVisible()) return;
    await expect(place).toBeHidden({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
  if (await accept.isVisible()) {
    await accept.click();
    await place.click();
    await expect(place).toBeHidden();
  }
  await expect(placed.first()).toBeVisible();
}

/** Tap an odds button and place it as a single. */
export async function placeSingle(page: Page, pick: ReturnType<Page["locator"]>, dollars: number) {
  await pick.click();
  await page.getByRole("button", { name: /Bet slip/ }).click();
  await page.getByLabel(/^Stake on/).fill(String(dollars));
  await placeBet(page, dollars);
}

export async function tournamentId(code: string) {
  const { data, error } = await admin.from("tournaments").select("id").eq("code", code).single();
  if (error) throw error;
  return data.id as string;
}

/** After lock: tap a player's leaderboard row to drop down their bets. */
export async function openPlayerBets(page: Page, name: string) {
  const row = page.getByRole("listitem", { name: new RegExp(`^\\d+\\. ${name}`) });
  await row.locator("summary").click();
  return row;
}

/** After lock: open the "Picks are in" dropdown (what everyone's on, by game). */
export async function openPicksByGame(page: Page) {
  await page.getByRole("heading", { name: "Picks are in" }).click();
}
