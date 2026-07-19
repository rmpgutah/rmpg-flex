import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraggablePosition } from './useDraggablePosition';

describe('useDraggablePosition', () => {
  it('calls onMove with the origin position plus pointer delta on drag', () => {
    const onMove = vi.fn();
    const { result } = renderHook(() => useDraggablePosition(50, 60, onMove));

    act(() => {
      result.current.onPointerDown({ clientX: 100, clientY: 100 } as React.PointerEvent);
    });
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 130, clientY: 90 }));
    });
    expect(onMove).toHaveBeenCalledWith(80, 50); // 50+30, 60-10

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'));
    });
    onMove.mockClear();
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 999, clientY: 999 }));
    });
    expect(onMove).not.toHaveBeenCalled(); // listeners removed after pointerup
  });
});
