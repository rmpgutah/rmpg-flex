import { describe, it, expect } from 'vitest';
import { planAction, isCfsVerb, CFS_VERBS } from '../src/utils/cfsActions';

const call = { id: 1, status: 'dispatched', priority: 3, unit_call_signs: 'D19', narrative: 'init' };

describe('cfs action planner', () => {
  it('isCfsVerb guards the verb set', () => {
    expect(isCfsVerb('status')).toBe(true);
    expect(isCfsVerb('nope')).toBe(false);
    expect(CFS_VERBS.length).toBeGreaterThanOrEqual(11);
  });

  it('status verb sets column + time + narrative', () => {
    const p = planAction(call, 'st_enroute', 'status', { to: 'enroute' });
    expect('error' in p).toBe(false);
    if ('error' in p) return;
    expect(p.updates.status).toBe('enroute');
    expect(p.setTimes).toContain('enroute_at');
    expect(p.narrative).toContain('enroute');
  });

  it('status verb rejects unknown values', () => {
    const p = planAction(call, 'x', 'status', { to: 'banana' });
    expect('error' in p).toBe(true);
  });

  it('priority supports absolute + delta', () => {
    const abs = planAction(call, 'pr_p1', 'priority', { to: '1' });
    expect((abs as any).updates.priority).toBe(1);
    const esc = planAction(call, 'pr_up', 'priority', { delta: '-1' }); // 3 → 2
    expect((esc as any).updates.priority).toBe(2);
    const bad = planAction(call, 'x', 'priority', { to: '9' });
    expect('error' in bad).toBe(true);
  });

  it('unit add/remove/set mutates the call-sign list', () => {
    const add = planAction(call, 'un_add', 'unit', { op: 'add', unit: 'D22' });
    expect((add as any).updates.unit_call_signs).toBe('D19, D22');
    const rm = planAction(call, 'un_remove', 'unit', { op: 'remove', unit: 'D19' });
    expect((rm as any).updates.unit_call_signs).toBe('');
    const set = planAction(call, 'un_primary', 'unit', { op: 'set', unit: 'D5' });
    expect((set as any).updates.unit_call_signs).toBe('D5');
  });

  it('disposition requires a code', () => {
    const ok = planAction(call, 'ds_report', 'disposition', { code: 'RPT', label: 'Report taken' });
    expect((ok as any).updates.disposition).toBe('RPT');
    expect((ok as any).narrative).toContain('Report taken');
    expect('error' in planAction(call, 'x', 'disposition', {})).toBe(true);
  });

  it('flag/resource/notify/timer/query produce a narrative, no column writes', () => {
    for (const [verb, params, needle] of [
      ['flag', { flag: 'Weapons present' }, 'HAZARD'],
      ['resource', { resource: 'K9' }, 'K9'],
      ['notify', { target: 'Supervisor' }, 'Supervisor'],
      ['timer', { label: 'Welfare timer' }, 'Welfare'],
      ['query', { label: 'Plate query' }, 'Plate'],
    ] as const) {
      const p = planAction(call, 'x', verb as any, params as any);
      expect('error' in p).toBe(false);
      if ('error' in p) continue;
      expect(Object.keys(p.updates).length).toBe(0);
      expect(p.narrative).toContain(needle);
    }
  });

  it('flag clear flips the narrative', () => {
    const p = planAction(call, 'hz_clear', 'flag', { flag: 'All hazards', clear: '1' });
    expect((p as any).narrative).toContain('Cleared');
  });

  it('link records entity + id', () => {
    const p = planAction(call, 'lk_person', 'link', { entity_type: 'person', entity_id: 77 });
    expect((p as any).link).toEqual({ entity_type: 'person', entity_id: 77 });
    expect('error' in planAction(call, 'x', 'link', {})).toBe(true);
  });

  it('narrative requires text', () => {
    expect((planAction(call, 'x', 'narrative', { text: 'Scene secure' }) as any).narrative).toBe('Scene secure');
    expect('error' in planAction(call, 'x', 'narrative', {})).toBe(true);
  });
});
