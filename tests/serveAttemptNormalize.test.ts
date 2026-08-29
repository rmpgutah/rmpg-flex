import { describe, it, expect } from 'vitest';
import {
  coerceAttemptResult,
  defaultPsCodeForResult,
  parseArrivedAtIso,
} from '../src/utils/serveAttemptNormalize';

const ALLOWED = new Set(['served', 'sub_served', 'posted', 'no_answer', 'refused', 'bad_address', 'moved', 'deceased', 'other']);

describe('coerceAttemptResult', () => {
  it('maps the wizard wrong_address alias onto the CHECK enum', () => {
    expect(coerceAttemptResult('wrong_address', 'other', ALLOWED)).toBe('bad_address');
  });

  it('keeps a known result', () => {
    expect(coerceAttemptResult('no_answer', 'other', ALLOWED)).toBe('no_answer');
  });

  it('falls back when the value is unknown', () => {
    expect(coerceAttemptResult('not_a_result', 'other', ALLOWED)).toBe('other');
  });
});

describe('defaultPsCodeForResult', () => {
  it('fills PS/00.01 for a no-answer so queue stays attempted', () => {
    expect(defaultPsCodeForResult('no_answer')).toBe('PS/00.01');
  });

  it('does not auto-fail a job from a bare bad_address result', () => {
    expect(defaultPsCodeForResult('bad_address')).toBeNull();
  });
});

describe('parseArrivedAtIso', () => {
  it('accepts camelCase arrivedAt', () => {
    const iso = parseArrivedAtIso({ arrivedAt: '2026-08-29T12:00:00.000Z' });
    expect(iso).toBe('2026-08-29T12:00:00.000Z');
  });

  it('accepts snake_case arrived_at from iOS', () => {
    const iso = parseArrivedAtIso({ arrived_at: '2026-08-29T12:00:00.000Z' });
    expect(iso).toBe('2026-08-29T12:00:00.000Z');
  });

  it('rejects garbage', () => {
    expect(parseArrivedAtIso({ arrivedAt: 'not-a-date' })).toBeUndefined();
  });
});
