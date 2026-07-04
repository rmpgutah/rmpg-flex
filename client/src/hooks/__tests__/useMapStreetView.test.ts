import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('useMapStreetView SAT PEEK popup theming', () => {
  it('references the tactical palette constants instead of hardcoded hex', () => {
    const source = readFileSync(
      resolve(__dirname, '../useMapStreetView.ts'), 'utf-8'
    );
    expect(source).toContain('TACTICAL_SURFACE_RAISED');
    expect(source).toContain('TACTICAL_BRAND_GOLD');
    expect(source).toContain('TACTICAL_BORDER');
    expect(source).toContain('TACTICAL_TEXT_MUTED');
    // The old literals should no longer appear as bare color values.
    expect(source).not.toMatch(/background:#141414/);
    expect(source).not.toMatch(/color:#d4a017/);
    expect(source).not.toMatch(/border:1px solid #222/);
    expect(source).not.toMatch(/color:#888/);
  });
});
