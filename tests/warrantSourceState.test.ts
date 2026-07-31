import { describe, it, expect } from 'vitest';
import { stateFromSourceKey } from '../src/utils/warrantSourceState';

// The source keys below are the REAL ones read out of live D1 / GET
// /warrants/scrapers on 2026-07-30. Using live keys matters: both previous
// implementations of this derivation passed their authors' mental model and
// failed on the actual data.
describe('stateFromSourceKey — live source keys', () => {
  it('resolves a trailing state code (the live shape both old parsers missed)', () => {
    // Both old parsers anchored to the START of the key, so neither matched
    // these at all — verified against the live keys, both returned null. The
    // Warrants list SOURCE column was blank on every row and ?state= matched
    // nothing.
    expect(stateFromSourceKey('ada-county-id')).toBe('ID');
    expect(stateFromSourceKey('natrona-county-wy')).toBe('WY');
  });

  it('never returns the leading two characters of the key as a state', () => {
    // Guard against "fix" the obvious-but-wrong way — slicing the first two
    // characters would make this 'AD', which is not a US state.
    expect(stateFromSourceKey('ada-county-id')).not.toBe('AD');
    expect(stateFromSourceKey('natrona-county-wy')).not.toBe('NA');
  });

  it('resolves a spelled-out state name in any segment', () => {
    expect(stateFromSourceKey('ohio-drc-pval')).toBe('OH');
    expect(stateFromSourceKey('utah-warrant-watch')).toBe('UT');
    expect(stateFromSourceKey('utah_api')).toBe('UT');
  });

  it('still resolves the legacy leading-code shape', () => {
    expect(stateFromSourceKey('ut_district')).toBe('UT');
    expect(stateFromSourceKey('tx-municipal-court')).toBe('TX');
  });

  it('buckets federal sources as FED rather than guessing a state', () => {
    expect(stateFromSourceKey('fed_marshals')).toBe('FED');
    expect(stateFromSourceKey('federal-bop')).toBe('FED');
  });

  it('returns null — never a guess — when the state is undeterminable', () => {
    // A wrong code silently mis-files a warrant under another jurisdiction,
    // which is worse than an honest unknown.
    expect(stateFromSourceKey('local')).toBeNull();
    expect(stateFromSourceKey('national')).toBeNull();
    expect(stateFromSourceKey('some-unknown-vendor')).toBeNull();
    expect(stateFromSourceKey('')).toBeNull();
    expect(stateFromSourceKey(null)).toBeNull();
    expect(stateFromSourceKey(undefined)).toBeNull();
  });

  it('is case- and whitespace-insensitive', () => {
    expect(stateFromSourceKey('  ADA-COUNTY-ID  ')).toBe('ID');
  });

  it('does not treat a non-state two-letter segment as a state', () => {
    // 'zz' is not a state code; must not be echoed back just because it is
    // two characters in the right position.
    expect(stateFromSourceKey('foo-county-zz')).toBeNull();
  });
});
