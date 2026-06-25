import { describe, it, expect } from 'vitest';
import { logEntryActor, logEntryDate } from '../equipmentCustodyPdf';
import { toDisplayLabel } from '../formatters';

describe('toDisplayLabel (used for actions)', () => {
  it('converts snake_case to Title Case', () => {
    expect(toDisplayLabel('check_in')).toBe('Check In');
    expect(toDisplayLabel('check_out')).toBe('Check Out');
    expect(toDisplayLabel('return_to_room')).toBe('Return to Room');
  });
  it('handles a single-word action', () => {
    expect(toDisplayLabel('checkout')).toBe('Checkout');
  });
  it('returns em-dash for missing value', () => {
    expect(toDisplayLabel(undefined)).toBe('—');
    expect(toDisplayLabel('')).toBe('—');
  });
});

describe('logEntryDate', () => {
  it('prefers checkout_date over checkin_date', () => {
    expect(logEntryDate({
      checkout_date: '2026-06-22T10:00:00Z',
      checkin_date: '2026-06-22T11:00:00Z',
      created_at: '2026-06-22T12:00:00Z',
    })).toBe('2026-06-22T10:00:00Z');
  });
  it('falls back to checkin_date when checkout_date missing', () => {
    expect(logEntryDate({
      checkin_date: '2026-06-22T11:00:00Z',
      created_at: '2026-06-22T12:00:00Z',
    })).toBe('2026-06-22T11:00:00Z');
  });
  it('falls back to created_at when only audit timestamp present', () => {
    expect(logEntryDate({ created_at: '2026-06-22T12:00:00Z' })).toBe('2026-06-22T12:00:00Z');
  });
  it('returns empty string when none present', () => {
    expect(logEntryDate({})).toBe('');
  });
});

describe('logEntryActor', () => {
  it('prefers checked_by_name (joined human name) over performed_by id', () => {
    expect(logEntryActor({ checked_by_name: 'Smith, J', performed_by: 'user-123' }))
      .toBe('Smith, J');
  });
  it('falls back to performed_by when no joined name', () => {
    expect(logEntryActor({ performed_by: 'user-123' })).toBe('user-123');
  });
  it('returns em-dash when neither', () => {
    expect(logEntryActor({})).toBe('—');
  });
});
