import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useNavHotkeys } from '../useNavHotkeys';

function press(key: string, target?: EventTarget) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  if (target) Object.defineProperty(ev, 'target', { value: target });
  window.dispatchEvent(ev);
}

describe('useNavHotkeys', () => {
  it('maps each key to its handler', () => {
    const h = {
      fullscreen: vi.fn(),
      crime: vi.fn(),
      traffic: vi.fn(),
      trail: vi.fn(),
      alerts: vi.fn(),
      search: vi.fn(),
      northUp: vi.fn(),
      close: vi.fn(),
    };
    renderHook(() => useNavHotkeys(h));
    press('f'); press('c'); press('t'); press('b');
    press('a'); press('/'); press('n'); press('Escape');
    expect(h.fullscreen).toHaveBeenCalledTimes(1);
    expect(h.crime).toHaveBeenCalledTimes(1);
    expect(h.traffic).toHaveBeenCalledTimes(1);
    expect(h.trail).toHaveBeenCalledTimes(1);
    expect(h.alerts).toHaveBeenCalledTimes(1);
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.northUp).toHaveBeenCalledTimes(1);
    expect(h.close).toHaveBeenCalledTimes(1);
  });

  it('suppresses shortcuts while an input is focused', () => {
    const crime = vi.fn();
    renderHook(() => useNavHotkeys({ crime }));
    const input = document.createElement('input');
    press('c', input);
    expect(crime).not.toHaveBeenCalled();
  });

  it('does nothing when disabled', () => {
    const crime = vi.fn();
    renderHook(() => useNavHotkeys({ crime }, { enabled: false }));
    press('c');
    expect(crime).not.toHaveBeenCalled();
  });
});
