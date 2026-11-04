import { expect, test } from "@playwright/test";

// Installable web app: the manifest and icons are served, iPhone Safari gets the
// "Add to Home Screen" tip, and dismissing it sticks.
test("installable: manifest, icons, and a dismissible home-screen tip", async ({ page, request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons as { src: string }[]) {
    const img = await request.get(icon.src);
    expect(img.ok(), icon.src).toBe(true);
    expect(img.headers()["content-type"]).toBe("image/png");
  }

  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/);

  const tip = page.getByRole("complementary", { name: "Install Slate" });
  await expect(tip).toContainText("Add to Home Screen");
  await tip.getByRole("button", { name: "Dismiss" }).click();
  await expect(tip).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Install Slate" })).toHaveCount(0);
});
