import { describe, it, expect } from 'vitest';
import {
  validateMdtSend, counterpartEndpoint, inboxDirectionFor, normalizeEndpoint,
} from '../src/utils/mdtMessage';

describe('validateMdtSend', () => {
  it('accepts an explicit direction', () => {
    const r = validateMdtSend({ direction: 'to_mdt', type: 'scan', payload: { dl: '123' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.direction).toBe('to_mdt');
      expect(r.value.type).toBe('scan');
      expect(r.value.payload).toEqual({ dl: '123' });
    }
  });

  it('accepts the {to} alias', () => {
    const r = validateMdtSend({ to: 'phone', type: 'call', payload: {} });
    expect(r.ok && r.value.direction).toBe('to_phone');
  });

  it('defaults a missing/invalid payload to {}', () => {
    const r = validateMdtSend({ to: 'mdt', type: 'text' });
    expect(r.ok && r.value.payload).toEqual({});
    const r2 = validateMdtSend({ to: 'mdt', type: 'text', payload: ['nope'] });
    expect(r2.ok && r2.value.payload).toEqual({});
  });

  it('rejects a bad direction', () => {
    const r = validateMdtSend({ to: 'car', type: 'scan', payload: {} });
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown type', () => {
    const r = validateMdtSend({ to: 'mdt', type: 'bogus', payload: {} });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object body', () => {
    expect(validateMdtSend(null).ok).toBe(false);
    expect(validateMdtSend('x').ok).toBe(false);
  });
});

describe('endpoint helpers', () => {
  it('counterpartEndpoint flips', () => {
    expect(counterpartEndpoint('mdt')).toBe('phone');
    expect(counterpartEndpoint('phone')).toBe('mdt');
  });
  it('inboxDirectionFor matches the reading end', () => {
    expect(inboxDirectionFor('mdt')).toBe('to_mdt');
    expect(inboxDirectionFor('phone')).toBe('to_phone');
  });
  it('normalizeEndpoint defaults to phone', () => {
    expect(normalizeEndpoint('mdt')).toBe('mdt');
    expect(normalizeEndpoint('garbage')).toBe('phone');
    expect(normalizeEndpoint(undefined)).toBe('phone');
  });
});
