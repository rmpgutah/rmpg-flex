import { describe, it, expect } from 'vitest';
import { getAdapter, getAdapters } from '../src/utils/screening/registry';

describe('screening registry', () => {
  it('registers utah-doc as a searchable, watchable custody source', () => {
    const a = getAdapter('utah-doc');
    expect(a).toBeDefined();
    expect(a!.kind).toBe('custody');
    expect(a!.supportsSearch).toBe(true);
    expect(a!.supportsWatch).toBe(true);
  });
  it('keeps utah-sor present', () => {
    expect(getAdapters().some((a) => a.sourceKey === 'utah-sor')).toBe(true);
  });
});
