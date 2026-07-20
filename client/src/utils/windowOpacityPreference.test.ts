import { describe, it, expect, beforeEach } from 'vitest';
import { getDefaultWindowOpacity, setDefaultWindowOpacity } from './windowOpacityPreference';

describe('windowOpacityPreference', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 1 (fully opaque)', () => {
    expect(getDefaultWindowOpacity()).toBe(1);
  });

  it('setDefaultWindowOpacity persists and getDefaultWindowOpacity reflects it', () => {
    setDefaultWindowOpacity(0.7);
    expect(getDefaultWindowOpacity()).toBe(0.7);
  });

  it('clamps below 0.3 up to the 0.3 floor', () => {
    setDefaultWindowOpacity(0.1);
    expect(getDefaultWindowOpacity()).toBe(0.3);
  });

  it('clamps above 1 down to the 1.0 ceiling', () => {
    setDefaultWindowOpacity(1.5);
    expect(getDefaultWindowOpacity()).toBe(1);
  });

  it('rounds to one decimal to avoid float drift', () => {
    setDefaultWindowOpacity(0.1 + 0.2); // 0.30000000000000004 in raw JS float math
    expect(getDefaultWindowOpacity()).toBe(0.3);
  });
});
