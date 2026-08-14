import { describe, it, expect, beforeEach } from 'vitest';
import { hasBeenSeeded, markSeeded, getDefaultPinsForRole } from '../defaultModulePins';

describe('defaultModulePins', () => {
  beforeEach(() => localStorage.clear());

  it('returns not seeded initially', () => {
    expect(hasBeenSeeded()).toBe(false);
  });

  it('returns seeded after markSeeded', () => {
    markSeeded();
    expect(hasBeenSeeded()).toBe(true);
  });

  it('returns admin-specific pins for admin role', () => {
    const pins = getDefaultPinsForRole('admin');
    expect(pins).toContain('/admin');
    expect(pins).toContain('/dispatch');
  });

  it('falls back to officer pins for unknown role', () => {
    const pins = getDefaultPinsForRole('unknown_role');
    expect(pins).toContain('/dispatch');
    expect(pins).toContain('/mdt');
  });

  it('returns different pins per role', () => {
    const adminPins = getDefaultPinsForRole('admin');
    const officerPins = getDefaultPinsForRole('officer');
    expect(adminPins).not.toEqual(officerPins);
  });
});
