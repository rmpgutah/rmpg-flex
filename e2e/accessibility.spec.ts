// ============================================================
// RMPG Flex — E2E Test: Accessibility (axe-core)
// ============================================================
// Automated WCAG 2.1 AA accessibility checks using axe-core.
// Required for Section 508/ADA compliance (federal funding).
// ============================================================

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility — Login Page', () => {
  test('login page has no critical accessibility violations', async ({ page }) => {
    await page.goto('/');
    // Wait for page to stabilize
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // Filter out violations that are non-critical
    const critical = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    if (critical.length > 0) {
      console.log('Accessibility violations found:');
      critical.forEach(v => {
        console.log(`  [${v.impact}] ${v.id}: ${v.description}`);
        v.nodes.forEach(n => {
          console.log(`    Target: ${n.target.join(' > ')}`);
        });
      });
    }

    // Allow zero critical/serious violations
    expect(critical).toHaveLength(0);
  });
});
