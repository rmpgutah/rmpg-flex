import { describe, it, expect } from 'vitest';
import {
  parseChain,
  prettyAction,
  chainEntryActor,
  chainEntryDate,
  chainEntryLocation,
} from '../evidenceItemPdf';

describe('parseChain', () => {
  it('returns [] for null / undefined / empty', () => {
    expect(parseChain(null as any)).toEqual([]);
    expect(parseChain(undefined)).toEqual([]);
    expect(parseChain('')).toEqual([]);
  });
  it('passes through an already-parsed array', () => {
    const arr = [{ action: 'check_in' }];
    expect(parseChain(arr)).toEqual(arr);
  });
  it('parses a JSON string', () => {
    expect(parseChain('[{"action":"check_in"}]')).toEqual([{ action: 'check_in' }]);
  });
  it('returns [] on malformed JSON (no throw)', () => {
    expect(parseChain('{not valid')).toEqual([]);
  });
  it('returns [] when the JSON parses to a non-array', () => {
    expect(parseChain('{"action":"check_in"}')).toEqual([]);
  });
});

describe('prettyAction', () => {
  it('converts snake_case to Title Case', () => {
    expect(prettyAction('check_in')).toBe('Check In');
    expect(prettyAction('release_to_owner')).toBe('Release To Owner');
  });
  it('handles a single-word action', () => {
    expect(prettyAction('checkin')).toBe('Checkin');
  });
  it('returns em-dash for missing value', () => {
    expect(prettyAction(undefined)).toBe('—');
    expect(prettyAction('')).toBe('—');
  });
});

describe('chainEntryDate', () => {
  it('prefers `at` over `timestamp`', () => {
    expect(chainEntryDate({ at: '2026-06-22T10:00:00Z', timestamp: '2026-06-22T11:00:00Z' }))
      .toBe('2026-06-22T10:00:00Z');
  });
  it('falls back to `timestamp` when `at` missing', () => {
    expect(chainEntryDate({ timestamp: '2026-06-22T10:00:00Z' })).toBe('2026-06-22T10:00:00Z');
  });
  it('returns empty string when neither present', () => {
    expect(chainEntryDate({})).toBe('');
  });
});

describe('chainEntryActor', () => {
  it('prefers by_name over by', () => {
    expect(chainEntryActor({ by_name: 'Smith, J', by: 'jsmith' })).toBe('Smith, J');
  });
  it('falls back to by', () => {
    expect(chainEntryActor({ by: 'jsmith' })).toBe('jsmith');
  });
  it('returns em-dash when neither', () => {
    expect(chainEntryActor({})).toBe('—');
  });
});

describe('chainEntryLocation', () => {
  it('prefers to_location (most recent destination)', () => {
    expect(chainEntryLocation({ to_location: 'Locker A', from_location: 'Lab', location: 'Cabinet 7' }))
      .toBe('Locker A');
  });
  it('falls back to location', () => {
    expect(chainEntryLocation({ location: 'Cabinet 7' })).toBe('Cabinet 7');
  });
  it('falls back to from_location when nothing else', () => {
    expect(chainEntryLocation({ from_location: 'Lab' })).toBe('Lab');
  });
  it('returns em-dash when none', () => {
    expect(chainEntryLocation({})).toBe('—');
  });
});
