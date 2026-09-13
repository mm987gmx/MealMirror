import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createAdminClient, createTestUser, deleteTestUser } from "@/lib/test-support/supabase-test-client";
import { buildSessionCookies } from "@/lib/test-support/api-context";

const DEFER_CONFLICT_MESSAGE = "This check-in was already resolved elsewhere — please refresh and try again.";

async function authenticate(context: BrowserContext, cookies: { name: string; value: string }[]) {
  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: "http://localhost:4321" })));
}

async function logMeal(page: Page, description: string) {
  await page.goto("/dashboard");
  await page.getByLabel("What did you eat?").fill(description);
  await page.getByRole("button", { name: "Log meal" }).click();
  await page.waitForURL(/\/dashboard/);
}

test.describe("collision/defer concurrency (test-plan.md Risk #2)", () => {
  test("the friendly error is visible in the DOM when two tabs defer the same collision at once", async ({
    browser,
  }) => {
    const admin = createAdminClient();
    const user = await createTestUser(admin);

    try {
      const cookies = await buildSessionCookies(user.email, user.password);

      const context1 = await browser.newContext();
      const context2 = await browser.newContext();
      await authenticate(context1, cookies);
      await authenticate(context2, cookies);

      const page1 = await context1.newPage();

      // Log meal 1, then meal 2 — meal 2 collides with meal 1's still-pending check-in.
      await logMeal(page1, "oatmeal");
      await logMeal(page1, "salad");
      await expect(page1.getByRole("heading", { name: "You already have a pending check-in" })).toBeVisible();

      // Tab 2 opens the same collision — both tabs are authenticated as the same user.
      const page2 = await context2.newPage();
      await page2.goto(page1.url());
      await expect(page2.getByRole("heading", { name: "You already have a pending check-in" })).toBeVisible();

      // Submit "Defer to this meal" from both tabs at effectively the same time.
      await Promise.all([
        Promise.all([
          page1.waitForURL(/\/dashboard/),
          page1.getByRole("button", { name: "Defer to this meal" }).click(),
        ]),
        Promise.all([
          page2.waitForURL(/\/dashboard/),
          page2.getByRole("button", { name: "Defer to this meal" }).click(),
        ]),
      ]);

      const errorOnPage1 = new URL(page1.url()).searchParams.get("error") !== null;
      const errorOnPage2 = new URL(page2.url()).searchParams.get("error") !== null;
      expect([errorOnPage1, errorOnPage2].filter(Boolean)).toHaveLength(1);

      const [losingPage, winningPage] = errorOnPage1 ? [page1, page2] : [page2, page1];
      // The message legitimately renders twice on the losing page (the
      // dashboard's top-level error banner and MealForm's own ServerError).
      await expect(losingPage.getByText(DEFER_CONFLICT_MESSAGE).first()).toBeVisible();
      await expect(winningPage.getByText(DEFER_CONFLICT_MESSAGE)).toHaveCount(0);

      await context1.close();
      await context2.close();
    } finally {
      await deleteTestUser(admin, user.id);
    }
  });
});
