import { describe, it, expect } from 'vitest';
import { diagnoseOpenAiError } from '../src/utils/openai';

describe('diagnoseOpenAiError', () => {
  it('classifies 401 as invalid key', () => {
    const { status, hint } = diagnoseOpenAiError('OpenAI 401: Incorrect API key provided');
    expect(status).toBe(401);
    expect(hint).toMatch(/invalid|incorrect/i);
  });

  it('classifies 429 with quota hint as out-of-credit', () => {
    const { status, hint } = diagnoseOpenAiError('OpenAI 429: You exceeded your current quota');
    expect(status).toBe(429);
    expect(hint).toMatch(/credit|quota|out of/i);
  });

  it('classifies 429 without quota hint as rate-limit', () => {
    const { status, hint } = diagnoseOpenAiError('OpenAI 429: Too many requests');
    expect(status).toBe(429);
    expect(hint).toMatch(/rate.?limit|try again/i);
  });

  it('classifies 403 as missing model permission', () => {
    const { status, hint } = diagnoseOpenAiError('OpenAI 403: The model `gpt-4o` does not exist or you do not have access');
    expect(status).toBe(403);
    expect(hint).toMatch(/permission|access|model/i);
  });

  it('classifies 5xx as server error', () => {
    const { status, hint } = diagnoseOpenAiError('OpenAI 500: server error');
    expect(status).toBe(500);
    expect(hint).toMatch(/server|retry/i);
  });

  it('passes through unrecognized messages', () => {
    const { status, hint } = diagnoseOpenAiError('totally unrelated string');
    expect(status).toBeNull();
    expect(hint.length).toBeLessThanOrEqual(200);
  });
});
