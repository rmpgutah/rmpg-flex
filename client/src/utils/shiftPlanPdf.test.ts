import { describe, it, expect } from 'vitest';
import { generateShiftPlanPdf, type ShiftPlanPdfInput } from './shiftPlanPdf';
import type { ShiftPlan } from '../hooks/useShiftPlanning';

// Smoke tests for the v1053 supervisor briefing PDF. We don't crack
// open the jsPDF byte stream — we just confirm the generator returns
// a non-empty document and doesn't throw on the awkward inputs the
// real page can hand it (zero assignments, missing optional fields,
// long officer lists, the `custom` shift type which isn't in the
// standard SHIFT_TYPES key set, etc.).

function basePlan(over: Partial<ShiftPlan> = {}): ShiftPlan {
  return {
    id: 'sp_test_1',
    name: 'Test Shift Plan',
    date: '2026-06-22',
    shiftType: 'day',
    assignments: [],
    status: 'draft',
    createdAt: '2026-06-22T00:00:00Z',
    updatedAt: '2026-06-22T01:00:00Z',
    ...over,
  };
}

function baseInput(plan: ShiftPlan, over: Partial<ShiftPlanPdfInput> = {}): ShiftPlanPdfInput {
  return {
    plan,
    stats: { assigned: plan.assignments.length, officers: 0, units: 0 },
    ...over,
  };
}

describe('generateShiftPlanPdf', () => {
  it('returns a non-empty PDF for the empty-plan case', () => {
    const doc = generateShiftPlanPdf(baseInput(basePlan()));
    const bytes = doc.output('arraybuffer');
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('renders multiple assignments without throwing', () => {
    const plan = basePlan({
      assignments: Array.from({ length: 8 }, (_, i) => ({
        id: `aa_${i}`,
        layerId: 'beat',
        featureKey: `B${i}`,
        label: `Beat ${i}`,
        properties: {},
        officerIds: [`o${i}`],
        officerNames: [`Officer ${i}`],
        unitIds: [`u${i}`],
        unitCallSigns: [`R${i}`],
        shiftStart: '06:00',
        shiftEnd: '14:00',
        notes: i === 0 ? 'Watch for transient — open warrant' : undefined,
      })),
    });
    expect(() =>
      generateShiftPlanPdf(baseInput(plan, {
        stats: { assigned: 8, officers: 8, units: 8 },
        preparedBy: 'Lt. Reyes',
      })),
    ).not.toThrow();
  });

  it('handles the warnings + conflicts blocks together', () => {
    const plan = basePlan({ assignments: [] });
    const doc = generateShiftPlanPdf(baseInput(plan, {
      notifications: [
        { severity: 'critical', message: 'Night shift understaffed by 2' },
        { severity: 'warning', message: 'OT threshold reached for 3 officers' },
        { severity: 'info', message: 'Information notice that should be filtered out' },
      ],
      conflicts: [
        { officer_name: 'Smith', shift_count: 2 },
        { officer_name: 'Jones', shift_count: 3 },
      ],
    }));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the custom-shift label when an unknown shiftType slips through', () => {
    // Defensive — the hook restricts shiftType to the SHIFT_TYPES keys,
    // but the saved-to-server / loaded-from-server round trip can return
    // anything if a migration shifts the column. The generator should
    // not throw or render undefined.
    const plan = basePlan({ shiftType: 'custom' });
    const doc = generateShiftPlanPdf(baseInput(plan));
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('long officer-name wrap does not blow the row off the page', () => {
    const longNames = ['Officer Smithington-Whitfield IV', 'Officer Van Der Berg-Hatherton', 'Officer Williamson'];
    const plan = basePlan({
      assignments: [{
        id: 'aa_long',
        layerId: 'municipality',
        featureKey: 'SLA',
        label: 'Salt Lake — Downtown Patrol Zone',
        properties: {},
        officerIds: ['o1', 'o2', 'o3'],
        officerNames: longNames,
        unitIds: ['u1'],
        unitCallSigns: ['R1'],
        shiftStart: '22:00',
        shiftEnd: '06:00',
        notes: 'Heightened presence requested by client — keep two units on visible patrol until midnight',
      }],
    });
    expect(() =>
      generateShiftPlanPdf(baseInput(plan, { stats: { assigned: 1, officers: 3, units: 1 } })),
    ).not.toThrow();
  });
});
