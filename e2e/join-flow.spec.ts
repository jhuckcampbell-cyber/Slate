import { expect, test } from "@playwright/test";

// Requires local Supabase running with seed data (`npx supabase db reset`).
test("host creates a tournament, guest joins via invite link in <15s", async ({ browser }) => {
  // ---- Host ----
  const hostCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  await host.goto("/create");
  await host.waitForLoadState("networkidle"); // let React hydrate before tapping
  await host.getByRole("button", { pressed: false }).filter({ hasText: "@" }).first().click();
  await host.getByRole("button", { name: /Continue with 1 game/ }).click();
  await host.getByLabel("Your name").fill("Hank");
  await host.getByRole("button", { name: /Create & get invite link/ }).click();

  await host.waitForURL(/\/t\/[A-Z0-9]{2,5}-[A-Z0-9]{4}\?created=1/);
  const code = new URL(host.url()).pathname.split("/").pop()!;
  await expect(host.getByText("You're the host.")).toBeVisible();
  await expect(host.getByRole("button", { name: /Invite the squad/ })).toBeVisible();

  // ---- Guest (fresh browser, no session) ----
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  const started = Date.now();
  await guest.goto(`/join/${code}`);
  await guest.waitForLoadState("networkidle");
  await expect(guest.getByText("Hank", { exact: true })).toBeVisible(); // "Hank invited you to"
  await guest.getByLabel("Your name").fill("Gina");
  await guest.getByRole("button", { name: "I'm in" }).click();
  await guest.waitForURL(`**/t/${code}`);
  await expect(guest.getByText("Gina (you)")).toBeVisible();
  const elapsed = Date.now() - started;
  expect(elapsed, `join took ${elapsed}ms`).toBeLessThan(15_000);

  // Roster shows both; guest is not offered host share panel.
  await expect(guest.getByText("Squad · 0/2 locked in")).toBeVisible();
  await expect(guest.getByRole("listitem").filter({ hasText: "Hank" })).toBeVisible();

  // ---- Share preview (OG) ----
  // Signed-out context = what iMessage's link crawler sees.
  const anonCtx = await browser.newContext();
  const anon = await anonCtx.newPage();
  await anon.goto(`/join/${code}`);
  const ogUrl = await anon.locator('meta[property="og:image"]').getAttribute("content");
  expect(ogUrl).toBeTruthy();
  const res = await anon.request.get(ogUrl!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  await anonCtx.close();

  await hostCtx.close();
  await guestCtx.close();
});

test("unknown invite code shows not found", async ({ page }) => {
  // Streamed page (Cache Components), so we assert the UI rather than the HTTP status.
  await page.goto("/join/ZZ-2222");
  await expect(page.getByRole("heading", { name: "No tournament with that code" })).toBeVisible();
});
