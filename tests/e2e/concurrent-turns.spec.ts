import { expect, test } from "@playwright/test";

// Think serializes chat() calls per Durable Object. Two rapid sends queue
// behind each other, so this test only asserts the UI accepts both sends and
// optimistically renders them; the durable assistant follow-ups land in the
// living-thread spec.
test("two rapid sends both render optimistically without locking the composer", async ({ page, context }) => {
  test.setTimeout(60_000);
  const owner = `e2e-concurrent-${Date.now()}`;
  await context.addCookies([{ name: "loop-owner", value: owner, url: "http://127.0.0.1:5176" }]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "memory" })).toBeVisible({ timeout: 30_000 });

  const composer = page.getByPlaceholder(/message loop/);
  const sendButton = page.getByRole("button", { name: "send" });

  await composer.click();
  await composer.fill("first");
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  await composer.fill("second");
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  await expect(page.locator(".log article.user", { hasText: "first" })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".log article.user", { hasText: "second" })).toBeVisible({ timeout: 5_000 });
});
