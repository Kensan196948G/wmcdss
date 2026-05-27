import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
  projects: [
    // Firefox is used as the primary E2E browser.
    // Chromium (chrome-headless-shell) triggers SIGTRAP on Linux 6.17 kernels
    // due to seccomp filter incompatibility with Playwright 1.60 / build 1223.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
