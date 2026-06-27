import { describe, it, expect } from 'vitest';
import { claudeResponseText, diagnoseAnthropicError } from '../src/utils/anthropic';

describe('claudeResponseText', () => {
  it('joins the text blocks from a Claude messages response', () => {
    const json = { content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'world' }] };
    expect(claudeResponseText(json)).toBe('Hello\nworld');
  });

  it('ignores non-text content blocks (e.g. tool_use)', () => {
    const json = { content: [{ type: 'tool_use', name: 'x' }, { type: 'text', text: 'kept' }] };
    expect(claudeResponseText(json)).toBe('kept');
  });

  it('returns empty string for a malformed / errored response', () => {
    expect(claudeResponseText({})).toBe('');
    expect(claudeResponseText(null)).toBe('');
    expect(claudeResponseText({ error: { message: 'overloaded' } })).toBe('');
  });
});

describe('diagnoseAnthropicError', () => {
  it('maps 401 to invalid key', () => {
    expect(diagnoseAnthropicError('Anthropic 401: {"error":{"message":"invalid x-api-key"}}'))
      .toEqual({ status: 401, hint: 'Invalid API key' });
  });
  it('detects out-of-credit on a 400 mentioning credit/balance', () => {
    const r = diagnoseAnthropicError('Anthropic 400: {"error":{"message":"Your credit balance is too low"}}');
    expect(r.status).toBe(400);
    expect(r.hint).toMatch(/credit/i);
  });
  it('treats a plain 400 as a model/param problem, not credit', () => {
    expect(diagnoseAnthropicError('Anthropic 400: {"error":{"message":"model: unknown"}}').hint)
      .toMatch(/model/i);
  });
  it('separates rate-limit from quota on 429', () => {
    expect(diagnoseAnthropicError('Anthropic 429: rate_limit_error').hint).toMatch(/rate limit/i);
    expect(diagnoseAnthropicError('Anthropic 429: quota exceeded').hint).toMatch(/credit|quota/i);
  });
  it('flags 5xx as a server-side error', () => {
    expect(diagnoseAnthropicError('Anthropic 529: overloaded').hint).toMatch(/server error/i);
  });
  it('falls back to the raw message when shape is unrecognized', () => {
    expect(diagnoseAnthropicError('TypeError: fetch failed')).toEqual({ status: null, hint: 'TypeError: fetch failed' });
  });
});
