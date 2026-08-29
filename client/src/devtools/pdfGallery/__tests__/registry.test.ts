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
      [
        'court-appearance',
        'criminal-history',
        'trespass-order',
        'warrant-record',
        'citation-record',
        'case-record',
        'court-event-record',
      ].sort(),
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
        'evidence-record',
        'property-record',
        'jail-booking-record',
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
        'call-record',
        'person-record',
        'vehicle-record',
        'field-interview-record',
        'dial-connect-call',
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
        'business-record',
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
        'fleet-record',
        'personnel-record',
      ].sort(),
    );
  });

  it('has the expected total registry size', () => {
    expect(PDF_REGISTRY.length).toBe(82);
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
// RESOLVED 2026-08-01 — this set is intentionally empty.
//
// It briefly held 'business-record::typical'. The harness caught
// generateBusinessReport passing a numeric employee_count into
// sanitizePdfText(), which is typed `string` but reached at runtime from
// `any`-typed D1 rows — `.replace()` then threw and the whole Business Record
// PDF failed to generate. Fixed at the choke point (sanitizePdfText now
// coerces non-strings), so the skip was removed rather than left to rot.
//
// Keep the mechanism: a future batch will find generators that genuinely
// cannot be repaired inside an audit task, and a greppable skip beats a
// weakened fixture. Add entries as `<form-id>::<variant>` with an
// AUDIT-DEFECT comment saying what throws and why it is not fixed here.
const KNOWN_GENERATION_DEFECTS = new Set<string>();

describe.each(PDF_REGISTRY.map((e) => [e.id, e] as const))('%s', (_id, entry) => {
  for (const variant of REQUIRED_VARIANTS) {
    const isKnownDefect = KNOWN_GENERATION_DEFECTS.has(`${_id}::${variant}`);
    const itFn = isKnownDefect ? it.skip : it;

    itFn(`generates the ${variant} fixture`, async () => {
      const fixture = entry.fixtures.find((f) => f.variant === variant);
      expect(fixture, `missing ${variant} fixture`).toBeDefined();
      const doc = await entry.generate(fixture!.input);
      expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    });

    itFn(`leaks no placeholders in the ${variant} fixture`, async () => {
      const fixture = entry.fixtures.find((f) => f.variant === variant)!;
      await expectNoPlaceholderLeaks(await entry.generate(fixture.input));
    });
  }
});
