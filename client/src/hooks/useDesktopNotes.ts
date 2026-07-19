import { useState, useCallback } from 'react';

export interface DesktopNote {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
}

export function useDesktopNotes(initial: DesktopNote[]) {
  const [notes, setNotes] = useState<DesktopNote[]>(initial);

  const addNote = useCallback((x: number, y: number) => {
    const note: DesktopNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      x, y, width: 180, height: 140, text: '', color: 'amber',
    };
    setNotes(prev => [...prev, note]);
  }, []);

  const updateNote = useCallback((id: string, patch: Partial<DesktopNote>) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearNotes = useCallback(() => {
    setNotes([]);
  }, []);

  return { notes, addNote, updateNote, deleteNote, clearNotes };
}
