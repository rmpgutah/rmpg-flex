import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useProximityAlerts } from '../useProximityAlerts';
import type { ProximityInputs, UseProximityAlertsOptions } from '../useProximityAlerts';

// Spy on the Web Audio API so we can count actual tone playback.
let oscStart: ReturnType<typeof vi.fn>;

beforeEach(() => {
  oscStart = vi.fn();
  (window as any).AudioContext = class {
    state = 'running';
    currentTime = 0;
    resume() { return Promise.resolve(); }
    createOscillator() {
      return {
        type: '', frequency: { value: 0 },
        connect: () => ({ connect: () => {} }),
        start: oscStart, stop: () => {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: (n: any) => n,
      };
    }
  };
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as any).AudioContext;
});

describe('useProximityAlerts', () => {
  it('plays a tone on the rising edge and exposes the banner', () => {
    const { result, rerender } = renderHook(
      (p: { inputs: ProximityInputs; opts?: UseProximityAlertsOptions }) =>
        useProximityAlerts(p.inputs, p.opts),
      { initialProps: { inputs: { priorityCallNear: false } } },
    );
    expect(result.current.navAlert).toBe(null);
    rerender({ inputs: { priorityCallNear: true } });
    expect(oscStart).toHaveBeenCalledTimes(1);
    expect(result.current.navAlert?.type).toBe('priority-call');
  });

  it('suppresses a second tone within the global cooldown', () => {
    const { rerender } = renderHook(
      (p: { inputs: ProximityInputs }) =>
        useProximityAlerts(p.inputs, { cooldownSeconds: 10 }),
      { initialProps: { inputs: {} } },
    );
    rerender({ inputs: { priorityCallNear: true } });   // edge → tone 1
    expect(oscStart).toHaveBeenCalledTimes(1);
    rerender({ inputs: { priorityCallNear: false } });
    vi.setSystemTime(2000); // only 2s later, < 10s cooldown
    rerender({ inputs: { highCrimeAhead: true } });     // edge but cooled down
    expect(oscStart).toHaveBeenCalledTimes(1);
  });

  it('does not fire a muted type', () => {
    const { rerender } = renderHook(
      (p: { inputs: ProximityInputs }) =>
        useProximityAlerts(p.inputs, { perType: { 'high-crime': false } }),
      { initialProps: { inputs: {} } },
    );
    rerender({ inputs: { highCrimeAhead: true } });
    expect(oscStart).not.toHaveBeenCalled();
  });
});
