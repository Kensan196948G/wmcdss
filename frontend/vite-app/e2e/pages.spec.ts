/**
 * E2E page-navigation tests — verifies that each major page renders
 * the expected header title when navigated to via the sidebar.
 *
 * All /api/v1/ requests are aborted so no backend is required.
 * Auth is pre-populated via storageState (e2e/auth-state.json).
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
});

// ── Navigation & header title checks ────────────────────────────────────────

test('navigating to 現場一覧 shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('現場一覧').click();
  await expect(page.locator('.header-title')).toContainText('現場一覧');
});

test('navigating to 気象データ shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('気象データ').click();
  await expect(page.locator('.header-title')).toContainText('気象データ');
});

test('navigating to 海象データ shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('海象データ').click();
  await expect(page.locator('.header-title')).toContainText('海象データ');
});

test('navigating to コンクリート打設 shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('コンクリート打設').click();
  await expect(page.locator('.header-title')).toContainText('コンクリート打設判定');
});

test('navigating to 海上作業 shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('海上作業').click();
  await expect(page.locator('.header-title')).toContainText('海上作業判定');
});

test('navigating to 閾値管理 shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('閾値管理').click();
  await expect(page.locator('.header-title')).toContainText('閾値管理');
});

test('navigating to 設定 shows correct header title', async ({ page }) => {
  await page.goto('/');
  // exact: true avoids matching 'AI設定・管理' which also contains '設定'
  await page.locator('nav.sidebar').getByText('設定', { exact: true }).click();
  await expect(page.locator('.header-title')).toContainText('設定');
});

test('navigating to 過去データ分析 shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('過去データ分析').click();
  await expect(page.locator('.header-title')).toContainText('過去データ分析');
});

test('navigating to データ取得状況 shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('データ取得状況').click();
  await expect(page.locator('.header-title')).toContainText('データ取得状況');
});

test('navigating to 監査ログ shows correct header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('監査ログ').click();
  await expect(page.locator('.header-title')).toContainText('監査ログ');
});

// ── Sidebar active-state check ───────────────────────────────────────────────

test('active sidebar item reflects current page', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('気象データ').click();
  const activeItem = page.locator('nav.sidebar .sidebar-item.active');
  await expect(activeItem).toContainText('気象データ');
});
