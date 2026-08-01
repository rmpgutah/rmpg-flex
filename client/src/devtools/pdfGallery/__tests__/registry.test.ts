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

  it('contains the batch-2 evidence & custody entries', () => {
    const ids = entriesByCriticality('evidence-custody').map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        'bodycam-video-custody',
        'equipment-custody',
        'evidence-item',
        'forensic-case',
        'jail-booking-sheet',
        'jail-roster-snapshot',
      ].sort(),
    );
  });

  it('contains the batch-3 use-of-force & internal affairs entries', () => {
    const ids = entriesByCriticality('use-of-force').map((e) => e.id).sort();
    expect(ids).toEqual(
      ['affairs-complaint', 'cleared-summary', 'dar', 'use-of-force-report'].sort(),
    );
  });

  it('contains the batch-4 dispatch & patrol entries', () => {
    const ids = entriesByCriticality('dispatch-patrol').map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        'fi-card',
        'map-situation-report',
        'nav-briefing',
        'nav-trip-detail',
        'nav-trip-report',
        'patrol-tracking',
        'plate-capture',
        'pso-notice',
        'shift-plan',
        'shift-report',
      ].sort(),
    );
  });

  it('contains the batch-5e client-facing entries', () => {
    const ids = entriesByCriticality('client-facing').map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        'document-intake',
        'invoice',
        'proposal',
        'skip-tracer-report',
        'training-certificate',
        'flagged-fuel-audit',
        'fleet-budget-variance',
        'fleet-cost-ownership',
        'fleet-damage-report',
        'fleet-expenses-report',
        'fleet-fuel-analytics',
        'fleet-fuel-report',
        'fleet-inspection-report',
        'fleet-maintenance-history',
        'fleet-vehicle-summary',
        'fleet-status-report',
        'fleet-maintenance-report',
        'fleet-cost-report',
        'fleet-lifecycle-report',
        'fleet-compliance-report',
        'fleet-utilization-report',
        'fleet-fuel-consumption-report',
        'fleet-accident-report',
        'fleet-budget-report',
        'fleet-replacement-report',
        'fleet-depreciation-report',
        'fleet-key-report',
        'fleet-scorecard-report',
        'personnel-productivity-report',
        'inspection-analysis-report',
        'cost-per-mile-report',
        'maintenance-forecast-report',
        'compliance-audit-report',
      ].sort(),
    );
  });

  it('contains the batch-6 internal & reference entries', () => {
    const ids = entriesByCriticality('internal-reference').map((e) => e.id).sort();
    expect(ids).toEqual(
      [
        'audit-log',
        'conversation-transcript',
        'email-thread',
        'help-quick-reference',
        'knowledge-base-search',
        'ncic-reference',
        'statute',
        'task-list',
        'dispatch-guide',
        'web-research-report',
        'dl-safety-sheet',
      ].sort(),
    );
  });

  it('has the expected total registry size', () => {
    expect(PDF_REGISTRY.length).toBe(67);
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
