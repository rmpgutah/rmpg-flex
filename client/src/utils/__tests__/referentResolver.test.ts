import { describe, it, expect } from 'vitest';
import { resolveReferents } from '../referentResolver';
import type { BrainContext } from '../dispatcherRules/types';

function ctxWith(overrides: Partial<BrainContext>): BrainContext {
  return { transcript: [], ...overrides };
}

describe('resolveReferents', () => {
  // ─── Table-driven happy path ─────────────────────────────
  const fullCtx: BrainContext = {
    transcript: [],
    lastCall:   { id: '42', call_number: 'CN-26-0457', location: '123 Main St', type: 'domestic' },
    lastUnit:   { call_sign: '3-Adam' },
    lastPerson: { id: 1042, first_name: 'John', last_name: 'Doe' },
    lastPlate:  { plate: '8IDA745', state: 'UT' },
  };

  const cases: Array<[string, string]> = [
    ['tell me more about that call',            'tell me more about call CN-26-0457'],
    ['who is assigned to the call?',            'who is assigned to call CN-26-0457?'],
    ['put me on this call',                     'put me on call CN-26-0457'],
    ['put me 10-7 at that location',            'put me 10-7 at 123 Main St'],
    ['what is the address',                     'what is 123 Main St'],
    ['run him',                                 'run person id 1042'],
    ['book the subject',                        'book person id 1042'],
    ['clear that unit',                         'clear 3-Adam'],
    ['the unit is enroute',                     '3-Adam is enroute'],
    ['run that plate',                          'run plate 8IDA745'],
    ['who owns the plate',                      'who owns plate 8IDA745'],
  ];

  for (const [input, expected] of cases) {
    it(`rewrites: "${input}"`, () => {
      const result = resolveReferents(input, fullCtx);
      expect(result.text).toBe(expected);
      expect(result.ambiguous).toBe(false);
    });
  }

  it('returns text unchanged when no referents appear', () => {
    const result = resolveReferents('dispatch three adam to main street', fullCtx);
    expect(result.text).toBe('dispatch three adam to main street');
    expect(result.ambiguous).toBe(false);
    expect(Object.keys(result.resolutions)).toHaveLength(0);
  });

  it('logs each resolution in the resolutions map', () => {
    const result = resolveReferents('tell me about that call and run him', fullCtx);
    expect(result.resolutions.call).toBe('CN-26-0457');
    expect(result.resolutions.person).toBe('1042');
  });

  // ─── Ambiguity ───────────────────────────────────────────
  it('flags ambiguous when "that call" appears with no lastCall', () => {
    const result = resolveReferents('tell me about that call', ctxWith({}));
    expect(result.ambiguous).toBe(true);
    expect(result.ambiguousSlot).toBe('call');
    // Text is passed through unchanged when unresolved.
    expect(result.text).toContain('that call');
  });

  it('flags ambiguous when "him" appears with no lastPerson', () => {
    const result = resolveReferents('run him', ctxWith({ lastCall: { id: '1', call_number: 'CN-1', location: '', type: '' } }));
    expect(result.ambiguous).toBe(true);
    expect(result.ambiguousSlot).toBe('person');
  });

  it('partial resolution: call resolves, person is ambiguous', () => {
    const result = resolveReferents('tell me about that call and run him', ctxWith({
      lastCall: { id: '1', call_number: 'CN-1', location: '', type: '' },
    }));
    expect(result.resolutions.call).toBe('CN-1');
    expect(result.ambiguous).toBe(true);
    expect(result.ambiguousSlot).toBe('person');
  });

  it('matches referents case-insensitively (surrounding text case preserved)', () => {
    const result = resolveReferents('RUN HIM', fullCtx);
    expect(result.text).toBe('RUN person id 1042');
    expect(result.resolutions.person).toBe('1042');
  });
});
