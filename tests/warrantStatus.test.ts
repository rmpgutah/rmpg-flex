import { describe, it, expect } from 'vitest';
import {
  WARRANT_STATUSES, TERMINAL_STATUSES, isValidStatus, isValidTransition,
} from '../src/utils/warrantStatus';

describe('warrantStatus', () => {
  it('lists exactly the 5 canonical statuses', () => {
    expect(WARRANT_STATUSES).toEqual(['active', 'served', 'recalled', 'expired', 'quashed']);
  });

  it('isValidStatus accepts only the canonical 5', () => {
    expect(isValidStatus('active')).toBe(true);
    expect(isValidStatus('served')).toBe(true);
    expect(isValidStatus('closed')).toBe(false);
    expect(isValidStatus('')).toBe(false);
    expect(isValidStatus(undefined)).toBe(false);
    expect(isValidStatus(123)).toBe(false);
  });

  it('TERMINAL_STATUSES contains served/recalled/expired/quashed, not active', () => {
    expect(TERMINAL_STATUSES.has('served')).toBe(true);
    expect(TERMINAL_STATUSES.has('recalled')).toBe(true);
    expect(TERMINAL_STATUSES.has('expired')).toBe(true);
    expect(TERMINAL_STATUSES.has('quashed')).toBe(true);
    expect(TERMINAL_STATUSES.has('active')).toBe(false);
  });

  it('active can transition to served, recalled, quashed, or expired', () => {
    expect(isValidTransition('active', 'served')).toBe(true);
    expect(isValidTransition('active', 'recalled')).toBe(true);
    expect(isValidTransition('active', 'quashed')).toBe(true);
    expect(isValidTransition('active', 'expired')).toBe(true);
  });

  it('a status can stay the same (no-op edit)', () => {
    expect(isValidTransition('active', 'active')).toBe(true);
    expect(isValidTransition('served', 'served')).toBe(true);
  });

  it('terminal statuses cannot transition directly to another terminal or to active', () => {
    expect(isValidTransition('served', 'active')).toBe(false);
    expect(isValidTransition('served', 'recalled')).toBe(false);
    expect(isValidTransition('quashed', 'active')).toBe(false);
    expect(isValidTransition('expired', 'served')).toBe(false);
  });
});
