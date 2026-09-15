// Deterministic intent rules for the Dispatcher Command Engine. These are the
// phrasings that must work with every AI provider down, so each one is pinned.
import { describe, it, expect } from 'vitest';
import { matchRules } from '../src/utils/dispatcherCommand/rules';

const first = (text: string) => {
  const r = matchRules(text);
  expect(r, `no rule matched: "${text}"`).not.toBeNull();
  return r!.tool_calls[0];
};

describe('matchRules — assignment', () => {
  it('assign one unit to a call', () => {
    expect(first('assign 12 to 42')).toEqual({ tool: 'assign_units', params: { units: ['12'], call: '42' } });
  });
  it('dispatch several units with commas and "and"', () => {
    expect(first('send 12, 14 and A3 to call CFS26-0042')).toEqual({ tool: 'assign_units', params: { units: ['12', '14', 'A3'], call: 'cfs26-0042' } });
  });
  it('call-first ordering', () => {
    expect(first('dispatch 42 to 12 14')).toEqual({ tool: 'assign_units', params: { call: '42', units: ['12', '14'] } });
  });
  it('unassign', () => {
    expect(first('remove 12 from 42')).toEqual({ tool: 'unassign_unit', params: { unit: '12', call: '42' } });
  });
});

describe('matchRules — call lifecycle', () => {
  it('clear with disposition', () => {
    expect(first('clear 42 unfounded')).toEqual({ tool: 'set_call_status', params: { call: '42', status: 'cleared', disposition: 'unfounded' } });
  });
  it('close without disposition leaves it absent (engine will ask)', () => {
    expect(first('close call 42')).toEqual({ tool: 'set_call_status', params: { call: '42', status: 'cleared' } });
  });
  it('cancel', () => {
    expect(first('cancel 42 duplicate call')).toEqual({ tool: 'set_call_status', params: { call: '42', status: 'cancelled', disposition: 'duplicate_call' } });
  });
  it('hold / resume', () => {
    expect(first('hold 42')).toEqual({ tool: 'hold_call', params: { call: '42' } });
    expect(first('resume 42')).toEqual({ tool: 'resume_call', params: { call: '42' } });
  });
  it('priority both orderings', () => {
    expect(first('priority 1 on 42')).toEqual({ tool: 'set_priority', params: { call: '42', priority: 'P1' } });
    expect(first('make 42 P2')).toEqual({ tool: 'set_priority', params: { call: '42', priority: 'P2' } });
    expect(first('escalate that call to priority 1')).toEqual({ tool: 'set_priority', params: { call: 'that call', priority: 'P1' } });
  });
  it('note keeps the original casing of the text', () => {
    expect(first('note on 42: Subject LEFT eastbound')).toEqual({ tool: 'add_note', params: { call: '42', text: 'Subject LEFT eastbound' } });
    expect(first('add note 42 gate code 1234')).toEqual({ tool: 'add_note', params: { call: '42', text: 'gate code 1234' } });
  });
});

describe('matchRules — unit status', () => {
  it.each([
    ['put 12 on scene', 'onscene'],
    ['show 12 available', 'available'],
    ['12 is en route', 'enroute'],
    ['mark A12 10-8', 'available'],
    ['14 10-7', 'out_of_service'],
    ['unit 12 off duty', 'off_duty'],
  ])('%s → %s', (text, status) => {
    const c = first(text);
    expect(c.tool).toBe('set_unit_status');
    expect(c.params.status).toBe(status);
  });
  it('does not confuse "put 12 on 42" (assignment) with a status change', () => {
    expect(first('put 12 on 42').tool).toBe('assign_units');
  });
});

describe('matchRules — new call', () => {
  it('type + address', () => {
    expect(first('new call alarm at 123 Main St')).toEqual({ tool: 'create_call', params: { incident_type: 'alarm', location_address: '123 main st' } });
  });
  it('extracts a priority from either side', () => {
    expect(first('create a call for suspicious person at 5th and main priority 2')).toEqual({
      tool: 'create_call', params: { incident_type: 'suspicious_person', location_address: '5th and main', priority: 'P2' },
    });
  });
  it('type only → opens the form', () => {
    expect(first('new call alarm')).toEqual({ tool: 'open_new_call', params: { incident_type: 'alarm' } });
    expect(first('new call')).toEqual({ tool: 'open_new_call', params: {} });
  });
});

