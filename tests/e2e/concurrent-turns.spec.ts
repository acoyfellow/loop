import { expect, test } from "@playwright/test";

test("two rapid sends each persist as ledger turns and show in the transcript", async ({ page, context }) => {
  test.setTimeout(240_000);
  const owner = `e2e-concurrent-${Date.now()}`;
  await context.addCookies([{ name: "loop-owner", value: owner, url: "http://127.0.0.1:5176" }]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "memory" })).toBeVisible({ timeout: 30_000 });

  const composer = page.getByPlaceholder(/message loop/);
  const sendButton = page.getByRole("button", { name: "send" });

  const firstPhrase = `first-${owner}`;
  const secondPhrase = `second-${owner}`;
  const tag = (phrase: string) => `Reply only with the exact token ${phrase}.`;

  await composer.click();
  await composer.fill(tag(firstPhrase));
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // Composer is free immediately; queue a second send while the first is still in flight.
  await composer.fill(tag(secondPhrase));
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  await expect(page.locator(".log").getByText(tag(firstPhrase))).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".log").getByText(tag(secondPhrase))).toBeVisible({ timeout: 5_000 });

  await expect(page.locator(".log article", { hasText: firstPhrase }).filter({ has: page.locator("pre", { hasNotText: tag(firstPhrase) }) })).toHaveCount(1, { timeout: 180_000 });
  await expect(page.locator(".log article", { hasText: secondPhrase }).filter({ has: page.locator("pre", { hasNotText: tag(secondPhrase) }) })).toHaveCount(1, { timeout: 180_000 });
});
