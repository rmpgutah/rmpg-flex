import { describe, it, expect } from 'vitest';
import { claudeResponseText } from '../src/utils/anthropic';

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
