import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePersistedPreviewMode } from '../usePersistedPreviewMode';

beforeEach(() => localStorage.clear());

describe('usePersistedPreviewMode', () => {
  it('defaults to "modal"', () => {
    const { result } = renderHook(() => usePersistedPreviewMode());
    expect(result.current[0]).toBe('modal');
  });

  it('persists mode to localStorage and rehydrates', () => {
    const { result } = renderHook(() => usePersistedPreviewMode());
    act(() => result.current[1]('side'));
    expect(localStorage.getItem('rmpg.citation.preview_mode')).toBe('side');
    const { result: r2 } = renderHook(() => usePersistedPreviewMode());
    expect(r2.current[0]).toBe('side');
  });
});
