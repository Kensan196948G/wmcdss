/**
 * E2E smoke tests — vite preview (static build, no backend required).
 *
 * initFromBackend() fails silently when there is no API server, so the app
 * renders with the deterministic static SITES data from data.ts throughout.
 * Navigation is state-based (useState<PageId>), not URL-based — all page
 * changes must be triggered by clicking sidebar items.
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Abort all backend API calls — initFromBackend() catches the error and renders
  // the app with static mock data immediately rather than waiting for a live server.
  await page.route('**/api/v1/**', route => route.abort());
});

test('sidebar renders with app title', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar-logo-text')).toContainText('気象海象判断支援');
});

test('dashboard shows site status cards on load', async ({ page }) => {
  await page.goto('/');
  // Static SITES array always has 6 entries — at least one badge must be visible.
  const badges = page.locator('.badge-ok, .badge-warn, .badge-danger');
  await expect(badges.first()).toBeVisible();
});

test('navigating to 気象データ updates header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('気象データ').click();
  await expect(page.locator('.header-title')).toContainText('気象データ');
});

test('navigating to 海上作業 shows marine work page', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('海上作業').click();
  await expect(page.locator('.header-title')).toContainText('海上作業');
});

test('returning to dashboard resets header title', async ({ page }) => {
  await page.goto('/');
  await page.locator('nav.sidebar').getByText('気象データ').click();
  await page.locator('nav.sidebar').getByText('ダッシュボード').click();
  await expect(page.locator('.header-title')).toContainText('ダッシュボード');
});
