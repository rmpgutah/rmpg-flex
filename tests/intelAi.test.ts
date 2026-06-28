import { describe, it, expect } from 'vitest';
import {
  buildAskPrompt, citationsFrom, buildExtractPrompt, parseExtract,
  buildSummaryPrompt, extractJson, type IntelHitLite,
} from '../src/utils/intelAi';

const hits: IntelHitLite[] = [
  { type: 'person', id: 5, label: 'John Doe', snippet: 'DOB 1990' },
  { type: 'vehicle', id: 12, label: '7ABC123 Ford' },
  { type: 'warrant', id: 3, label: 'Active warrant' },
];

describe('intelAi prompts', () => {
  it('buildAskPrompt includes the question and numbered sources', () => {
    const p = buildAskPrompt('who owns 7ABC123?', hits);
    expect(p).toContain('who owns 7ABC123?');
    expect(p).toContain('[1] (person #5) John Doe');
    expect(p).toContain('[2] (vehicle #12) 7ABC123 Ford');
  });

  it('buildAskPrompt tolerates no sources', () => {
    expect(buildAskPrompt('q', [])).toContain('(none)');
  });

  it('buildSummaryPrompt lists non-empty sections', () => {
    const p = buildSummaryPrompt('John Doe', {
      warrants: [{ warrant_number: 'W-1', status: 'active' }],
      incidents: [],
    });
    expect(p).toContain('SUBJECT: John Doe');
    expect(p).toContain('WARRANTS (1)');
    expect(p).toContain('W-1 · active');
    expect(p).not.toContain('INCIDENTS'); // empty section omitted
  });

  it('buildExtractPrompt embeds the narrative', () => {
    expect(buildExtractPrompt('subject fled north')).toContain('subject fled north');
  });
});

describe('citationsFrom', () => {
  it('maps in-range [n] markers back to hits, ignoring out-of-range', () => {
    const cites = citationsFrom('Owner is [1]; vehicle [2]. Bogus [9].', hits);
    expect(cites.map((h) => h.id)).toEqual([5, 12]);
  });
  it('returns none when uncited', () => {
    expect(citationsFrom('no citations here', hits)).toEqual([]);
  });
});

describe('extractJson + parseExtract', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced JSON', () => {
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('parses JSON after leading prose', () => {
    expect(extractJson('Here you go: {"a":3} thanks')).toEqual({ a: 3 });
  });
  it('returns null on non-JSON', () => {
    expect(extractJson('no json at all')).toBeNull();
    expect(extractJson('')).toBeNull();
  });
  it('parseExtract normalizes to four arrays', () => {
    const r = parseExtract('```json\n{"persons":[{"name":"A"}],"vehicles":[],"locations":["Main St"]}\n```');
    expect(r.persons).toHaveLength(1);
    expect(r.locations).toEqual(['Main St']);
    expect(r.vehicles).toEqual([]);
    expect(r.links).toEqual([]); // missing key → empty array
  });
  it('parseExtract is safe on garbage', () => {
    expect(parseExtract('the model refused')).toEqual({ persons: [], vehicles: [], locations: [], links: [] });
  });
});
