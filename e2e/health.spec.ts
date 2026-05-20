// ============================================================
// RMPG Flex — E2E Test: Health Check
// ============================================================
// Verifies the application loads and critical endpoints respond.
// This is the foundational smoke test for the E2E suite.
// ============================================================

import { test, expect } from '@playwright/test';

test.describe('Health Check', () => {
  test('API health endpoint returns ok', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
  });

  test('Login page loads', async ({ page }) => {
    await page.goto('/');
    // Should redirect to login or show the app
    await expect(page).toHaveTitle(/RMPG/i);
  });

  test('API docs page loads', async ({ page }) => {
    await page.goto('/api/docs');
    await expect(page.locator('text=RMPG Flex CAD/RMS API')).toBeVisible({ timeout: 10_000 });
  });

  test('System status endpoint returns', async ({ request }) => {
    const response = await request.get('/api/system-status');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toMatch(/operational|degraded/);
  });
});

test.describe('Security Headers', () => {
  test('API responses include security headers', async ({ request }) => {
    const response = await request.get('/api/health');
    const headers = response.headers();

    // Helmet-set headers
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBeDefined();
    expect(headers['content-security-policy']).toBeDefined();
    expect(headers['cross-origin-opener-policy']).toBeDefined();
  });

  test('API responses have no-cache headers', async ({ request }) => {
    const response = await request.get('/api/health');
    const cacheControl = response.headers()['cache-control'];
    expect(cacheControl).toContain('no-store');
  });
});
