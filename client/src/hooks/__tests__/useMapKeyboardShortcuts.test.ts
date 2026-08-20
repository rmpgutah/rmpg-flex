import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapKeyboardShortcuts } from '../useMapKeyboardShortcuts';

describe('useMapKeyboardShortcuts — G coordinate grid', () => {
  afterEach(() => {
    // Clean up any listeners a failed prior run left attached.
    vi.restoreAllMocks();
  });

  it('calls toggleGrid when G is pressed', () => {
    const toggleGrid = vi.fn();
    renderHook(() => useMapKeyboardShortcuts({ toggleGrid }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));

    expect(toggleGrid).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive (Shift+G)', () => {
    const toggleGrid = vi.fn();
    renderHook(() => useMapKeyboardShortcuts({ toggleGrid }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G' }));

    expect(toggleGrid).toHaveBeenCalledTimes(1);
  });
});
