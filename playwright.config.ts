// ============================================================
// RMPG Flex — Playwright E2E Test Configuration
// ============================================================
// End-to-end browser testing for the dispatch console and
// critical CAD workflows. Tests run against the full stack
// (Express + React) in Chromium and WebKit.
// ============================================================

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Dark color scheme to match Spillman Flex theme
    colorScheme: 'dark',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewport for Capacitor app testing
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],

  // Auto-start dev server for local testing
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    port: 3001,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
