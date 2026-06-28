import { describe, it, expect } from 'vitest';
import {
  shouldLogPlate,
  patrolAlertText,
  normalizePlate,
  PATROL_DEDUP_MS,
} from '../patrolScan';

describe('normalizePlate', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizePlate(' abc-123 ')).toBe('ABC123');
    expect(normalizePlate('a1b2·c3')).toBe('A1B2C3');
  });
  it('handles null/undefined/empty', () => {
    expect(normalizePlate(null)).toBe('');
    expect(normalizePlate(undefined)).toBe('');
    expect(normalizePlate('  ')).toBe('');
  });
});

describe('shouldLogPlate', () => {
  it('logs a never-seen plate and records it', () => {
    const seen = new Map<string, number>();
    expect(shouldLogPlate('ABC123', 1000, seen)).toBe(true);
    expect(seen.get('ABC123')).toBe(1000);
  });

  it('suppresses the same plate inside the dedup window', () => {
    const seen = new Map<string, number>();
    shouldLogPlate('ABC123', 1000, seen);
    // 1ms before the window closes
    expect(shouldLogPlate('ABC123', 1000 + PATROL_DEDUP_MS - 1, seen)).toBe(false);
  });

  it('re-logs the same plate once the window has elapsed', () => {
    const seen = new Map<string, number>();
    shouldLogPlate('ABC123', 1000, seen);
    expect(shouldLogPlate('ABC123', 1000 + PATROL_DEDUP_MS, seen)).toBe(true);
    // and the timestamp advanced
    expect(seen.get('ABC123')).toBe(1000 + PATROL_DEDUP_MS);
  });

  it('treats normalized variants as the same plate', () => {
    const seen = new Map<string, number>();
    expect(shouldLogPlate('abc-123', 1000, seen)).toBe(true);
    expect(shouldLogPlate('ABC 123', 2000, seen)).toBe(false);
  });

  it('never logs empty / unreadable plates', () => {
    const seen = new Map<string, number>();
    expect(shouldLogPlate('', 1000, seen)).toBe(false);
    expect(shouldLogPlate(null, 1000, seen)).toBe(false);
    expect(seen.size).toBe(0);
  });

  it('honors a custom window', () => {
    const seen = new Map<string, number>();
    shouldLogPlate('XYZ', 0, seen, 100);
    expect(shouldLogPlate('XYZ', 50, seen, 100)).toBe(false);
    expect(shouldLogPlate('XYZ', 100, seen, 100)).toBe(true);
  });
});

describe('patrolAlertText', () => {
  it('returns null when there are no critical hits', () => {
    expect(patrolAlertText('ABC123', [])).toBeNull();
    expect(patrolAlertText('ABC123', null)).toBeNull();
    expect(patrolAlertText('ABC123', [{ severity: 'info', detail: 'note' }])).toBeNull();
  });

  it('builds threat-led text with the plate for a critical hit', () => {
    expect(
      patrolAlertText('abc-123', [{ severity: 'critical', detail: 'Stolen vehicle' }]),
    ).toBe('Stolen vehicle. Plate ABC123.');
  });

  it('joins multiple critical details', () => {
    expect(
      patrolAlertText('XYZ9', [
        { severity: 'critical', detail: 'Stolen vehicle' },
        { severity: 'critical', detail: 'Felony warrant' },
        { severity: 'info', detail: 'ignored' },
      ]),
    ).toBe('Stolen vehicle. Felony warrant. Plate XYZ9.');
  });

  it('falls back to a generic lead when detail is blank', () => {
    expect(patrolAlertText('XYZ9', [{ severity: 'critical', detail: '' }])).toBe(
      'Wanted vehicle. Plate XYZ9.',
    );
  });

  it('omits the plate clause when plate is unreadable', () => {
    expect(patrolAlertText('', [{ severity: 'critical', detail: 'Stolen vehicle' }])).toBe(
      'Stolen vehicle.',
    );
  });
});
