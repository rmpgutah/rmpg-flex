import { describe, it, expect } from 'vitest';
import {
  emptyNote, filterPadNotes, loadPadNotes, notesToPlaintext, NOTEPAD_LEGACY_KEY, NOTEPAD_NOTES_KEY, savePadNotes, upsertPadNote,
} from '../notepadStore';

class MemStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('notepadStore', () => {
  it('migrates a legacy scratch note', () => {
    const local = new MemStorage();
    const session = new MemStorage();
    session.setItem(NOTEPAD_LEGACY_KEY, '10-4 on scene');
    const notes = loadPadNotes(local, session);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('10-4 on scene');
  });

  it('filters and exports', () => {
    const n = emptyNote('BOLO');
    n.body = 'silver honda';
    expect(filterPadNotes([n], 'honda')).toHaveLength(1);
    expect(filterPadNotes([n], 'zzz')).toHaveLength(0);
    expect(notesToPlaintext([n])).toContain('BOLO');
  });

  it('upserts into storage', () => {
    const local = new MemStorage();
    const n = emptyNote('A');
    const saved = savePadNotes([n], local);
    expect(local.getItem(NOTEPAD_NOTES_KEY)).toContain('A');
    const next = upsertPadNote(saved, { ...n, body: 'updated' });
    expect(next[0].body).toBe('updated');
  });
});
