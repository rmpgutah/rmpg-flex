// compile.ts is the boundary between "what was asked" and "what may hit the API".
import { describe, it, expect } from 'vitest';
import { compileToolCall, collectRefs, isAllowedPath, COMMAND_EDITABLE_COLUMNS, CompileError, type ResolvedRefs } from '../src/utils/dispatcherCommand/compile';
import { validateToolCall, TOOLS } from '../src/utils/dispatcherCommand/catalog';
import { pickCall, pickUnit, levenshtein } from '../src/utils/dispatcherCommand/resolve';

const refs: ResolvedRefs = {
  calls: { '42': { id: 7, call_number: 'CFS26-0042' }, 'selected call': { id: 9, call_number: 'CFS26-0099' } },
  units: { '12': { id: 3, call_sign: '12' }, '14': { id: 4, call_sign: '14' } },
};

function compile(tool: string, params: Record<string, unknown>, role = 'dispatcher') {
  const v = validateToolCall({ tool, params }, role);
  if (!v.ok) throw new Error(v.error.error);
  return compileToolCall(v.call, refs, 'Tester');
}

describe('compileToolCall — writes', () => {
  it('create_call posts to /dispatch/calls with defaults + source', () => {
    const [step] = compile('create_call', { incident_type: 'Suspicious Person', location_address: '1 Main St' });
    expect(step).toMatchObject({ kind: 'http', method: 'POST', path: '/dispatch/calls', destructive: false, body: { incident_type: 'suspicious_person', priority: 'P3', location_address: '1 Main St', source: 'dispatcher_command' } });
  });
  it('assign_units → /dispatch with numeric ids', () => {
    const [step] = compile('assign_units', { call: '42', units: ['12', '14'] });
    expect(step).toMatchObject({ method: 'POST', path: '/dispatch/calls/7/dispatch', body: { unit_ids: [3, 4] } });
  });
  // OPERATOR POLICY (2026-09-14): the Y/N confirmation gate is reserved for
  // TRUE DELETES. Status changes, unassign and redispatch are all recoverable
  // from the board, so they execute immediately.
  it('clearing a call is NOT gated; disposition normalised', () => {
    const [clear] = compile('set_call_status', { call: '42', status: 'cleared', disposition: 'Gone On Arrival' });
    expect(clear).toMatchObject({ path: '/dispatch/calls/7/status', destructive: false, body: { status: 'cleared', disposition: 'gone_on_arrival' } });
    const [enr] = compile('set_call_status', { call: '42', status: 'enroute' });
    expect(enr).toMatchObject({ destructive: false });
  });
  it('unassign and redispatch are NOT gated (reversible)', () => {
    expect(compile('unassign_unit', { call: '42', unit: '12' })[0]).toMatchObject({ path: '/dispatch/calls/7/unassign-unit', destructive: false, body: { unit_id: 3 } });
    expect(compile('redispatch', { call: '42' })[0]).toMatchObject({ path: '/dispatch/calls/7/redispatch', destructive: false });
  });
  it('delete_call is the gated operation', () => {
    expect(compile('delete_call', { call: '42' }, 'admin')[0]).toMatchObject({ method: 'DELETE', path: '/dispatch/calls/7', destructive: true });
  });
  it('a true delete is the ONLY thing that raises the confirmation gate', () => {
    // Guards the policy itself: if a future tool is marked destructive, this
    // fails and forces a deliberate decision rather than a silent widening.
    const gated = Object.values(TOOLS).filter(t => t.destructive).map(t => t.name);
    expect(gated).toEqual(['delete_call']);
  });
  it('bulk_reassign resolves every call ref and de-dupes ids', () => {
    // '42' and 'selected call' are distinct refs; both must reach the resolver.
    const [step] = compile('bulk_reassign', { calls: ['42', 'selected call', '42'], unit: '12' }, 'admin');
    expect(step).toMatchObject({ method: 'POST', path: '/dispatch/calls/bulk-reassign', destructive: false, body: { call_ids: [7, 9], unit_id: 3 } });
  });
  it('force_close_all says ALL out loud in the summary', () => {
    const [step] = compile('force_close_all', { disposition: 'End Of Shift' }, 'admin');
    expect(step).toMatchObject({ method: 'POST', path: '/dispatch/calls/force-close-all', destructive: false, body: { disposition: 'end_of_shift' } });
    expect(step.summary).toContain('ALL');
  });
  it('board-wide writes are admin/manager only', () => {
    expect(() => compile('force_close_all', {}, 'dispatcher')).toThrow(/may not/);
    expect(() => compile('bulk_reassign', { calls: ['42', '142'], unit: '12' }, 'supervisor')).toThrow(/may not/);
  });
  it('set_priority → /escalate', () => {
    expect(compile('set_priority', { call: 'selected call', priority: 'P1' })[0]).toMatchObject({ path: '/dispatch/calls/9/escalate', body: { new_priority: 'P1' } });
  });
  it('set_unit_status → PUT units/:id/status', () => {
    expect(compile('set_unit_status', { unit: '12', status: 'onscene' })[0]).toMatchObject({ method: 'PUT', path: '/dispatch/units/3/status', body: { status: 'onscene' } });
  });
  it('add_note is a client action (append semantics live client-side)', () => {
    expect(compile('add_note', { call: '42', text: 'gate code 1234' })[0]).toMatchObject({ kind: 'client', action: 'append_note', payload: { call_id: 7, text: 'gate code 1234', author: 'Tester' } });
  });
  it('create_bolo defaults', () => {
    expect(compile('create_bolo', { title: 'Silver sedan' })[0]).toMatchObject({ path: '/comms/bolos', body: { type: 'other', title: 'Silver sedan', priority: 'P3', status: 'active' } });
  });
});

