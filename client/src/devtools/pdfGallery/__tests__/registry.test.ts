import { describe, it, expect } from 'vitest';
import { PDF_REGISTRY, getEntry, entriesByCriticality } from '../registry';
import { validateRegistry, REQUIRED_VARIANTS } from '../types';
import { expectNoPlaceholderLeaks } from '../../../utils/pdf/audit/textLayer';

describe('PDF_REGISTRY', () => {
  it('is structurally valid', () => {
    expect(validateRegistry(PDF_REGISTRY)).toEqual([]);
  });

  it('contains the batch-1 court & legal entries', () => {
    const ids = entriesByCriticality('court-legal').map((e) => e.id).sort();
    expect(ids).toEqual(
      ['court-appearance', 'criminal-history', 'trespass-order'].sort(),
    );
  });

  it('looks up by id', () => {
    expect(getEntry('trespass-order')?.label).toBe('Trespass Order');
    expect(getEntry('does-not-exist')).toBeUndefined();
  });
});

// The audit gate. Every registered form must generate all three
// fixtures without throwing, and without leaking placeholder tokens
// into the text layer. Failures here ARE the defect catalogue's
// correctness lens.
describe.each(PDF_REGISTRY.map((e) => [e.id, e] as const))('%s', (_id, entry) => {
  it.each(REQUIRED_VARIANTS)('generates the %s fixture', async (variant) => {
    const fixture = entry.fixtures.find((f) => f.variant === variant);
    expect(fixture, `missing ${variant} fixture`).toBeDefined();
    const doc = await entry.generate(fixture!.input);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it.each(REQUIRED_VARIANTS)('leaks no placeholders in the %s fixture', async (variant) => {
    const fixture = entry.fixtures.find((f) => f.variant === variant)!;
    await expectNoPlaceholderLeaks(await entry.generate(fixture.input));
  });
});
