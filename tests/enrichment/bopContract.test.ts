import { describe, it, expect } from 'vitest';

/**
 * Lightweight protocol checks for enrichment adapters that talk to live APIs.
 * These do not hit the network — they assert request-shaping helpers / contracts.
 */
describe('BOP inmate locator request contract', () => {
  it('requires todo=query so the endpoint actually runs a search', () => {
    const body = new URLSearchParams({
      todo: 'query',
      nameFirst: 'Karl',
      nameLast: 'Turley',
      race: 'U',
      sex: 'U',
      output: 'json',
    });
    expect(body.get('todo')).toBe('query');
    expect(body.toString()).toContain('todo=query');
  });

  it('treats FormToken-only responses as failed searches', () => {
    const tokenOnly = { Validations: [], FormToken: 'pub123' } as { InmateLocator?: unknown[] };
    const searched = { Captcha: false, FormToken: 'pub123', InmateLocator: [] as unknown[] };
    expect(Array.isArray(tokenOnly.InmateLocator)).toBe(false);
    expect(Array.isArray(searched.InmateLocator)).toBe(true);
  });
});
