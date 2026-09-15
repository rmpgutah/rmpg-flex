// Planner output parsing is the trust boundary between an LLM and the CAD.
import { describe, it, expect } from 'vitest';
import { extractJsonObject, parsePlannerOutput, buildPlannerPrompt } from '../src/utils/dispatcherCommand/planner';
import { validateToolCall, TOOLS, describeCatalog } from '../src/utils/dispatcherCommand/catalog';

describe('extractJsonObject', () => {
  it('handles fenced json', () => {
    expect(extractJsonObject('Sure!\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('handles leading/trailing prose and nested braces in strings', () => {
    expect(extractJsonObject('Plan: {"reply":"use {braces} here","x":{"y":2}} done')).toBe('{"reply":"use {braces} here","x":{"y":2}}');
  });
  it('returns null with no object', () => {
    expect(extractJsonObject('nope')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('parsePlannerOutput', () => {
  it('parses a well-formed plan and drops unknown tools', () => {
    const out = parsePlannerOutput(JSON.stringify({
      intent: 'assign', reply: 'Copy.', tool_calls: [
        { tool: 'assign_units', params: { call: '42', units: ['12'] } },
        { tool: 'delete_everything', params: {} },
      ],
    }));
    expect(out).toEqual({ intent: 'assign', reply: 'Copy.', tool_calls: [{ tool: 'assign_units', params: { call: '42', units: ['12'] } }] });
  });
  it('defaults missing fields', () => {
    expect(parsePlannerOutput('{}')).toEqual({ intent: 'unclear', reply: '', tool_calls: [] });
  });
  it('keeps clarify', () => {
    expect(parsePlannerOutput('{"clarify":"Disposition for 42?"}')?.clarify).toBe('Disposition for 42?');
  });
  it('returns null on garbage', () => {
    expect(parsePlannerOutput('{"tool_calls": "not an array"}')).toBeNull();
    expect(parsePlannerOutput('hello')).toBeNull();
  });
});

describe('validateToolCall', () => {
  it('rejects unknown tool', () => {
    const r = validateToolCall({ tool: 'nuke', params: {} }, 'admin');
    expect(r.ok).toBe(false);
  });
  it('enforces role', () => {
    const r = validateToolCall({ tool: 'set_call_status', params: { call: '42', status: 'cleared' } }, 'officer');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.error).toMatch(/officer/);
  });
  it('officers may create calls and set their unit status', () => {
    expect(validateToolCall({ tool: 'create_call', params: { incident_type: 'alarm', location_address: '1 Main' } }, 'officer').ok).toBe(true);
    expect(validateToolCall({ tool: 'set_unit_status', params: { unit: '12', status: 'onscene' } }, 'officer').ok).toBe(true);
  });
  it('validates enums and strips unknown params', () => {
    const bad = validateToolCall({ tool: 'set_priority', params: { call: '42', priority: 'P9' } }, 'dispatcher');
    expect(bad.ok).toBe(false);
    const good = validateToolCall({ tool: 'set_priority', params: { call: '42', priority: 'P1', bogus: 1 } }, 'dispatcher');
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.call.params).toEqual({ call: '42', priority: 'P1' });
  });
  it('update_call_fields needs at least one field', () => {
    expect(validateToolCall({ tool: 'update_call_fields', params: { call: '42', fields: {} } }, 'dispatcher').ok).toBe(false);
  });
});

describe('buildPlannerPrompt', () => {
  it('lists only the tools the role may use and the board state', () => {
    const prompt = buildPlannerPrompt(
      { userId: 1, role: 'officer', source: 'typed', selectedCallNumber: 'CFS26-0042' },
      { activeCalls: [{ call_number: 'CFS26-0042', incident_type: 'alarm', priority: 'P2', status: 'dispatched', location_address: '1 Main', unit_call_signs: '12' }], pendingCalls: [], units: [{ call_sign: '12', status: 'enroute' }] },
    );
    expect(prompt).toContain('create_call');
    expect(prompt).not.toContain('- set_call_status');
    expect(prompt).toContain('SELECTED CALL: CFS26-0042');
    expect(prompt).toContain('12=enroute');
  });
  it('catalog description covers every tool for admin', () => {
    const d = describeCatalog('admin');
    for (const name of Object.keys(TOOLS)) expect(d).toContain(`- ${name}:`);
  });
});
