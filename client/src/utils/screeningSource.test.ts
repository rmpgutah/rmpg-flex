import { describe, it, expect } from 'vitest';
import { resolveSourceKey, ALL_SOURCES, type SourceOption } from './screeningSource';

const SOURCES: SourceOption[] = [
  { sourceKey: 'interpol-red', label: 'INTERPOL Red Notices', supportsSearch: true },
  { sourceKey: 'ofac-csl', label: 'OFAC / Consolidated Screening List', supportsSearch: true },
  { sourceKey: 'utah-sor', label: 'Utah Sex Offender Registry', supportsSearch: true },
  { sourceKey: 'watch-only', label: 'Internal Watch (no search)', supportsSearch: false },
];

describe('resolveSourceKey', () => {
  it('treats empty / "all" / "all sources" as the fan-out', () => {
    expect(resolveSourceKey('', SOURCES)).toBe(ALL_SOURCES);
    expect(resolveSourceKey('  ', SOURCES)).toBe(ALL_SOURCES);
    expect(resolveSourceKey('all', SOURCES)).toBe(ALL_SOURCES);
    expect(resolveSourceKey('All Sources', SOURCES)).toBe(ALL_SOURCES);
  });
  it('matches an exact label (case-insensitive)', () => {
    expect(resolveSourceKey('utah sex offender registry', SOURCES)).toBe('utah-sor');
  });
  it('matches an exact source key', () => {
    expect(resolveSourceKey('ofac-csl', SOURCES)).toBe('ofac-csl');
  });
  it('matches a label/key prefix when no exact match', () => {
    expect(resolveSourceKey('Utah', SOURCES)).toBe('utah-sor');
    expect(resolveSourceKey('interpol', SOURCES)).toBe('interpol-red');
  });
  it('never resolves to a non-searchable source', () => {
    expect(resolveSourceKey('Internal Watch (no search)', SOURCES)).toBeNull();
    expect(resolveSourceKey('watch-only', SOURCES)).toBeNull();
  });
  it('returns null for unknown free text', () => {
    expect(resolveSourceKey('national crime db', SOURCES)).toBeNull();
  });
});
