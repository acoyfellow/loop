import { expect, test } from "@playwright/test";

test("real model creates a surface, remembers a convention, and survives reload", async ({ page, context }) => {
  test.setTimeout(240_000);
  const phrase = `cyan-${Date.now()}`;
  await context.addCookies([{ name: "loop-owner", value: `e2e-${phrase}`, url: "http://127.0.0.1:5176" }]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "memory" })).toBeVisible({ timeout: 30_000 });

  const composer = page.getByPlaceholder(/message loop/);
  await composer.click();
  await composer.fill(
    `Create a new panel id status-${phrase} titled Status ${phrase}. It must visibly render the exact text ${phrase}. Also remember this stable preference exactly: ${phrase} means a running experiment.`,
  );
  await composer.dispatchEvent("input");
  const sendButton = page.getByRole("button", { name: "send" });
  await expect(sendButton).toBeEnabled({ timeout: 5_000 });
  await sendButton.click();

  await page.getByRole("button", { name: "runtime" }).click();
  await expect(page.getByText(`status-${phrase}`, { exact: true })).toBeVisible({ timeout: 180_000 });
  const matchingFrame = page.locator(".mount", { hasText: `status-${phrase}` }).locator("iframe");
  await expect(matchingFrame.contentFrame().getByText(phrase, { exact: false })).toBeVisible({ timeout: 30_000 });

  await page.locator(".mount", { hasText: `status-${phrase}` }).getByRole("button", { name: "source" }).click();
  await expect(page.locator(".editor pre")).toContainText(phrase);
  await page.getByRole("button", { name: "memory" }).click();
  await expect(page.locator(".records").getByText(new RegExp(`${phrase} means a running experiment`, "i")).first()).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "runtime" }).click();
  await expect(page.getByText(`status-${phrase}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "memory" }).click();
  await expect(page.locator(".records").getByText(new RegExp(`${phrase} means a running experiment`, "i")).first()).toBeVisible();
});
