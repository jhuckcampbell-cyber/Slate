import { expect, test } from "@playwright/test";
import { admin, createTournament, tournamentId } from "./helpers";

// Local SMTP: Inbucket on :54324; use local Turnstile test keys or disable CAPTCHA.
test("guest email confirmation preserves user, tournament and bankroll", async ({ page, request }) => {
  const mailbox = `auth-${Date.now()}`;
  const email = `${mailbox}@example.test`;
  const code = await createTournament(page, 1, "Email guest");
  const id = await tournamentId(code);
  const { data: before, error } = await admin.from("tournament_participants")
    .select("id, user_id, remaining_bankroll_cents").eq("tournament_id", id).single();
  if (error || !before) throw new Error("Guest participant fixture missing");
  await page.goto("/account");
  await page.getByLabel("Save your account", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send link", exact: true }).click();
  await expect(page.getByText(`Check ${email} for a link to save your account.`)).toBeVisible();
  let confirmation = "";
  await expect(async () => {
    const inbox = await request.get(`http://127.0.0.1:54324/api/v1/mailbox/${mailbox}`);
    expect(inbox.ok()).toBeTruthy();
    const messages = await inbox.json() as { id: string }[];
    expect(messages.length).toBeGreaterThan(0);
    const message = await request.get(`http://127.0.0.1:54324/api/v1/mailbox/${mailbox}/${messages.at(-1)!.id}`);
    const body = await message.json() as { body: { html: string; text: string } };
    confirmation = (body.body.html.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]
      ?? body.body.text.match(/https?:\/\/\S+\/auth\/v1\/verify\S+/)?.[0] ?? "").replaceAll("&amp;", "&");
    expect(confirmation).not.toBe("");
  }).toPass({ timeout: 30_000 });
  await page.goto(confirmation);
  await page.waitForURL("**/account");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  const { data: after } = await admin.from("tournament_participants")
    .select("id, user_id, remaining_bankroll_cents").eq("tournament_id", id).single();
  expect(after).toEqual(before);
  const { data: user } = await admin.auth.admin.getUserById(before.user_id);
  expect(user.user?.is_anonymous).toBe(false);
  expect(user.user?.email_confirmed_at).toBeTruthy();
  await expect(page.getByRole("link", { name: new RegExp(code) })).toBeVisible();
});
