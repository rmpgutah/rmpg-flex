import { describe, it, expect } from 'vitest';
import { withAlpha } from '../withAlpha';
import { UNIT_STATUS_HEX } from '../statusColors';
import { LEAVE_STATUS_COLORS } from '../../pages/hr/utils/hrConstants';

/**
 * The bug class this helper exists to close: `${color}22` only produces valid
 * CSS when `color` is a raw 6-digit hex. Anything else — a theme variable most
 * of all — yields `var(--rmpg-500)22`, which the browser drops silently.
 *
 * This pattern is the invariant. No return value from withAlpha may ever match
 * it, for any input.
 */
const DEAD_CONCAT = /(var\([^)]*\)|\)|[a-z])[0-9a-fA-F]{2}$/;

describe('withAlpha — raw hex path (byte-identity with the legacy idiom)', () => {
  it('concatenates a hex-pair alpha verbatim, matching `${color}80` exactly', () => {
    // This exact string is asserted by DockSection.test.tsx. If this test goes
    // red, the refactor has changed output on an already-working call site.
    expect(withAlpha('#22c55e', '80')).toBe('#22c55e80');
  });

  it('reproduces every alpha suffix used at the legacy call sites', () => {
    expect(withAlpha('#22c55e', '22')).toBe('#22c55e22');
    expect(withAlpha('#22c55e', '44')).toBe('#22c55e44');
    expect(withAlpha('#22c55e', '55')).toBe('#22c55e55');
    expect(withAlpha('#22c55e', '99')).toBe('#22c55e99');
    expect(withAlpha('#22c55e', 'b3')).toBe('#22c55eb3');
    expect(withAlpha('#22c55e', '1a')).toBe('#22c55e1a');
  });

  it('preserves the alpha pair verbatim rather than re-deriving it', () => {
    // Uppercase in, uppercase out. A float round-trip would normalize to
    // lowercase and quietly change output on any call site written in caps.
    expect(withAlpha('#22c55e', 'B3')).toBe('#22c55eB3');
  });

  it('still yields hex when the alpha is given as a 0-1 float', () => {
    // Hex-only consumers keep getting hex regardless of the alpha spelling.
    expect(withAlpha('#22c55e', 0.5)).toBe('#22c55e80');
    expect(withAlpha('#22c55e', 1)).toBe('#22c55eff');
    expect(withAlpha('#22c55e', 0)).toBe('#22c55e00');
  });
});

describe('withAlpha — token path (the case the legacy idiom broke)', () => {
  it('emits color-mix for a CSS variable instead of invalid concatenation', () => {
    expect(withAlpha('var(--rmpg-500)', '22')).toBe(
      'color-mix(in srgb, var(--rmpg-500) 13.33%, transparent)',
    );
  });

  it('emits a clean percentage for a float alpha', () => {
    expect(withAlpha('var(--sev-ok)', 0.5)).toBe(
      'color-mix(in srgb, var(--sev-ok) 50%, transparent)',
    );
  });

  it('handles hsl() — colorLookup.ts hashToHsl() returns this shape', () => {
    expect(withAlpha('hsl(210, 65%, 55%)', '22')).toBe(
      'color-mix(in srgb, hsl(210, 65%, 55%) 13.33%, transparent)',
    );
  });

  it('handles rgb() and named colors', () => {
    expect(withAlpha('rgb(34 197 94)', 0.25)).toBe(
      'color-mix(in srgb, rgb(34 197 94) 25%, transparent)',
    );
    expect(withAlpha('rebeccapurple', 0.25)).toBe(
      'color-mix(in srgb, rebeccapurple 25%, transparent)',
    );
  });

  it('agrees between the two alpha spellings for an equivalent value', () => {
    expect(withAlpha('var(--rmpg-500)', '80')).toBe(withAlpha('var(--rmpg-500)', 128 / 255));
  });

  it('trims the percentage to 2 decimals for readable devtools output', () => {
    // 0x22/255 = 0.13333… — must not leak '13.333333333333334%'.
    expect(withAlpha('var(--x)', '22')).toContain('13.33%');
    expect(withAlpha('var(--x)', '22')).not.toContain('13.3333');
  });
});

