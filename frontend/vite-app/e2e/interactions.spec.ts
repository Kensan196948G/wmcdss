/**
 * E2E interaction tests — verifies UI interactions beyond navigation:
 * role switching, stat cards, header badges, and dashboard content.
 *
 * All /api/v1/ requests are aborted so no backend is required.
 * Auth is pre-populated via storageState (e2e/auth-state.json).
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
});

// ── Dashboard stat cards ─────────────────────────────────────────────────────

test('dashboard renders four stat cards', async ({ page }) => {
  await page.goto('/');
  const statCards = page.locator('.stat-card');
  await expect(statCards).toHaveCount(4);
});

test('dashboard stat card 管理現場数 is visible with numeric value', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.stat-card').filter({ hasText: '管理現場数' });
  await expect(card).toBeVisible();
  const value = card.locator('.stat-value');
  await expect(value).toBeVisible();
});

test('dashboard stat card 施工可 is visible', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.stat-card').filter({ hasText: '施工可' });
  await expect(card).toBeVisible();
});

test('dashboard stat card 注意 is visible', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.stat-card').filter({ hasText: '注意' });
  await expect(card).toBeVisible();
});

test('dashboard stat card 中止推奨 is visible', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.stat-card').filter({ hasText: '中止推奨' });
  await expect(card).toBeVisible();
});

// ── Header status badges ─────────────────────────────────────────────────────

test('header shows status badges for 施工可 and 注意 and 中止', async ({ page }) => {
  await page.goto('/');
  const headerBadges = page.locator('.header-badge');
  // Three badges: 施工可 / 注意 / 中止
  await expect(headerBadges).toHaveCount(3);
});

// ── Role switching ───────────────────────────────────────────────────────────

test('role switch buttons are visible in sidebar', async ({ page }) => {
  await page.goto('/');
  const fieldBtn = page.locator('.role-btn').filter({ hasText: '現場' });
  const hqBtn = page.locator('.role-btn').filter({ hasText: '本社' });
  await expect(fieldBtn).toBeVisible();
  await expect(hqBtn).toBeVisible();
});

test('clicking 本社 role button makes it active', async ({ page }) => {
  await page.goto('/');
  const hqBtn = page.locator('.role-btn').filter({ hasText: '本社' });
  await hqBtn.click();
  await expect(hqBtn).toHaveClass(/active/);
});

test('switching back to 現場 role deactivates 本社', async ({ page }) => {
  await page.goto('/');
  const fieldBtn = page.locator('.role-btn').filter({ hasText: '現場' });
  const hqBtn = page.locator('.role-btn').filter({ hasText: '本社' });
  await hqBtn.click();
  await fieldBtn.click();
  await expect(fieldBtn).toHaveClass(/active/);
});

// ── App logo / branding ──────────────────────────────────────────────────────

test('sidebar logo shows WM abbreviation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar-logo-icon')).toContainText('WM');
});

test('sidebar logo sub-text shows Decision Support System', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.sidebar-logo-sub')).toContainText('Decision Support System');
});

// ── Header time display ──────────────────────────────────────────────────────

test('header displays current time', async ({ page }) => {
  await page.goto('/');
  const timeEl = page.locator('.header-time');
  await expect(timeEl).toBeVisible();
  // Time format: HH:MM (at minimum)
  await expect(timeEl).toHaveText(/\d{1,2}:\d{2}/);
});
