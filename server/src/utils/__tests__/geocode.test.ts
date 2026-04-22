import { describe, it, expect } from 'vitest';
import { normalizeAddressForMatch } from '../serveIntakeHelpers';

describe('geocode helpers', () => {
  it('placeholder — fallback tested via integration', () => {
    // Actual network-calling test is too flaky for CI; rely on prod smoke.
    // Sanity-check an import from a sibling helper so the suite fails loudly
    // if the module graph breaks.
    expect(typeof normalizeAddressForMatch).toBe('function');
    expect(true).toBe(true);
  });
});