describe('withAlpha — the invariant', () => {
  it('never emits the dead-concat pattern for any input shape', () => {
    const colors = [
      '#22c55e',
      'var(--rmpg-500)',
      'var(--text-muted)',
      'hsl(210, 65%, 55%)',
      'rgb(34 197 94)',
      'rebeccapurple',
    ];
    const alphas: Array<number | string> = ['22', '44', '55', '80', '99', 'b3', 0.13, 0.5, 1];

    for (const color of colors) {
      for (const alpha of alphas) {
        const out = withAlpha(color, alpha);
        // A token input must never come back with a bare hex pair welded on.
        if (!color.startsWith('#')) {
          expect(out, `${color} @ ${alpha}`).not.toMatch(DEAD_CONCAT);
          expect(out, `${color} @ ${alpha}`).toContain('color-mix(in srgb,');
        }
        expect(out, `${color} @ ${alpha}`).not.toContain('NaN');
        expect(out, `${color} @ ${alpha}`).not.toContain('undefined');
      }
    }
  });
});

describe('withAlpha — the live palette regressions this closes', () => {
  // These two entries are var() in shipped code (both from 37a603e1fc,
  // 2026-06-16). Under the legacy concat idiom they produced invalid CSS, so
  // off-duty unit markers lost their accuracy ring and glow, and cancelled
  // leave badges lost their background tint and border. If either map is ever
  // reverted to a literal, these tests keep passing — they assert the helper
  // copes, not that the value stays a token.
  it('renders a tint for UNIT_STATUS_HEX.off_duty', () => {
    const out = withAlpha(UNIT_STATUS_HEX.off_duty, '22');
    expect(out).not.toMatch(DEAD_CONCAT);
    expect(out).toSatisfy(
      (s: string) => s.startsWith('color-mix(in srgb,') || /^#[0-9a-fA-F]{8}$/.test(s),
    );
  });

  it('renders a tint and border for LEAVE_STATUS_COLORS.cancelled', () => {
    for (const alpha of ['22', '44']) {
      const out = withAlpha(LEAVE_STATUS_COLORS.cancelled, alpha);
      expect(out).not.toMatch(DEAD_CONCAT);
      expect(out).toSatisfy(
        (s: string) => s.startsWith('color-mix(in srgb,') || /^#[0-9a-fA-F]{8}$/.test(s),
      );
    }
  });

  it('renders a tint for the bare var() fallbacks in PayrollTab / ForensicLabPage', () => {
    // Both spell the fallback `(MAP[key] || 'var(--rmpg-500)') + '20'`, so the
    // fallback itself was the broken input for any unmapped status.
    const out = withAlpha('var(--rmpg-500)', '20');
    expect(out).toBe('color-mix(in srgb, var(--rmpg-500) 12.55%, transparent)');
  });
});

describe('withAlpha — edge-case policy', () => {
  it('fails invisible for an empty / nullish / non-string color', () => {
    // Chosen over returning the input: an absent marker halo beats a
    // wrong-colored one on a live tactical surface.
    expect(withAlpha('', '22')).toBe('transparent');
    expect(withAlpha('   ', '22')).toBe('transparent');
    expect(withAlpha(undefined as unknown as string, '22')).toBe('transparent');
    expect(withAlpha(null as unknown as string, '22')).toBe('transparent');
  });

  it('replaces, rather than compounds, an alpha already on the color', () => {
    expect(withAlpha('#22c55e80', '22')).toBe('#22c55e22');
    expect(withAlpha('#22c55e22', '80')).toBe('#22c55e80');
    expect(withAlpha('#22c55eff', 0.5)).toBe('#22c55e80');
  });

  it('clamps an out-of-range numeric alpha', () => {
    expect(withAlpha('#22c55e', 1.5)).toBe('#22c55eff');
    expect(withAlpha('#22c55e', -1)).toBe('#22c55e00');
    expect(withAlpha('var(--x)', 1.5)).toBe('color-mix(in srgb, var(--x) 100%, transparent)');
    expect(withAlpha('var(--x)', -0.5)).toBe('color-mix(in srgb, var(--x) 0%, transparent)');
  });

  it('resolves a malformed alpha to opaque instead of emitting NaN%', () => {
    // NaN% is dropped silently by the browser — exactly the invisible-failure
    // mode this module exists to remove. Opaque is wrong but visible.
    expect(withAlpha('var(--x)', 'zz')).toBe('color-mix(in srgb, var(--x) 100%, transparent)');
    expect(withAlpha('var(--x)', NaN)).toBe('color-mix(in srgb, var(--x) 100%, transparent)');
    expect(withAlpha('var(--x)', Infinity)).toBe('color-mix(in srgb, var(--x) 100%, transparent)');
    expect(withAlpha('#22c55e', 'zz')).toBe('#22c55eff');
  });

  it('passes a 3-digit hex through the color-mix path (valid CSS)', () => {
    expect(withAlpha('#2c5', 0.5)).toBe('color-mix(in srgb, #2c5 50%, transparent)');
  });
});