describe('compileToolCall — update_call_fields allowlist', () => {
  it('passes allowlisted columns, coerces booleans, skips unknown', () => {
    const [step] = compile('update_call_fields', { call: '42', fields: { caller_phone: '801-555-0100', weapons_involved: true, 'Cross Street': '400 S', evil_column: 'x' } });
    expect(step).toMatchObject({ method: 'PUT', path: '/dispatch/calls/7', body: { caller_phone: '801-555-0100', weapons_involved: 1, cross_street: '400 S' } });
    expect(step.summary).toContain('skipped evil_column');
  });
  it('refuses lifecycle columns even though the route allows them', () => {
    expect(COMMAND_EDITABLE_COLUMNS.has('status')).toBe(false);
    expect(COMMAND_EDITABLE_COLUMNS.has('assigned_unit_ids')).toBe(false);
    expect(() => compile('update_call_fields', { call: '42', fields: { status: 'closed' } })).toThrow(CompileError);
  });
  it('unresolved call ref throws CompileError', () => {
    expect(() => compile('hold_call', { call: '77' })).toThrow(/not found/);
  });
});

describe('path allowlist', () => {
  it.each([
    '/dispatch/calls', '/dispatch/calls/7/status', '/dispatch/units/3/status', '/comms/bolos',
    // Board-wide writes — admin/manager in the route AND in the catalog.
    '/dispatch/calls/force-close-all', '/dispatch/calls/bulk-reassign',
  ])('allows %s', p => expect(isAllowedPath(p)).toBe(true));
  it.each(['/dispatch/calls/7', '/admin/users', '/dispatch/calls/archive-bulk', '/dispatch/calls/7/../8/status'])('rejects/limits %s', p => {
    // PUT /dispatch/calls/:id IS allowed (field updates); the rest are not.
    expect(isAllowedPath(p)).toBe(p === '/dispatch/calls/7');
  });
});

describe('collectRefs / resolve helpers', () => {
  it('collects call and unit refs', () => {
    const v1 = validateToolCall({ tool: 'assign_units', params: { call: '42', units: ['12', '14'] } }, 'admin');
    const v2 = validateToolCall({ tool: 'set_unit_status', params: { unit: 'A1', status: 'busy' } }, 'admin');
    if (!v1.ok || !v2.ok) throw new Error('validate');
    expect(collectRefs([v1.call, v2.call])).toEqual({ callRefs: ['42'], unitRefs: ['12', '14', 'A1'] });
  });
  it('collects the SECOND call ref of merge and the ARRAY of bulk_reassign', () => {
    // Both are refs the collector historically missed; a miss here is invisible
    // until a real DB lookup fails in needCall().
    const mg = validateToolCall({ tool: 'merge_calls', params: { call: '42', into: '142' } }, 'admin');
    const br = validateToolCall({ tool: 'bulk_reassign', params: { calls: ['50', '51'], unit: '12' } }, 'admin');
    if (!mg.ok || !br.ok) throw new Error('validate');
    expect(collectRefs([mg.call]).callRefs).toEqual(['42', '142']);
    expect(collectRefs([br.call])).toEqual({ callRefs: ['50', '51'], unitRefs: ['12'] });
  });
  it('pickCall: exact, zero-padded suffix, selected, ambiguity', () => {
    const calls = [
      { id: 1, call_number: 'CFS26-0042' }, { id: 2, call_number: 'CFS26-0142' }, { id: 3, call_number: '26-RMP-0007' },
    ];
    expect(pickCall('CFS26-0042', calls).hit?.id).toBe(1);
    expect(pickCall('7', calls).hit?.id).toBe(3);
    expect(pickCall('0007', calls).hit?.id).toBe(3);
    expect(pickCall('42', calls).hit?.id).toBe(1);        // tail 0042 → 42 exact; 0142 does not
    expect(pickCall('that call', calls, 'CFS26-0142').hit?.id).toBe(2);
    expect(pickCall('that call', calls, null).hit).toBeUndefined();
    const amb = pickCall('CFS26-01', calls);
    expect(amb.hit).toBeUndefined();
  });
  it('pickUnit: exact, prefix/suffix, fuzzy', () => {
    const units = [{ id: 1, call_sign: 'A12' }, { id: 2, call_sign: 'A14' }, { id: 3, call_sign: 'UNIT-7' }];
    expect(pickUnit('a12', units).hit?.id).toBe(1);
    expect(pickUnit('12', units).hit?.id).toBe(1);
    expect(pickUnit('unit 7', units).hit?.id).toBe(3);
    expect(pickUnit('A1', units).candidates.length).toBe(2);
  });
  it('levenshtein basics', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});
