import { expect, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Requires: local Supabase (+ seed) and `npx supabase functions serve` (odds-sync, fake provider).
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
});

/** Host flow: pick the first `games` games, create, land in the lobby. Returns the invite code. */
export async function createTournament(page: Page, games: number, hostName = "Hank") {
  await page.goto("/create");
  await page.waitForLoadState("networkidle");
  const cards = page.getByRole("button").filter({ hasText: "@" });
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
export async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

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

/** Tap an odds button and place it as a single. */
export async function placeSingle(page: Page, pick: ReturnType<Page["locator"]>, dollars: number) {
  await pick.click();
  await page.getByRole("button", { name: /Bet slip/ }).click();
  await page.getByLabel(/^Stake on/).fill(String(dollars));
  await page.getByRole("button", { name: `Place bet · $${dollars}` }).click();
  await expect(page.getByText("Bet placed")).toBeVisible();
}

export async function tournamentId(code: string) {
  const { data, error } = await admin.from("tournaments").select("id").eq("code", code).single();
  if (error) throw error;
  return data.id as string;
}
