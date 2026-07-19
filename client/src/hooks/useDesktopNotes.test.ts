import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDesktopNotes } from './useDesktopNotes';

describe('useDesktopNotes', () => {
  it('adds a note at the given position with default size/color/empty text', () => {
    const { result } = renderHook(() => useDesktopNotes([]));
    act(() => result.current.addNote(40, 60));
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]).toMatchObject({ x: 40, y: 60, text: '', color: 'amber' });
  });

  it('updateNote patches only the given note', () => {
    const { result } = renderHook(() => useDesktopNotes([
      { id: 'a', x: 0, y: 0, width: 180, height: 140, text: '', color: 'amber' },
      { id: 'b', x: 10, y: 10, width: 180, height: 140, text: '', color: 'amber' },
    ]));
    act(() => result.current.updateNote('a', { text: 'Follow up on BOLO' }));
    expect(result.current.notes.find(n => n.id === 'a')?.text).toBe('Follow up on BOLO');
    expect(result.current.notes.find(n => n.id === 'b')?.text).toBe('');
  });

  it('deleteNote removes only the given note', () => {
    const { result } = renderHook(() => useDesktopNotes([
      { id: 'a', x: 0, y: 0, width: 180, height: 140, text: '', color: 'amber' },
    ]));
    act(() => result.current.deleteNote('a'));
    expect(result.current.notes).toHaveLength(0);
  });

  it('clearNotes empties the notes array', () => {
    const { result } = renderHook(() => useDesktopNotes([
      { id: 'a', x: 0, y: 0, width: 180, height: 140, text: '', color: 'amber' },
      { id: 'b', x: 10, y: 10, width: 180, height: 140, text: '', color: 'amber' },
    ]));
    expect(result.current.notes).toHaveLength(2);
    act(() => result.current.clearNotes());
    expect(result.current.notes).toHaveLength(0);
  });
});
