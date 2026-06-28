import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypeaheadKeyboard } from '../useTypeaheadKeyboard';

// Minimal KeyboardEvent stub for the hook — the hook only reads `e.key`
// and calls `e.preventDefault()`. Casting to any is fine because the hook
// only touches those two members.
const ev = (key: string): any => ({ key, preventDefault: vi.fn() });

const ITEMS = ['a', 'b', 'c'] as string[];

describe('useTypeaheadKeyboard', () => {
  it('starts with activeIndex = -1 when open', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    expect(result.current.activeIndex).toBe(-1);
    expect(result.current.activeDescendantId).toBeNull();
  });

  it('ArrowDown advances and wraps to 0 at the end', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('ArrowDown')); });
    expect(result.current.activeIndex).toBe(0);
    act(() => { result.current.onKeyDown(ev('ArrowDown')); });
    expect(result.current.activeIndex).toBe(1);
    act(() => { result.current.onKeyDown(ev('ArrowDown')); });
    expect(result.current.activeIndex).toBe(2);
    act(() => { result.current.onKeyDown(ev('ArrowDown')); }); // wraps
    expect(result.current.activeIndex).toBe(0);
  });

  it('ArrowUp from -1 jumps to the last item; further ups walk backward', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('ArrowUp')); });
    expect(result.current.activeIndex).toBe(2);
    act(() => { result.current.onKeyDown(ev('ArrowUp')); });
    expect(result.current.activeIndex).toBe(1);
  });

  it('Home jumps to first, End jumps to last', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('End')); });
    expect(result.current.activeIndex).toBe(2);
    act(() => { result.current.onKeyDown(ev('Home')); });
    expect(result.current.activeIndex).toBe(0);
  });

  it('Enter with no active index selects the FIRST item (top-hit behavior)', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('Enter')); });
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('Enter with an active index selects that item', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('ArrowDown')); }); // 0
    act(() => { result.current.onKeyDown(ev('ArrowDown')); }); // 1
    act(() => { result.current.onKeyDown(ev('Enter')); });
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('Enter on an empty list does nothing', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: [], onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('Enter')); });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Escape closes the dropdown', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('Escape')); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keyboard nav is a no-op when closed (caller opens via onFocus instead)', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: false, items: ITEMS, onSelect, onClose }));
    act(() => { result.current.onKeyDown(ev('ArrowDown')); });
    expect(result.current.activeIndex).toBe(-1);
    act(() => { result.current.onKeyDown(ev('Enter')); });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('other keys (typed character) are pass-through — preventDefault NOT called', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose }));
    const e = ev('x');
    act(() => { result.current.onKeyDown(e); });
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('listboxProps has role=listbox and a stable id derived from idPrefix', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose, idPrefix: 'tp-test' }));
    expect(result.current.listboxProps.role).toBe('listbox');
    expect(result.current.listboxProps.id).toBe('tp-test-listbox');
  });

  it('optionProps marks the matching selected item and exposes role=option', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose, idPrefix: 'tp-test' }));
    const props = result.current.optionProps(1, true);
    expect(props.role).toBe('option');
    expect(props['aria-selected']).toBe(true);
    expect(props.id).toBe('tp-test-1');
  });

  it('activeDescendantId is the id of the focused option, null when none', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result } = renderHook(() =>
      useTypeaheadKeyboard({ open: true, items: ITEMS, onSelect, onClose, idPrefix: 'tp' }));
    expect(result.current.activeDescendantId).toBeNull();
    act(() => { result.current.onKeyDown(ev('ArrowDown')); });
    expect(result.current.activeDescendantId).toBe('tp-0');
    act(() => { result.current.onKeyDown(ev('ArrowDown')); });
    expect(result.current.activeDescendantId).toBe('tp-1');
  });

  it('clamps activeIndex when items shrink', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ items }) => useTypeaheadKeyboard({ open: true, items, onSelect, onClose }),
      { initialProps: { items: ITEMS } },
    );
    // Focus position 2
    act(() => { result.current.onKeyDown(ev('End')); });
    expect(result.current.activeIndex).toBe(2);
    // Items shrink to 1 — index 2 is now out of range
    rerender({ items: ['a'] });
    expect(result.current.activeIndex).toBe(0);
  });

  it('resets activeIndex to -1 when open transitions to false', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ open }) => useTypeaheadKeyboard({ open, items: ITEMS, onSelect, onClose }),
      { initialProps: { open: true } },
    );
    act(() => { result.current.onKeyDown(ev('ArrowDown')); });
    expect(result.current.activeIndex).toBe(0);
    rerender({ open: false });
    expect(result.current.activeIndex).toBe(-1);
  });
});
