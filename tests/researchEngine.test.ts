// tests/researchEngine.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseJsonLoose, parseAngles, parseFindings, parseVerdict,
  deriveTrust, numberCitations, mergeAngles, runResearchLLM,
} from '../src/utils/researchEngine';

// env stub: no Anthropic key (DB.first → null) so the Claude rung is skipped and
// we exercise the Workers AI fallback's response coercion.
function stubEnv(aiRun: (...a: any[]) => Promise<any>): any {
  return {
    DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
    AI: { run: aiRun },
  };
}

describe('parseJsonLoose', () => {
  it('parses fenced json (the open_ai@v4 fence bug)', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('parses leading-prose json and returns null on garbage', () => {
    expect(parseJsonLoose('Here: [1,2]')).toEqual([1, 2]);
    expect(parseJsonLoose('not json')).toBeNull();
  });
});

describe('parseAngles', () => {
  it('reads {angles:[...]}, dedupes case-insensitively, caps', () => {
    const out = parseAngles('{"angles":["Criminal","criminal","Business","News","X","Y","Z"]}', 6);
    expect(out).toEqual(['Criminal', 'Business', 'News', 'X', 'Y', 'Z']);
  });
  it('falls back to bullet lines', () => {
    expect(parseAngles('- one\n- two')).toEqual(['one', 'two']);
  });
});

describe('mergeAngles', () => {
  it('puts seed angles first, dedupes, caps', () => {
    expect(mergeAngles(['Seed'], ['seed', 'Other'], 6)).toEqual(['Seed', 'Other']);
  });
});

describe('parseFindings', () => {
  it('normalizes type, clamps confidence, filters bad urls', () => {
    const out = parseFindings('{"findings":[{"finding_type":"bogus","title":"T","detail":"D","confidence":2,"source_urls":["https://a",5]}]}');
    expect(out[0].finding_type).toBe('fact');
    expect(out[0].confidence).toBe(1);
    expect(out[0].source_urls).toEqual(['https://a']);
  });
});

describe('parseVerdict', () => {
  it('classifies', () => {
    expect(parseVerdict('{"verdict":"refuted"}')).toBe('refuted');
    expect(parseVerdict('SUPPORTED by source 1')).toBe('supported');
    expect(parseVerdict('hmm not sure')).toBe('uncertain');
  });
});

describe('deriveTrust', () => {
  it('refuted floors near zero', () => {
    expect(deriveTrust({ confidence: 0.99, sourceCount: 5, verdict: 'refuted' })).toBeLessThan(0.1);
  });
  it('single source caps at 0.85 even at confidence 1', () => {
    expect(deriveTrust({ confidence: 1, sourceCount: 1, verdict: 'supported' })).toBeCloseTo(0.85, 2);
  });
  it('consensus raises, uncertain halves-ish', () => {
    expect(deriveTrust({ confidence: 0.8, sourceCount: 3, verdict: 'supported' })).toBeGreaterThan(0.8);
    expect(deriveTrust({ confidence: 0.8, sourceCount: 1, verdict: 'uncertain' })).toBeLessThan(0.6);
  });
});

describe('runResearchLLM Workers AI response coercion', () => {
  it('stringifies an array response so JSON-eliciting stages survive (the expand crash)', async () => {
    // Live @cf/meta/llama-3.3-70b returns `response` as a PARSED array when the
    // prompt asks for JSON — not a string. Regression for "Angle expansion
    // produced no angles (LLM engine unavailable?)".
    const env = stubEnv(async () => ({ response: ['Criminal history', 'Business ties'] }));
    const text = await runResearchLLM(env, { user: 'plan angles' });
    expect(parseAngles(text, 6)).toEqual(['Criminal history', 'Business ties']);
  });

  it('stringifies an object response so extract findings survive', async () => {
    const env = stubEnv(async () => ({
      response: { findings: [{ finding_type: 'fact', title: 'T', detail: 'D', confidence: 0.5, source_urls: [] }] },
    }));
    const text = await runResearchLLM(env, { user: 'extract' });
    expect(parseFindings(text)).toHaveLength(1);
  });

  it('passes a plain string response through unchanged', async () => {
    const env = stubEnv(async () => ({ response: 'hello report' }));
    expect(await runResearchLLM(env, { user: 'synthesize' })).toBe('hello report');
  });

  it('returns empty string for a missing/null response', async () => {
    const env = stubEnv(async () => ({}));
    expect(await runResearchLLM(env, { user: 'x' })).toBe('');
  });
});

describe('numberCitations', () => {
  it('assigns [n] per unique url in order', () => {
    const m = numberCitations(['u1', 'u2', 'u1', 'u3']);
    expect(m.get('u1')).toBe(1);
    expect(m.get('u2')).toBe(2);
    expect(m.get('u3')).toBe(3);
  });
});