describe('matchRules — reads and console', () => {
  it('plate check also opens NCIC', () => {
    const r = matchRules('run plate abc 123')!;
    expect(r.tool_calls).toEqual([
      { tool: 'lookup_record', params: { kind: 'plate', query: 'ABC123' } },
      { tool: 'open_ncic', params: { type: 'vehicle', query: 'ABC123' } },
    ]);
  });
  it('warrant / name / premise', () => {
    expect(first('check warrants on john smith')).toEqual({ tool: 'lookup_record', params: { kind: 'warrant', query: 'john smith' } });
    expect(first('run name jane doe')).toEqual({ tool: 'lookup_record', params: { kind: 'person', query: 'jane doe' } });
    expect(first('premise 500 s state st')).toEqual({ tool: 'lookup_record', params: { kind: 'premise', query: '500 s state st' } });
  });
  it('status / select / locate / lists', () => {
    expect(first("what's the status of 42")).toEqual({ tool: 'call_status', params: { call: '42' } });
    expect(first('pull up 42')).toEqual({ tool: 'select_call', params: { call: '42' } });
    expect(first('where is 12')).toEqual({ tool: 'unit_location', params: { unit: '12' } });
    expect(first("who's closest to 300 w 500 s")).toEqual({ tool: 'closest_unit', params: { address: '300 w 500 s' } });
    expect(first('pending calls')).toEqual({ tool: 'list_pending', params: {} });
    expect(first('units')).toEqual({ tool: 'list_units', params: {} });
  });
  it('bolo infers type', () => {
    expect(first('bolo silver sedan plate XYZ789 eastbound on 400 s').params.type).toBe('vehicle');
    expect(first('attempt to locate white male red hoodie').params.type).toBe('person');
  });
  it('navigate', () => {
    expect(first('go to the map')).toEqual({ tool: 'navigate', params: { page: 'map' } });
  });
  it('help', () => {
    expect(first('help')).toEqual({ tool: 'help', params: {} });
  });
});

describe('matchRules — expanded capabilities (2026-09-14)', () => {
  it('delete uses narrow wording only', () => {
    expect(first('delete 42')).toEqual({ tool: 'delete_call', params: { call: '42' } });
    expect(first('permanently delete call 42')).toEqual({ tool: 'delete_call', params: { call: '42' } });
  });
  it('unassign verbs never become a delete', () => {
    // "remove 12 from 42" must stay an unassign — a mis-heard unassign that
    // deletes a call is the exact failure this narrow wording prevents.
    expect(first('remove 12 from 42').tool).toBe('unassign_unit');
    expect(first('drop 12 off 42').tool).toBe('unassign_unit');
  });
  it('force close all needs explicit "all" wording', () => {
    expect(first('close all')).toEqual({ tool: 'force_close_all', params: {} });
    expect(first('force close all calls as end of shift')).toEqual({ tool: 'force_close_all', params: { disposition: 'end_of_shift' } });
    // An ordinary close must NOT reach the board-wide endpoint.
    expect(first('close 42').tool).toBe('set_call_status');
  });
  it('bulk reassign needs more than one call', () => {
    expect(first('reassign 42, 43 and 44 to 12')).toEqual({ tool: 'bulk_reassign', params: { calls: ['42', '43', '44'], unit: '12' } });
    // A single call is an ordinary assignment — routing it through the
    // admin-only bulk endpoint would 403 a dispatcher.
    expect(matchRules('move 42 to 12')?.tool_calls[0]?.tool).not.toBe('bulk_reassign');
  });
  it('archive / unarchive', () => {
    expect(first('archive 42')).toEqual({ tool: 'archive_call', params: { call: '42' } });
    expect(first('restore 42')).toEqual({ tool: 'unarchive_call', params: { call: '42' } });
  });
  it('merge collects both call refs', () => {
    expect(first('merge 42 into 142')).toEqual({ tool: 'merge_calls', params: { call: '42', into: '142' } });
    expect(first('42 is a duplicate of 142')).toEqual({ tool: 'merge_calls', params: { call: '42', into: '142' } });
  });
  it('promote to incident', () => {
    expect(first('promote 42 to incident').tool).toBe('promote_to_incident');
  });
  it('agency notification', () => {
    expect(first('notify slcpd on 42')).toEqual({ tool: 'notify_agency', params: { call: '42', agency: 'SLCPD' } });
  });
  it('redispatch and undo', () => {
    expect(first('redispatch 42')).toEqual({ tool: 'redispatch', params: { call: '42' } });
    expect(first('undo the return visit on 42')).toEqual({ tool: 'undo_redispatch', params: { call: '42' } });
  });
  it('mileage strips thousands separators', () => {
    expect(first('set 12 odometer to 45,000')).toEqual({ tool: 'set_unit_mileage', params: { unit: '12', mileage: 45000 } });
  });
  it('ten-code lookup', () => {
    expect(first('10-71')).toEqual({ tool: 'lookup_code', params: { code: '10-71' } });
    expect(first('what is a 10-71')).toEqual({ tool: 'lookup_code', params: { code: '10-71' } });
  });
  it('premise alerts, timeline, shift summary', () => {
    expect(first('alerts at 123 main st')).toEqual({ tool: 'premise_alerts', params: { address: '123 main st' } });
    expect(first('timeline of 42')).toEqual({ tool: 'call_timeline', params: { call: '42' } });
    expect(first('shift summary')).toEqual({ tool: 'shift_summary', params: {} });
  });
});

describe('matchRules — no match', () => {
  it.each(['', 'good morning', 'what is the weather like', 'please make sure the caller on the alarm call gets a callback'])(
    'returns null for %j', (text) => { expect(matchRules(text)).toBeNull(); },
  );
});
