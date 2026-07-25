import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../../styles/theme-palettes.css'), 'utf8');

function blueSilverBlock(): string {
  const start = css.indexOf('html.theme-blue-silver {');
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
}

describe('Blue & Silver accent tokens', () => {
  const block = blueSilverBlock();

  it('defines the deepened brand gold, not legacy #d4a017', () => {
    expect(block).toContain('--accent-gold-500: #b8912f');
    expect(block).not.toContain('#d4a017');
  });

  it('defines the full gold and silver ramps with rgb triples', () => {
    for (const step of [300, 400, 500, 600, 700]) {
      expect(block).toMatch(new RegExp(`--accent-gold-${step}:`));
      expect(block).toMatch(new RegExp(`--accent-gold-${step}-rgb:`));
      expect(block).toMatch(new RegExp(`--accent-silver-${step}:`));
      expect(block).toMatch(new RegExp(`--accent-silver-${step}-rgb:`));
    }
  });

  it('keeps --brand-gold rendering silver for the ~500 existing consumers', () => {
    expect(block).toMatch(/--brand-gold:\s*var\(--accent-silver-500\)/);
  });

  it('routes both gold text roles through the AA-passing 300 step', () => {
    // 300 (#d9bd72), NOT 500 (#b8912f): 500 measures 2.88:1 on --surface-raised,
    // below WCAG AA, and raised panels are where field labels live.
    expect(block).toMatch(/--field-label-color:\s*var\(--accent-gold-300\)/);
    expect(block).toMatch(/--panel-header-color:\s*var\(--accent-gold-300\)/);
  });

  it('does not alter the warning severity hues', () => {
    expect(block).toContain('--sev-warn: #f59e0b');
    expect(block).toContain('--sev-caution: #facc15');
  });
});

describe('theme-block completeness', () => {
  const BLOCKS = [
    { name: 'night', marker: ':root,' },
    { name: 'day', marker: 'html.theme-light {' },
    { name: 'legacy-black', marker: 'html.theme-legacy-black {' },
    { name: 'blue-silver', marker: 'html.theme-blue-silver {' },
  ];

  // A var consumed as text-[color:var(--x)] silently drops the color if the
  // active theme block doesn't define it. Every role variable must exist in
  // EVERY block, or opting out of Blue & Silver strips styling.
  const ROLE_VARS = ['--field-label-color', '--panel-header-color'];

  for (const block of BLOCKS) {
    for (const roleVar of ROLE_VARS) {
      it(`${block.name} defines ${roleVar}`, () => {
        const start = css.indexOf(block.marker);
        expect(start).toBeGreaterThan(-1);
        const body = css.slice(start, css.indexOf('\n}', start));
        expect(body).toMatch(new RegExp(`${roleVar}\\s*:`));
      });
    }
  }
});
