/**
 * E2E error-scenario tests — verifies graceful degradation when the backend
 * is unreachable (API aborted or 500) and auth-gate behavior for unauthenticated users.
 *
 * Design notes:
 *  - initFromBackend() completes BEFORE root.render() via .finally(), so
 *    window.BACKEND_STATUS is already set on first React render.
 *  - route.abort()  → fetch throws NetworkError → BACKEND_STATUS.ok = false / reason = 'unreachable'
 *  - route.fulfill(500) → fetch throws APIError → same fallback path
 *  - AuthStore uses localStorage key 'wmcdss_access_token'; empty storageState
 *    means isAuthenticated() returns false → LoginPage is shown.
 */
import { test, expect } from "@playwright/test";

// ── Backend-unreachable scenarios (authenticated) ────────────────────────────

test.describe("backend unreachable", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/**", (route) => route.abort());
  });

  test("app shows backend-unreachable alert banner when API is aborted", async ({
    page,
  }) => {
    await page.goto("/");
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("バックエンド未接続");
  });

  test("app renders dashboard with mock data when backend is unreachable", async ({
    page,
  }) => {
    await page.goto("/");
    // Dashboard stat cards should be visible from static mock data
    const statCards = page.locator(".stat-card");
    await expect(statCards).toHaveCount(4);
  });

  test("backend-unreachable banner warns against using data for decisions", async ({
    page,
  }) => {
    await page.goto("/");
    const alert = page.locator('[role="alert"]');
    await expect(alert).toContainText("施工判断には使用しないでください");
  });

  test("analysis page renders without crash when backend is unreachable", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("nav.sidebar").getByText("過去データ分析").click();
    await expect(page.locator(".header-title")).toContainText("過去データ分析");
    // Page must not crash — no error overlay
    await expect(page.locator('[role="alert"]')).toBeVisible();
  });

  test("data-fetch-status page renders without crash when backend is unreachable", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("nav.sidebar").getByText("データ取得状況").click();
    await expect(page.locator(".header-title")).toContainText("データ取得状況");
  });
});

// ── HTTP 500 error response ──────────────────────────────────────────────────

test.describe("backend HTTP 500", () => {
  test("API 500 response is handled gracefully without crash", async ({
    page,
  }) => {
    // fulfill with 500 so fetchJSON's !resp.ok branch fires
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"detail":"Internal Server Error"}',
      }),
    );
    await page.goto("/");
    // App must still render — either error banner or dashboard
    const body = page.locator("body");
    await expect(body).toBeVisible();
    // Sidebar nav must be present (app did not white-screen)
    await expect(page.locator("nav.sidebar")).toBeVisible();
  });
});

// ── Unauthenticated user scenarios ──────────────────────────────────────────

test.describe("unauthenticated", () => {
  // Override global storageState so localStorage is empty → AuthStore returns false
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/v1/**", (route) => route.abort());
  });

  test("unauthenticated user sees login page", async ({ page }) => {
    await page.goto("/");
    // LoginPage renders a <form> when no valid token in localStorage
    await expect(page.locator("form")).toBeVisible();
  });

  test("login form has username and password inputs", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("login form shows validation error when submitted empty", async ({
    page,
  }) => {
    await page.goto("/");
    // Submit without filling fields
    await page.locator("form").first().locator('button[type="submit"]').click();
    // Error div is a sibling to <form> in auth.tsx — search page-wide
    await expect(
      page.getByText("ユーザー名とパスワードを入力してください"),
    ).toBeVisible();
  });

  test("login form shows error when server is unreachable", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator('input[autocomplete="username"]').fill("testuser");
    await page.locator('input[type="password"]').first().fill("wrongpassword");
    await page.locator("form").first().locator('button[type="submit"]').click();
    // Error div is outside <form>; API abort → catch → 'サーバーに接続できません...'
    await expect(
      page.getByText("サーバーに接続できません", { exact: false }),
    ).toBeVisible();
  });
});
