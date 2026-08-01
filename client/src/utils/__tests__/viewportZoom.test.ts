// ============================================================
// The viewport must not block pinch-zoom (WCAG 1.4.4 Resize Text)
// ============================================================
// index.html shipped `maximum-scale=1.0, user-scalable=no`. There is exactly
// ONE viewport meta and no per-page override, so this applied to EVERY page on
// EVERY device — not just the MDT, which is how it had been recorded in the
// audit notes.
//
// It matters here more than in a typical app: the design system puts table
// headers at 9px and rows at 11px, so the densest, most safety-relevant screens
// are the ones an operator would most want to magnify.
//
// Removed at the operator's direction 2026-08-01. If a specific touch surface
// ever needs gesture suppression, scope it with CSS `touch-action` on that
// surface — never by reinstating a global zoom lock.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8');

/** The viewport meta TAG only — the surrounding comment names the very
 *  attributes under test, so matching raw HTML would pass on prose. */
const viewportTag = (() => {
  const m = html.match(/<meta[^>]*name="viewport"[^>]*>/);
  expect(m, 'viewport meta not found').not.toBeNull();
  return m![0];
})();

describe('viewport allows zoom', () => {
  it('does not set user-scalable=no', () => {
    expect(viewportTag).not.toMatch(/user-scalable\s*=\s*no/i);
  });

  it('does not cap maximum-scale', () => {
    // Any maximum-scale below 2 fails WCAG 1.4.4, and 1.0 blocks zoom outright.
    expect(viewportTag).not.toMatch(/maximum-scale/i);
  });

  it('keeps the settings that are not accessibility problems', () => {
    expect(viewportTag).toContain('width=device-width');
    expect(viewportTag).toContain('initial-scale=1.0');
    // Needed for notched displays; unrelated to zoom.
    expect(viewportTag).toContain('viewport-fit=cover');
  });

  it('there is exactly one viewport meta, so nothing re-locks it downstream', () => {
    const all = html.match(/<meta[^>]*name="viewport"[^>]*>/g) || [];
    expect(all.length).toBe(1);
  });
});
