export const NOTEPAD_NOTES_KEY = 'rmpg_notepad_notes_v1';
export const NOTEPAD_LEGACY_KEY = 'rmpg_notepad_content';

export interface PadNote {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

function newId(): string {
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyNote(title = 'Untitled'): PadNote {
  return { id: newId(), title, body: '', updatedAt: Date.now() };
}

export function loadPadNotes(storage: Storage = localStorage, session: Storage = sessionStorage): PadNote[] {
  try {
    const raw = storage.getItem(NOTEPAD_NOTES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((n): n is PadNote =>
          n && typeof n === 'object' && typeof (n as PadNote).id === 'string' && typeof (n as PadNote).body === 'string',
        ).map((n) => ({ ...n, title: n.title || 'Untitled' }));
      }
    }
  } catch { /* corrupt */ }

  const legacy = session.getItem(NOTEPAD_LEGACY_KEY) ?? storage.getItem(NOTEPAD_LEGACY_KEY);
  if (legacy && legacy.trim()) {
    return [{ id: newId(), title: 'Scratch', body: legacy, updatedAt: Date.now() }];
  }
  return [emptyNote('Scratch')];
}

export function savePadNotes(notes: PadNote[], storage: Storage = localStorage): PadNote[] {
  const next = notes.length ? notes : [emptyNote('Scratch')];
  try {
    storage.setItem(NOTEPAD_NOTES_KEY, JSON.stringify(next));
  } catch { /* quota */ }
  return next;
}

export function upsertPadNote(notes: PadNote[], note: PadNote): PadNote[] {
  const idx = notes.findIndex((n) => n.id === note.id);
  const stamped = { ...note, updatedAt: Date.now() };
  if (idx < 0) return savePadNotes([stamped, ...notes]);
  const copy = notes.slice();
  copy[idx] = stamped;
  return savePadNotes(copy);
}

export function deletePadNote(notes: PadNote[], id: string): PadNote[] {
  return savePadNotes(notes.filter((n) => n.id !== id));
}

export function filterPadNotes(notes: PadNote[], query: string): PadNote[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
}

export function notesToPlaintext(notes: PadNote[]): string {
  return notes.map((n) => `## ${n.title}\n${n.body}`).join('\n\n---\n\n');
}
