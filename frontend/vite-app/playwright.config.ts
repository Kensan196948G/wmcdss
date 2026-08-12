import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

// ローカルで他プロジェクトの vite preview が 4173 を占有している場合に
// 別ポートで実行できるよう、ポートを env で上書き可能にする。
// （CI では既定 4173 のまま動作する）
const E2E_PORT = Number(process.env.E2E_PORT || 4173);
const E2E_BASE = `http://localhost:${E2E_PORT}`;

// e2e/auth-state.json の localStorage origin は既定ポート (4173) 前提で
// コミットされている。E2E_PORT で別ポートへ切り替えた場合も認証状態が
// 有効になるよう、実行時に origin を差し替える。
const _authState = JSON.parse(fs.readFileSync('e2e/auth-state.json', 'utf8')) as {
  cookies: unknown[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
};
const storageState = {
  cookies: _authState.cookies,
  origins: _authState.origins.map((o) => ({
    ...o,
    origin: o.origin === 'http://localhost:4173' ? E2E_BASE : o.origin,
  })),
};

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // 1 retry handles vite-preview cold-start race on local multi-worker runs;
  // CI always starts fresh so retries are rarely consumed there.
  retries: 1,
  use: {
    baseURL: E2E_BASE,
    headless: true,
    storageState,
  },
  projects: [
    // Firefox is used as the primary E2E browser.
    // Chromium (chrome-headless-shell) triggers SIGTRAP on Linux 6.17 kernels
    // due to seccomp filter incompatibility with Playwright 1.60 / build 1223.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${E2E_PORT} --strictPort`,
    url: E2E_BASE,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
