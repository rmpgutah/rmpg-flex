// tests/researchPrompts.test.ts
import { describe, it, expect } from 'vitest';
import { anglePrompt, extractPrompt, verifyPrompt, synthesisPrompt } from '../src/utils/researchPrompts';

describe('anglePrompt', () => {
  it('includes subject, type, and type-specific guidance', () => {
    const { system, user } = anglePrompt('Jane Doe', 'person', 'tip line');
    expect(system).toMatch(/angles/i);
    expect(user).toContain('Jane Doe');
    expect(user).toContain('person');
    expect(user).toContain('tip line');
    expect(user).toMatch(/criminal/i);
  });
  it('falls back to topic guidance for unknown type', () => {
    expect(anglePrompt('X', 'weird').user).toMatch(/overview/i);
  });
});

describe('extractPrompt', () => {
  it('embeds the subject and numbered sources, truncating long markdown', () => {
    const { user } = extractPrompt('ACME', [{ url: 'https://a', markdown: 'x'.repeat(9000) }]);
    expect(user).toContain('ACME');
    expect(user).toContain('https://a');
    expect(user.length).toBeLessThan(6000); // 4000-char cap applied
  });
});

describe('verifyPrompt', () => {
  it('includes the claim and evidence', () => {
    const { user } = verifyPrompt({ title: 'T', detail: 'D' }, [{ url: 'https://a', markdown: 'ev' }]);
    expect(user).toContain('T');
    expect(user).toContain('ev');
  });
});

describe('synthesisPrompt', () => {
  it('lists findings with trust and numbered sources', () => {
    const { user } = synthesisPrompt('ACME',
      [{ title: 'F', detail: 'd', trust: 0.9, citations: [1] }],
      [{ n: 1, url: 'https://a', title: 'A' }]);
    expect(user).toContain('ACME');
    expect(user).toContain('[1]');
    expect(user).toContain('https://a');
  });
});
